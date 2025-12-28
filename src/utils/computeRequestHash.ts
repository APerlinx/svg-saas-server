import crypto from 'crypto'

interface RequestParams {
  prompt: string
  style?: string | null
  model?: string | null
  privacy?: boolean
}

/**
 * Compute a deterministic hash of request parameters for idempotency checking.
 * This prevents reusing an idempotency key with different request parameters.
 */
export function computeRequestHash(params: RequestParams): string {
  // Create canonical JSON (sorted keys, consistent formatting)
  const canonical = JSON.stringify(
    {
      prompt: params.prompt,
      style: params.style ?? null,
      model: params.model ?? null,
      privacy: params.privacy ?? false,
    },
    Object.keys(params).sort()
  )

  return crypto.createHash('sha256').update(canonical).digest('hex')
}
