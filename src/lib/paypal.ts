import {
  PAYPAL_BASE_URL,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_SUPPORTER_PLAN_ID,
  PAYPAL_WEBHOOK_ID,
} from '../config/env'

interface PayPalAccessToken {
  token: string
  expiresAtMs: number
}

let cachedToken: PayPalAccessToken | null = null

function requirePayPalEnv(): {
  clientId: string
  clientSecret: string
  planId: string
  webhookId: string
} {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('Missing PayPal credentials')
  }

  if (!PAYPAL_SUPPORTER_PLAN_ID) {
    throw new Error('Missing PAYPAL_SUPPORTER_PLAN_ID')
  }

  if (!PAYPAL_WEBHOOK_ID) {
    throw new Error('Missing PAYPAL_WEBHOOK_ID')
  }

  return {
    clientId: PAYPAL_CLIENT_ID,
    clientSecret: PAYPAL_CLIENT_SECRET,
    planId: PAYPAL_SUPPORTER_PLAN_ID,
    webhookId: PAYPAL_WEBHOOK_ID,
  }
}

export async function getPayPalAccessToken(): Promise<string> {
  const now = Date.now()

  if (cachedToken && cachedToken.expiresAtMs > now + 30_000) {
    return cachedToken.token
  }

  const { clientId, clientSecret } = requirePayPalEnv()
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PayPal token request failed (${response.status}): ${text}`)
  }

  const json = (await response.json()) as {
    access_token: string
    expires_in: number
  }

  cachedToken = {
    token: json.access_token,
    expiresAtMs: now + json.expires_in * 1000,
  }

  return json.access_token
}

export async function createPayPalSubscription(params: {
  userId: string
  returnUrl: string
  cancelUrl: string
}) {
  const token = await getPayPalAccessToken()
  const { planId } = requirePayPalEnv()

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      plan_id: planId,
      custom_id: params.userId,
      application_context: {
        user_action: 'SUBSCRIBE_NOW',
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `PayPal create subscription failed (${response.status}): ${text}`,
    )
  }

  return (await response.json()) as {
    id: string
    status: string
    links?: Array<{ rel: string; href: string; method: string }>
  }
}

export async function cancelPayPalSubscription(
  subscriptionId: string,
  reason = 'Cancelled by customer',
): Promise<void> {
  const token = await getPayPalAccessToken()

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `PayPal cancel subscription failed (${response.status}): ${text}`,
    )
  }
}

export async function getPayPalSubscription(subscriptionId: string) {
  const token = await getPayPalAccessToken()

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `PayPal get subscription failed (${response.status}): ${text}`,
    )
  }

  return (await response.json()) as {
    id: string
    status: string
    plan_id?: string
    custom_id?: string
    subscriber?: {
      payer_id?: string
      email_address?: string
    }
    billing_info?: {
      next_billing_time?: string
      last_payment?: {
        amount?: {
          currency_code?: string
          value?: string
        }
      }
    }
  }
}

export async function verifyPayPalWebhookSignature(params: {
  headers: Record<string, string | undefined>
  rawBody: string
}): Promise<boolean> {
  const token = await getPayPalAccessToken()
  const { webhookId } = requirePayPalEnv()

  const transmissionId = params.headers['paypal-transmission-id']
  const transmissionTime = params.headers['paypal-transmission-time']
  const certUrl = params.headers['paypal-cert-url']
  const authAlgo = params.headers['paypal-auth-algo']
  const transmissionSig = params.headers['paypal-transmission-sig']

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    return false
  }

  const webhookEvent = JSON.parse(params.rawBody)

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: webhookEvent,
      }),
    },
  )

  if (!response.ok) {
    return false
  }

  const json = (await response.json()) as {
    verification_status?: string
  }

  return json.verification_status === 'SUCCESS'
}
