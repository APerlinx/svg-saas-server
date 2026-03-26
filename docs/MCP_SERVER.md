# MCP Server

This document describes the standalone MCP server in this repository.

- Runtime entry: `src/mcp-server.ts`
- Local URL (default): `http://localhost:3001/mcp`
- Health endpoint: `GET /mcp/health`

The MCP server is a separate Express process from the main API (`src/server.ts`).

---

## Overview

The MCP server exposes AI SVG generation tools over Streamable HTTP.

- Transport: Streamable HTTP (`@modelcontextprotocol/sdk`)
- Auth: OAuth Bearer tokens validated against `oAuthAccessToken` in PostgreSQL
- Session model: in-memory session map keyed by `MCP-Session-Id`
- Tool execution: uses shared generation service + BullMQ worker pipeline

---

## Available tools

- `list_styles`
  - Returns all supported SVG styles from `VALID_SVG_STYLES`
- `generate_svg`
  - Creates a `GenerationJob` and enqueues async work
  - Charges 1 credit transactionally
  - On enqueue failure, marks failed and refunds exactly once
- `get_job_status`
  - Returns job status and, when complete, the generated SVG

---

## Authentication flow (OAuth)

The MCP transport itself requires:

- `Authorization: Bearer <access_token>`

OAuth endpoints are served by the main API process (`src/app.ts`):

- Metadata: `GET /.well-known/oauth-authorization-server`
- Dynamic client registration: `POST /oauth/register`
- Authorization: `GET /oauth/authorize` + `POST /oauth/authorize`
- Token exchange/refresh: `POST /oauth/token`

Notes:

- Scope is `mcp`
- PKCE `S256` is required for authorization-code flow
- Access tokens are persisted in DB and checked for expiration/revocation

---

## MCP HTTP endpoints

Implemented in `src/mcp-server.ts`:

- `POST /mcp`
  - Auth required
  - New session on first `initialize`
  - Existing session when `MCP-Session-Id` header is present
  - Applies plan-aware rate limiting (`createPlanRateLimiter`)
- `GET /mcp`
  - Auth required
  - Requires `MCP-Session-Id`
  - Handles server-to-client stream polling for existing session
- `DELETE /mcp`
  - Auth required
  - Closes and removes the session transport
- `GET /mcp/health`
  - Liveness probe

Notification behavior:

- JSON-RPC notifications (no `id`) return `202 Accepted`

---

## Local development

Run all required processes:

```bash
# Terminal 1: API (OAuth endpoints)
npm run dev

# Terminal 2: Worker (async job processing)
npm run worker:dev

# Terminal 3: MCP transport server
npm run mcp:dev
```

Optional infra bootstrap:

```bash
docker compose up -d redis db
```

Default MCP port is `MCP_PORT` (3001).

---

## Deployment model

Production deploys this as a third workload next to API + worker.

- API deployment: REST, OAuth, auth/session APIs
- Worker deployment: BullMQ processing
- MCP deployment: Streamable HTTP MCP transport

All three use the same image with different entry commands.

---

## Reliability notes

- Session state is in-memory per MCP pod; load balancing should preserve session affinity for active sessions.
- Tool calls are built to be idempotent-safe where possible via transactional claim/refund patterns.
- Final SVG content is sanitized before persistence by worker pipeline.
