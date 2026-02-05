# Admin Magic Link Authentication

Secure, passwordless admin authentication for accessing internal metrics and admin-only endpoints.

## Overview

The admin authentication system uses magic links sent via email to provide secure, time-limited access without managing passwords or IP allowlists. This is ideal for scenarios where:

- Admin IP addresses change frequently (dynamic IPs, travel, VPN)
- You want simple authentication without TOTP/2FA setup
- Access needs to be revoked automatically after a time period

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Admin email (required in production)
ADMIN_EMAIL=your-admin@example.com

# Backend URL for magic link generation (optional, defaults to http://localhost:3000)
BACKEND_URL=https://api.yourdomain.com
```

The system will throw an error on startup if `ADMIN_EMAIL` is not defined in production.

## How It Works

### 1. Request Access

Send a POST request to request a magic link:

```bash
curl -X POST https://api.yourdomain.com/api/admin/request-access \
  -H "Content-Type: application/json" \
  -d '{"email":"your-admin@example.com"}'
```

**Security features:**

- Only sends magic link if email matches `ADMIN_EMAIL`
- Timing-safe response (doesn't reveal if email is correct)
- Email logged for security auditing

### 2. Check Your Email

You'll receive an email with:

- Subject: "Admin Access - chatSVG"
- Magic link button (valid for 5 minutes)
- Security notice about single-use token

### 3. Click the Magic Link

The link format: `https://api.yourdomain.com/api/admin/auth?token=<jwt>`

**Token validation:**

- Verifies JWT signature and expiry (5 minutes)
- Checks token type is `admin_magic_link`
- Confirms email matches `ADMIN_EMAIL`
- Sets `admin_session` cookie (24-hour expiry)

### 4. Access Admin Endpoints

Once authenticated, you can access protected endpoints like:

```bash
curl https://api.yourdomain.com/api/admin/metrics \
  -b "admin_session=<your-session-token>"
```

**Session features:**

- HTTP-only cookie (prevents XSS attacks)
- Secure flag in production (HTTPS only)
- SameSite=Lax protection
- 24-hour expiry (convenient for a work day)

## Available Admin Endpoints

### GET /api/admin/metrics

View aggregated metrics for AI costs, latency, and job success rates.

**Authentication:** Requires valid admin session

**Response (placeholder):**

```json
{
  "message": "Metrics endpoint - implementation pending",
  "placeholder": {
    "ai": {
      "avgPromptTokens": 0,
      "avgCompletionTokens": 0,
      "avgLatencyMs": 0,
      "repairRate": 0
    },
    "jobs": {
      "queueDepth": 0,
      "successRate": 0,
      "avgDurationMs": 0
    }
  }
}
```

### POST /api/admin/logout

Clear admin session cookie.

```bash
curl -X POST https://api.yourdomain.com/api/admin/logout \
  -b "admin_session=<your-session-token>"
```

## Security Model

### Magic Link Token (5-minute expiry)

```javascript
{
  email: 'admin@chatsvg.dev',
  type: 'admin_magic_link',
  nonce: 'random-string',  // Single-use enforcement
  exp: <5 minutes from now>
}
```

### Session Token (24-hour expiry)

```javascript
{
  email: 'admin@chatsvg.dev',
  type: 'admin',
  exp: <24 hours from now>
}
```

### Security Features

1. **Time-limited access**
   - Magic link expires in 5 minutes
   - Session expires in 24 hours
   - No permanent credentials stored

2. **Email-only whitelist**
   - Only `ADMIN_EMAIL` can request access
   - Timing-safe responses prevent email enumeration

3. **Single-use tokens** (TODO)
   - Nonce tracking in Redis prevents token reuse
   - Currently protected by short expiry

4. **Secure cookies**
   - HTTP-only (prevents JavaScript access)
   - Secure flag in production (HTTPS only)
   - SameSite=Lax (CSRF protection)

5. **Audit logging**
   - All access requests logged (Pino)
   - Failed authentications tracked (Sentry in production)

## Adding New Admin Routes

Protect any route with the `requireAdmin` middleware:

```typescript
import { requireAdmin } from '../middleware/adminAuth.js'

router.get('/api/admin/my-endpoint', requireAdmin, async (req, res) => {
  // Your admin-only logic here
  res.json({ data: 'secret admin data' })
})
```

The middleware:

- Verifies `admin_session` cookie exists
- Validates JWT signature and expiry
- Checks token type is `admin`
- Confirms email matches `ADMIN_EMAIL`
- Returns 401/403 if invalid

## Testing

Run admin auth tests:

```bash
npm test src/routes/__tests__/admin/magic-link.test.ts
```

**Test coverage:**

- Magic link email sending
- Token validation (valid/expired/wrong type/wrong email)
- Session cookie handling
- Metrics endpoint access control
- Logout functionality

## TODO / Improvements

1. **Nonce tracking in Redis**
   - Prevent magic link reuse
   - Currently relying on 5-minute expiry

2. **Rate limiting on `/request-access`**
   - Prevent email spam
   - Add to rate limiter config

3. **Admin activity audit log**
   - Track all admin actions
   - Store in database for compliance

4. **Session revocation**
   - Redis-backed session management
   - Manual logout from all devices

5. **Multi-admin support**
   - Allow comma-separated `ADMIN_EMAIL` list
   - Role-based access control (RBAC)

## Troubleshooting

### "Invalid or missing token"

- Magic link expired (5 min limit)
- Token was already used
- Browser didn't preserve cookies

**Solution:** Request a new magic link

### "Invalid admin credentials"

- Email doesn't match `ADMIN_EMAIL`
- Token type is wrong

**Solution:** Check `.env` file for correct `ADMIN_EMAIL`

### "Admin authentication required"

- No `admin_session` cookie
- Session expired (24 hours)

**Solution:** Use magic link to authenticate again

### Magic link not received

- Check spam folder
- Verify `ADMIN_EMAIL` is correct
- Check Resend API logs (email service)

**Solution:** Check server logs for email send errors

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  POST /api/admin/request-access                     │
│  { email: 'admin@chatsvg.dev' }                     │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
       ┌────────────────────────────┐
       │ Generate JWT (5min expiry) │
       │ - email                    │
       │ - type: admin_magic_link   │
       │ - nonce (single-use)       │
       └────────────┬───────────────┘
                    │
                    ▼
       ┌────────────────────────────┐
       │ Send email via Resend      │
       │ Link: /api/admin/auth?token│
       └────────────┬───────────────┘
                    │
                    │ (User clicks link)
                    ▼
┌─────────────────────────────────────────────────────┐
│  GET /api/admin/auth?token=<jwt>                    │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
       ┌────────────────────────────┐
       │ Verify magic link token    │
       │ - JWT signature valid?     │
       │ - Not expired?             │
       │ - Email matches ADMIN_EMAIL?│
       └────────────┬───────────────┘
                    │
                    ▼
       ┌────────────────────────────┐
       │ Generate session token     │
       │ (24h expiry)               │
       │ Set admin_session cookie   │
       └────────────┬───────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│  GET /api/admin/metrics                             │
│  Cookie: admin_session=<jwt>                        │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
       ┌────────────────────────────┐
       │ requireAdmin middleware    │
       │ - Cookie exists?           │
       │ - JWT valid?               │
       │ - Email matches?           │
       └────────────┬───────────────┘
                    │
                    ▼
               ┌─────────┐
               │ Success │
               │ Return  │
               │ metrics │
               └─────────┘
```

## Production Deployment

1. **Set environment variables:**

   ```bash
   ADMIN_EMAIL=your-real-admin@yourcompany.com
   BACKEND_URL=https://api.yourdomain.com
   ```

2. **Verify email service works:**
   - Test with a real email send
   - Check Resend dashboard for delivery status

3. **Enable HTTPS:**
   - Session cookies require `Secure` flag in production
   - Magic links won't work over HTTP in production

4. **Monitor logs:**
   - Watch for failed authentication attempts
   - Alert on unusual admin access patterns

5. **Set up alerts:**
   - Sentry notifications for auth failures
   - Email alerts for admin access (optional)
