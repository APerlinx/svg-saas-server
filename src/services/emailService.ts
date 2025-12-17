import { Resend } from 'resend'
import { RESEND_API_KEY } from '../config/env'
import { FRONTEND_URL } from '../config/env'
import { logger } from '../lib/logger'

const resend = new Resend(RESEND_API_KEY)

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string
) {
  const resetUrl = `${
    FRONTEND_URL || 'http://localhost:5173'
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
      from: 'chatSVG <onboarding@resend.dev>',
      to: email,
      subject: 'Welcome to chatSVG',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.8; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
              .content { margin: 20px 0; }
              .tips { margin: 30px 0; }
              .tip-item { 
                margin: 15px 0;
                padding-left: 20px;
                border-left: 3px solid #d57835;
              }
              .tip-title { font-weight: bold; color: #d57835; margin-bottom: 5px; }
              .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <p>Hey,</p>
              
              <p>This is the team at chatSVG.</p>
              
              <div class="content">
                <p>We built chatSVG to make creating scalable vector graphics simple and accessible to everyone. Whether you're a designer, developer, or someone who just needs a quick icon or illustration, we wanted to remove the complexity and let AI do the heavy lifting.</p>
                
                <p>Our goal is to help you bring your ideas to life without needing design software or technical skills.</p>
              </div>
              
              <div class="tips">
                <p><strong>Here are 3 tips to get started:</strong></p>
                
                <div class="tip-item">
                  <div class="tip-title">1. How to generate your first SVG</div>
                  <div>Coming soon - we'll share a guide on creating your first graphic</div>
                </div>
                
                <div class="tip-item">
                  <div class="tip-title">2. Building effective prompts</div>
                  <div>Coming soon - learn how to write prompts that get you the best results</div>
                </div>
                
                <div class="tip-item">
                  <div class="tip-title">3. Making the most of chatSVG</div>
                  <div>Coming soon - tips and tricks for advanced usage</div>
                </div>
              </div>
              
              <p>If you have any questions, suggestions, or just want to chat about what we're building, feel free to send me an email. We'd love to hear from you.</p>
              
              <p>Cheers,<br>chatSVG Team</p>
              
              <div class="footer">
                <p>chatSVG - AI-powered SVG generation</p>
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
