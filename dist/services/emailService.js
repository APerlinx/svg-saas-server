"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendAdminMagicLink = void 0;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.sendWelcomeEmail = sendWelcomeEmail;
exports.sendSupportMessageEmail = sendSupportMessageEmail;
exports.sendSupportConfirmationEmail = sendSupportConfirmationEmail;
const resend_1 = require("resend");
const env_1 = require("../config/env");
const env_2 = require("../config/env");
const env_3 = require("../config/env");
const logger_1 = require("../lib/logger");
const resend = new resend_1.Resend(env_1.RESEND_API_KEY);
const EMAIL_FROM = 'chatSVG <noreply@chatsvg.dev>';
async function sendPasswordResetEmail(email, resetToken) {
    const resetUrl = `${env_2.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
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
        });
        logger_1.logger.info({ email }, 'Password reset email sent');
    }
    catch (error) {
        logger_1.logger.error({ error, email }, 'Error sending password reset email');
        throw new Error('Failed to send email');
    }
}
async function sendWelcomeEmail(email, name) {
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
        });
        logger_1.logger.info({ email }, 'Welcome email sent');
    }
    catch (error) {
        logger_1.logger.error({ error, email }, 'Error sending welcome email');
    }
}
function supportTypeTag(type) {
    switch (type) {
        case 'bug':
            return '[BUG]';
        case 'idea':
            return '[IDEA]';
        case 'contact':
        default:
            return '[MESSAGE]';
    }
}
async function sendSupportMessageEmail(payload, meta) {
    const tag = supportTypeTag(payload.type);
    const subject = `${tag} ${payload.subject}`.trim();
    try {
        await resend.emails.send({
            from: 'chatSVG <noreply@chatsvg.dev>',
            to: env_3.SUPPORT_INBOX_EMAIL,
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
                `IP: ${(meta === null || meta === void 0 ? void 0 : meta.ip) || 'N/A'}`,
                `Request ID: ${(meta === null || meta === void 0 ? void 0 : meta.requestId) || 'N/A'}`,
                '',
                'Message:',
                payload.message,
            ].join('\n'),
        });
        logger_1.logger.info({ type: payload.type, hasEmail: !!payload.email }, 'Support message email sent');
    }
    catch (error) {
        logger_1.logger.error({ error }, 'Error sending support message email');
        throw new Error('Failed to send email');
    }
}
async function sendSupportConfirmationEmail(email, type, subject) {
    const tag = supportTypeTag(type);
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
        });
        logger_1.logger.info({ email, type }, 'Support confirmation email sent');
    }
    catch (error) {
        logger_1.logger.error({ error, email }, 'Error sending support confirmation email');
    }
}
/**
 * Send admin magic link for passwordless authentication
 */
const sendAdminMagicLink = async (email, token) => {
    try {
        const backendUrl = process.env.NODE_ENV === 'production'
            ? 'https://api.chatsvg.dev'
            : 'http://localhost:3000';
        const magicLink = `${backendUrl}/api/admin/auth?token=${token}`;
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
        });
        logger_1.logger.info({ email }, 'Admin magic link sent');
    }
    catch (error) {
        logger_1.logger.error({ error, email }, 'Error sending admin magic link');
        throw error;
    }
};
exports.sendAdminMagicLink = sendAdminMagicLink;
