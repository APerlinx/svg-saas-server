import crypto from 'crypto'

export function createPasswordResetToken() {
  const resetToken = crypto.randomBytes(32).toString('hex')
  const hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex')
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
  return { resetToken, hashedToken, resetExpires }
}

export function hashResetToken(resetToken: string) {
  return crypto.createHash('sha256').update(resetToken).digest('hex')
}
