/**
 * OAuth routes for mcp
 */

import { Router } from 'express'
import { Request, Response } from 'express'
import { sanitizeInput } from '../utils/sanitizeInput'
import prisma from '../lib/prisma'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { logger } from '../lib/logger'
import { hashApiKey } from '../services/apiKeyService'

const router = Router()

const allowedGrantTypes = ['authorization_code', 'refresh_token']
const allowedCodeChallengeMethods = ['S256']

router.post('/register', async (req: Request, res: Response) => {
  let { client_name, redirect_uris, grant_types, code_challenge_method } =
    req.body

  // redirect_uris is optional — Claude Code uses dynamic localhost ports
  // and only sends the actual redirect_uri at /authorize time
  if (redirect_uris !== undefined) {
    if (!Array.isArray(redirect_uris))
      return res.status(400).send('redirect_uris must be an array')
    if (redirect_uris.some((uri) => typeof uri !== 'string'))
      return res.status(400).send('redirect_uris must be an array of strings')
  }

  if (grant_types !== undefined) {
    if (!Array.isArray(grant_types))
      return res.status(400).send('grant_types must be an array')
    if (!grant_types.every((type: string) => allowedGrantTypes.includes(type)))
      return res.status(400).send('Invalid grant_types')
  }

  if (!client_name || typeof client_name !== 'string')
    return res.status(400).send('client_name is required')
  if (
    code_challenge_method &&
    !allowedCodeChallengeMethods.includes(code_challenge_method)
  )
    return res.status(400).send('Invalid code_challenge_method')

  client_name = sanitizeInput(client_name as string)
  const sanitizedRedirectUris = Array.isArray(redirect_uris)
    ? redirect_uris.map((uri: string) => sanitizeInput(uri))
    : []

  let client_secret = crypto.randomBytes(32).toString('hex')
  const hashedPassword = await bcrypt.hash(client_secret, 10)

  try {
    const client = await prisma.oAuthClient.create({
      data: {
        name: client_name,
        redirectUri: sanitizedRedirectUris,
        clientSecretHash: hashedPassword,
      },
    })

    return res.json({
      client_id: client.clientId,
      client_secret,
    })
  } catch (error) {
    logger.error({ err: error }, 'Error creating client')
    return res.status(500).send('Error creating client')
  }
})

router.get('/authorize', async (req: Request, res: Response) => {
  let {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    scope,
    state,
  } = req.query
  if (!client_id || typeof client_id !== 'string')
    return res.status(400).send('client_id is required')
  if (!redirect_uri || typeof redirect_uri !== 'string')
    return res.status(400).send('redirect_uri is required')
  if (!code_challenge || typeof code_challenge !== 'string')
    return res.status(400).send('code_challenge is required')
  if (!code_challenge_method || typeof code_challenge_method !== 'string')
    return res.status(400).send('code_challenge_method is required')
  if (!scope || typeof scope !== 'string')
    return res.status(400).send('scope is required')
  if (!state || typeof state !== 'string')
    return res.status(400).send('state is required')

  client_id = sanitizeInput(client_id)
  redirect_uri = sanitizeInput(redirect_uri)
  code_challenge = sanitizeInput(code_challenge)
  code_challenge_method = sanitizeInput(code_challenge_method)
  scope = sanitizeInput(scope)
  state = sanitizeInput(state)

  try {
    const existingClient = await prisma.oAuthClient.findUnique({
      where: { clientId: client_id },
    })
    if (!existingClient) return res.status(400).send('Invalid client_id')
    const isLocalhostRedirect = /^https?:\/\/localhost(:\d+)?(\/.*)?$/.test(redirect_uri)
    const hasRegisteredUris = existingClient.redirectUri.length > 0
    if (hasRegisteredUris && !existingClient.redirectUri.includes(redirect_uri)) {
      return res.status(400).send('Invalid redirect_uri')
    }
    if (!hasRegisteredUris && !isLocalhostRedirect) {
      return res.status(400).send('Invalid redirect_uri: only localhost is allowed for dynamically registered clients')
    }
    const escape = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    res.send(`<html>
    <body>
      <form method="POST" action="/oauth/authorize">
        <input type="text" name="api_key" placeholder="Enter your API key" required />
        <input type="hidden" name="client_id" value="${escape(client_id)}" />
        <input type="hidden" name="redirect_uri" value="${escape(redirect_uri)}" />
        <input type="hidden" name="code_challenge" value="${escape(code_challenge)}" />
        <input type="hidden" name="code_challenge_method" value="${escape(code_challenge_method)}" />
        <input type="hidden" name="scope" value="${escape(scope)}" />
        <input type="hidden" name="state" value="${escape(state)}" />
        <button type="submit">Authorize</button>
      </form>
    </body>
  </html>`)
  } catch (error) {
    logger.error({ err: error }, 'Error fetching client')
    return res.status(500).send('Error fetching client')
  }
})

router.post('/authorize', async (req: Request, res: Response) => {
  let {
    api_key,
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    state,
  } = req.body

  if (!api_key || typeof api_key !== 'string')
    return res.status(400).send('api_key is required')
  if (!client_id || typeof client_id !== 'string')
    return res.status(400).send('client_id is required')
  if (!redirect_uri || typeof redirect_uri !== 'string')
    return res.status(400).send('redirect_uri is required')
  if (!code_challenge || typeof code_challenge !== 'string')
    return res.status(400).send('code_challenge is required')
  if (!code_challenge_method || typeof code_challenge_method !== 'string')
    return res.status(400).send('code_challenge_method is required')
  if (!state || typeof state !== 'string')
    return res.status(400).send('state is required')

  try {
    const keyHash = hashApiKey(api_key)
    const userKey = await prisma.apiKey.findFirst({
      where: {
        keyHash: keyHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    })
    if (!userKey) return res.status(400).send('Invalid API key')
    const userId = userKey.userId

    const oAuthClient = await prisma.oAuthClient.findFirst({
      where: { clientId: client_id, revokedAt: null },
    })
    if (!oAuthClient) return res.status(400).send('Invalid client_id')
    const hasRegisteredUris = oAuthClient.redirectUri.length > 0
    const isLocalhostRedirect = /^https?:\/\/localhost(:\d+)?(\/.*)?$/.test(redirect_uri)
    if (hasRegisteredUris && !oAuthClient.redirectUri.includes(redirect_uri)) {
      return res.status(400).send('Invalid redirect_uri')
    }
    if (!hasRegisteredUris && !isLocalhostRedirect) {
      return res.status(400).send('Invalid redirect_uri: only localhost is allowed for dynamically registered clients')
    }
    const code = crypto.randomBytes(32).toString('hex')
    await prisma.oAuthAuthorizationCode.create({
      data: {
        code,
        oauthClientId: oAuthClient.id,
        userId,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        redirectUri: redirect_uri,
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    })
    const redirectUrl = new URL(redirect_uri)
    redirectUrl.searchParams.append('code', code)
    redirectUrl.searchParams.append('state', state)
    res.redirect(redirectUrl.toString())
  } catch (error) {
    logger.error({ err: error }, 'Error fetching client')
    return res.status(500).send('Error fetching client')
  }
})

router.post('/token', async (req: Request, res: Response) => {
  let {
    code,
    grant_type,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
  } = req.body

  if (!grant_type || typeof grant_type !== 'string')
    return res.status(400).send('grant_type is required')
  if (!client_id || typeof client_id !== 'string')
    return res.status(400).send('client_id is required')
  if (!client_secret || typeof client_secret !== 'string')
    return res.status(400).send('client_secret is required')

  try {
    const oAuthClient = await prisma.oAuthClient.findFirst({
      where: { clientId: client_id, revokedAt: null },
    })
    if (!oAuthClient)
      return res.status(400).send('Invalid client_id or client_secret')
    const validSecret = await bcrypt.compare(
      client_secret,
      oAuthClient.clientSecretHash,
    )
    if (!validSecret)
      return res.status(400).send('Invalid client_id or client_secret')

    // Handle authorization code grant
    if (grant_type === 'authorization_code') {
      if (!code || typeof code !== 'string')
        return res.status(400).send('code is required')
      if (!code_verifier || typeof code_verifier !== 'string')
        return res.status(400).send('code_verifier is required')
      if (!redirect_uri || typeof redirect_uri !== 'string')
        return res.status(400).send('redirect_uri is required')

      const authCode = await prisma.oAuthAuthorizationCode.findFirst({
        where: { code, expiresAt: { gt: new Date() }, usedAt: null },
        select: {
          redirectUri: true,
          codeChallenge: true,
          userId: true,
          oauthClientId: true,
        },
      })
      if (!authCode) return res.status(400).send('Invalid or expired code')
      if (authCode.oauthClientId !== oAuthClient.id)
        return res.status(400).send('Invalid code for this client')

      const expectedChallenge = crypto
        .createHash('sha256')
        .update(code_verifier)
        .digest('base64url')
      if (expectedChallenge !== authCode.codeChallenge) {
        return res.status(400).send('Invalid code_verifier')
      }

      if (authCode.redirectUri !== redirect_uri) {
        return res.status(400).send('Invalid redirect_uri')
      }

      const accessToken = crypto.randomBytes(32).toString('hex')
      const refreshToken = crypto.randomBytes(32).toString('hex')

      await prisma.$transaction(async (tx) => {
        await tx.oAuthAuthorizationCode.update({
          where: { code },
          data: { usedAt: new Date() },
        })

        await tx.oAuthAccessToken.create({
          data: {
            token: accessToken,
            userId: authCode.userId,
            oauthClientId: authCode.oauthClientId,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        })

        await tx.oAuthRefreshToken.create({
          data: {
            token: refreshToken,
            userId: authCode.userId,
            oauthClientId: authCode.oauthClientId,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        })
      })
      return res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 60 * 60,
      })
    }

    // Handle refresh token grant
    if (grant_type === 'refresh_token') {
      if (!refresh_token || typeof refresh_token !== 'string')
        return res.status(400).send('refresh_token is required')

      const refreshTokenRecord = await prisma.oAuthRefreshToken.findFirst({
        where: {
          token: refresh_token,
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
        select: { userId: true, oauthClientId: true },
      })
      if (!refreshTokenRecord)
        return res.status(400).send('Invalid or expired refresh token')
      if (refreshTokenRecord.oauthClientId !== oAuthClient.id)
        return res.status(400).send('Invalid refresh token')

      const accessToken = crypto.randomBytes(32).toString('hex')
      const newRefreshToken = crypto.randomBytes(32).toString('hex')

      await prisma.$transaction(async (tx) => {
        await tx.oAuthRefreshToken.update({
          where: { token: refresh_token },
          data: { revokedAt: new Date() },
        })

        await tx.oAuthAccessToken.create({
          data: {
            token: accessToken,
            userId: refreshTokenRecord.userId,
            oauthClientId: refreshTokenRecord.oauthClientId,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        })

        await tx.oAuthRefreshToken.create({
          data: {
            token: newRefreshToken,
            userId: refreshTokenRecord.userId,
            oauthClientId: refreshTokenRecord.oauthClientId,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        })
      })

      return res.json({
        access_token: accessToken,
        refresh_token: newRefreshToken,
        token_type: 'Bearer',
        expires_in: 60 * 60,
      })
    }
    return res.status(400).send('Unsupported grant_type')
  } catch (error) {
    logger.error({ err: error }, 'Internal server error')
    return res.status(500).send('Internal server error')
  }
})

export default router
