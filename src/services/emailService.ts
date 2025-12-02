import { Resend } from 'resend'
import { RESEND_API_KEY } from '../config/env'
import { FRONTEND_URL } from '../config/env'
const resend = new Resend(RESEND_API_KEY)

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string
) {
  const resetUrl = `${
    FRONTEND_URL || 'http://localhost:3000'
  }/reset-password?token=${resetToken}`

  try {
    await resend.emails.send({
      from: 'chatSVG <onboarding@resend.dev>',
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
                background-color: #4F46E5; 
                color: white; 
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
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #4F46E5;">${resetUrl}</p>
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

    console.log('Password reset email sent to:', email)
  } catch (error) {
    console.error('Error sending email:', error)
    throw new Error('Failed to send email')
  }
}
