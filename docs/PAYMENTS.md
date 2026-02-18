# Payments & Billing

ChatSVG uses **PayPal Subscriptions** for billing. Plan upgrades and downgrades are driven entirely by PayPal webhook events — the server never polls PayPal for status.

---

## Plans

| Plan      | Price   | Credits (start) | Monthly refill | Generations/month | API keys |
| --------- | ------- | --------------- | -------------- | ----------------- | -------- |
| FREE      | $0      | 30              | 0              | 30                | 1        |
| SUPPORTER | $5/mo   | 300             | 300            | 300               | 5        |

Credit values are defined in `src/utils/planLimits.ts`.

---

## Environment Variables

```env
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_SUPPORTER_PLAN_ID=...       # PayPal billing plan ID for SUPPORTER
PAYPAL_WEBHOOK_ID=...              # From PayPal developer dashboard (used for signature verification)
PAYPAL_BASE_URL=https://api-m.paypal.com   # or https://api-m.sandbox.paypal.com for sandbox
PAYPAL_RETURN_URL=...              # Optional — defaults to FRONTEND_URL/billing/paypal/success
PAYPAL_CANCEL_URL=...              # Optional — defaults to FRONTEND_URL/billing/paypal/cancel
```

Set `PAYPAL_ENABLED=true` to enable billing routes. If false, all `/api/paypal/*` routes return 503.

---

## API Routes (`/api/paypal`)

| Method | Endpoint                | Auth | Description |
| ------ | ----------------------- | ---- | ----------- |
| POST   | `/create-subscription`  | Yes  | Create a new PayPal subscription for the SUPPORTER plan. Returns `{ subscriptionId, approveUrl }` — redirect user to `approveUrl`. |
| GET    | `/status`               | Yes  | Return current billing status: plan, credits, PayPal subscription ID/status, and live remote subscription data from PayPal. |
| POST   | `/subscription/cancel`  | Yes  | Cancel the user's active PayPal subscription. Plan stays SUPPORTER until webhook confirms cancellation. |
| POST   | `/webhook`              | No   | PayPal webhook handler (see below). |

---

## Subscription Flow

### First-time subscriber

```
User clicks Subscribe
  → POST /api/paypal/create-subscription
  → PayPal creates subscription (custom_id = userId)
  → Returns approveUrl → redirect user to PayPal

User approves on PayPal
  → BILLING.SUBSCRIPTION.ACTIVATED webhook
      → verify signature
      → store in PayPalWebhookEvent (idempotency)
      → plan = SUPPORTER
      → credits += 300 (startingCredits)
      → nextCreditRefillAt = now + 30 days

  → PAYMENT.SALE.COMPLETED webhook (arrives shortly after)
      → verify signature
      → store in PayPalWebhookEvent (idempotency)
      → applyRecurringSupporterCredits(): updateMany where nextCreditRefillAt <= now
      → nextCreditRefillAt is in the future → 0 rows updated → log "refill not due yet" ✅
      (This is correct: starting credits were already granted by ACTIVATED)
```

### Monthly renewal

```
PayPal charges user on next billing cycle
  → PAYMENT.SALE.COMPLETED webhook
      → applyRecurringSupporterCredits(): nextCreditRefillAt <= now ✅
      → credits += 300
      → nextCreditRefillAt += 30 days
```

### Cancellation

```
User cancels (via app or PayPal)
  → BILLING.SUBSCRIPTION.CANCELLED webhook
      → plan = FREE
      → creditRefillAmount = 0
      → generationsQuotaLimit = 30
      (credits already used are not clawed back)
```

Other termination events (`BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`) trigger the same downgrade.

### Re-activation

```
BILLING.SUBSCRIPTION.RE-ACTIVATED webhook
  → upgradeUserToSupporter()
  → if user was FREE: credits += 300 (starting credits)
  → if user was already SUPPORTER: no credit grant (idempotent)
```

---

## Webhook Idempotency

Every incoming webhook is immediately stored in the `PayPalWebhookEvent` table:

```typescript
await prisma.payPalWebhookEvent.create({
  data: { paypalEventId: event.id, ... }
})
```

`paypalEventId` has a unique constraint. If PayPal retries an event:
- Prisma throws `P2002` (unique constraint violation)
- Handler returns `200 { ok: true, duplicate: true }` immediately
- No business logic is re-executed

This makes all webhook handlers safe to receive multiple times.

---

## Credit Refill Guard

Recurring credits use `updateMany` with a time-based guard to prevent double-granting:

```typescript
await prisma.user.updateMany({
  where: {
    id: userId,
    nextCreditRefillAt: { lte: now },  // NULL is never <= now (PostgreSQL)
  },
  data: {
    credits: { increment: 300 },
    nextCreditRefillAt: nextRefill,    // advances window
  },
})
```

- On initial payment: `nextCreditRefillAt` is set to +30 days by `BILLING.SUBSCRIPTION.ACTIVATED` → update matches 0 rows → safe
- On monthly payment: window is due → update matches 1 row → credits added, window advances
- If PayPal sends duplicate `PAYMENT.SALE.COMPLETED`: event deduplicated before reaching this code

---

## Webhook Signature Verification

Every incoming webhook is verified against PayPal's API before any business logic runs:

```
POST /webhook
  → parse raw body
  → verifyPayPalWebhookSignature(headers, rawBody)
      → POST PayPal /v1/notifications/verify-webhook-signature
      → verification_status === 'SUCCESS'
  → if invalid → 400 { error: 'Invalid webhook signature' }
```

The verification uses: `paypal-transmission-id`, `paypal-transmission-time`, `paypal-cert-url`, `paypal-auth-algo`, `paypal-transmission-sig`, and `PAYPAL_WEBHOOK_ID`.

---

## User Resolution in Webhooks

The webhook handler resolves `userId` in two steps:

1. **`custom_id`** on the resource — set when the subscription is created (`custom_id: userId`). This is present on subscription lifecycle events.
2. **Subscription ID lookup** — for payment events, extracts the subscription ID from `resource.billing_agreement_id` (preferred) → `resource.supplementary_data.related_ids.subscription_id` → `resource.id` (only if starts with `I-`, the PayPal subscription ID prefix).

If no user is found, the event is stored and ignored (`200 { ok: true, ignored: true }`).

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `src/routes/paypal.routes.ts` | All billing routes + webhook handler |
| `src/lib/paypal.ts` | PayPal API client (access token, subscriptions, webhook verification) |
| `src/utils/planLimits.ts` | Plan credit values and limits |
| `prisma/schema.prisma` | `User` billing fields + `PayPalWebhookEvent` model |
