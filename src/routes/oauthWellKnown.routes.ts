/**
 * MCP OAuth 2.0 Authorization Server Metadata Endpoint
 * This endpoint provides metadata about the OAuth 2.0 authorization server, as defined in RFC 8414.
 * It allows clients to discover the authorization server's capabilities and endpoints.
 */

import { Router } from 'express'

const router = Router()

router.get('/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: 'https://api.chatsvg.dev',
    authorization_endpoint: 'https://api.chatsvg.dev/oauth/authorize',
    token_endpoint: 'https://api.chatsvg.dev/oauth/token',
    registration_endpoint: 'https://api.chatsvg.dev/oauth/register',
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  })
})

export default router
