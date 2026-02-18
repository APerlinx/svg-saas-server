import { Resend } from 'resend'
import { RESEND_API_KEY } from '../config/env'
import { FRONTEND_URL } from '../config/env'
import { SUPPORT_INBOX_EMAIL } from '../config/env'
import { logger } from '../lib/logger'

const resend = new Resend(RESEND_API_KEY)
const EMAIL_FROM = 'chatSVG <noreply@chatsvg.dev>'

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
) {
  const resetUrl = `${
    FRONTEND_URL || 'http://localhost:5173'
  }/reset-password?token=${resetToken}`

  try {
    await resend.emails.send({
      from: 'chatSVG <noreply@chatsvg.dev>',
      to: email,
      subject: 'Reset Your Password',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .button { 
                display: inline-block; 
                padding: 12px 24px; 
                background-color: #d57835; 
                color: white !important; 
                text-decoration: none; 
                border-radius: 5px;
                margin: 20px 0;
              }
              .footer { margin-top: 30px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>Reset Your Password</h2>
              <p>You requested to reset your password. Click the button below to create a new password:</p>
              <a href="${resetUrl}" class="button">Reset Password</a>
              <p>This link will expire in 1 hour.</p>
              <p>If you didn't request this, please ignore this email.</p>
              <div class="footer">
                <p>chatSVG - Your AI-powered SVG generator</p>
              </div>
            </div>
          </body>
        </html>
      `,
    })

    logger.info({ email }, 'Password reset email sent')
  } catch (error) {
    logger.error({ error, email }, 'Error sending password reset email')
    throw new Error('Failed to send email')
  }
}

export async function sendWelcomeEmail(email: string, name: string) {
  try {
    await resend.emails.send({
      from: 'chatSVG <noreply@chatsvg.dev>',
      to: email,
      subject: 'Welcome to chatSVG',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.8; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
              .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666; font-size: 13px; }
            </style>
          </head>
          <body>
            <div class="container">
              <p>Hey${name ? ` ${name.split(' ')[0]}` : ''},</p>

              <p>Welcome to chatSVG. Glad you're here.</p>

              <p>You can start generating SVG icons right away from the app. Describe what you want, pick a style, and the AI takes care of the rest.</p>

              <p>If you want to integrate SVG generation into your own project, you can create an API key from your account settings and use our API directly.</p>

              <p>If you have questions or run into anything, just reply to this email.</p>

              <p>Cheers,<br>chatSVG</p>

              <div class="footer">
                <p>chatSVG &mdash; AI-powered SVG generation &mdash; <a href="${FRONTEND_URL}" style="color: #d57835;">chatsvg.dev</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    })

    logger.info({ email }, 'Welcome email sent')
  } catch (error) {
    logger.error({ error, email }, 'Error sending welcome email')
  }
}

export type SupportMessageType = 'contact' | 'bug' | 'idea'

export type SubmitSupportMessagePayload = {
  type: SupportMessageType
  subject: string
  message: string
  email: string
  userId?: string
  contextUrl?: string
  userAgent?: string
}

function supportTypeTag(type: SupportMessageType): string {
  switch (type) {
    case 'bug':
      return '[BUG]'
    case 'idea':
      return '[IDEA]'
    case 'contact':
    default:
      return '[MESSAGE]'
  }
}

export async function sendSupportMessageEmail(
  payload: SubmitSupportMessagePayload,
  meta?: { ip?: string; requestId?: string },
) {
  const tag = supportTypeTag(payload.type)
  const subject = `${tag} ${payload.subject}`.trim()

  try {
    await resend.emails.send({
      from: 'chatSVG <noreply@chatsvg.dev>',
      to: SUPPORT_INBOX_EMAIL,
      replyTo: payload.email,
      subject,
      text: [
        `${tag} Support message`,
        '',
        `Subject: ${payload.subject}`,
        `Type: ${payload.type}`,
        `From email: ${payload.email || 'N/A'}`,
        `User ID: ${payload.userId || 'N/A'}`,
        `Context URL: ${payload.contextUrl || 'N/A'}`,
        `User Agent: ${payload.userAgent || 'N/A'}`,
        `IP: ${meta?.ip || 'N/A'}`,
        `Request ID: ${meta?.requestId || 'N/A'}`,
        '',
        'Message:',
        payload.message,
      ].join('\n'),
    })

    logger.info(
      { type: payload.type, hasEmail: !!payload.email },
      'Support message email sent',
    )
  } catch (error) {
    logger.error({ error }, 'Error sending support message email')
    throw new Error('Failed to send email')
  }
}

export async function sendSupportConfirmationEmail(
  email: string,
  type: SupportMessageType,
  subject: string,
) {
  const tag = supportTypeTag(type)
  try {
    await resend.emails.send({
      from: 'chatSVG <noreply@chatsvg.dev>',
      to: email,
      subject: `We received your message ${tag}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .footer { margin-top: 30px; font-size: 12px; color: #666; }
              .subject { padding: 12px; background: #f5f5f5; border-radius: 6px; }
            </style>
          </head>
          <body>
            <div class="container">
              <p>Thanks — your message was received.</p>
              <p>We’ll take a look as soon as we can.</p>
              <div class="subject">
                <div><strong>Type:</strong> ${tag.replace(/\[|\]/g, '')}</div>
                <div><strong>Subject:</strong> ${subject}</div>
              </div>
              <div class="footer">
                <p>chatSVG - AI-powered SVG generation</p>
              </div>
            </div>
          </body>
        </html>
      `,
    })
    logger.info({ email, type }, 'Support confirmation email sent')
  } catch (error) {
    logger.error({ error, email }, 'Error sending support confirmation email')
  }
}

/**
 * Send admin magic link for passwordless authentication
 */
export const sendAdminMagicLink = async (email: string, token: string) => {
  try {
    const backendUrl =
      process.env.NODE_ENV === 'production'
        ? 'https://api.chatsvg.dev'
        : 'http://localhost:3000'
    const magicLink = `${backendUrl}/api/admin/auth?token=${token}`

    await resend.emails.send({
      from: 'chatSVG <noreply@chatsvg.dev>',
      to: email,
      subject: 'Admin Access - chatSVG',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 20px; }
              .container { max-width: 600px; margin: 0 auto; background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              .header { color: #4f46e5; font-size: 24px; font-weight: bold; margin-bottom: 20px; }
              .content { margin-bottom: 30px; }
              .button { display: inline-block; padding: 12px 24px; background-color: #4f46e5; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; }
              .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; }
              .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">Admin Access Request</div>
              <div class="content">
                <p>Click the button below to access the admin panel:</p>
                <p style="text-align: center; margin: 30px 0;">
                  <a href="${magicLink}" class="button">Access Admin Panel</a>
                </p>
                <div class="warning">
                  <strong>⚠️ Security Notice:</strong> This link expires in 5 minutes and can only be used once.
                </div>
                <p style="font-size: 14px; color: #6b7280;">If you didn't request admin access, you can safely ignore this email.</p>
              </div>
              <div class="footer">
                <p>chatSVG - AI-powered SVG generation</p>
              </div>
            </div>
          </body>
        </html>
      `,
    })
    logger.info({ email }, 'Admin magic link sent')
  } catch (error) {
    logger.error({ error, email }, 'Error sending admin magic link')
    throw error
  }
}
