# Copilot Instructions for `server`

## Big picture

- This is a TypeScript Express API for async AI SVG generation; HTTP API and worker are separate processes.
- Request flow: route creates `GenerationJob` -> enqueue BullMQ job -> worker generates SVG -> persist `SvgGeneration` + job status -> notify via Socket.IO.
- Start with: `src/app.ts`, `src/routes/svg.routes.ts`, `src/services/svgGenerationService.ts`, `src/workers/svgGenerationWorker.ts`, `src/realtime/*`.
- Data model and constraints live in `prisma/schema.prisma`; job status transitions (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`) are central.

## Boundaries and shared logic

- Web app endpoints use `/api/*` (cookie auth + CSRF). Public developer API uses `/v1/*` (API key auth, open CORS, no CSRF).
- Keep generation business logic in `src/services/svgGenerationService.ts`; both `/api/svg` and `/v1/svg` call it.
- Keep credit charging + job flag changes atomic with Prisma transactions (see both `svg.routes.ts` and `v1.routes.ts`).
- Idempotency is required: use `x-idempotency-key` + `computeRequestHash()` and return existing job for duplicates.

## Security and middleware conventions

- `src/app.ts` applies `generateCsrfToken` globally and `validateCsrfToken` on state-changing `/api/*` routes.
- Auth patterns: `authMiddleware` for required session auth, `optionalAuthMiddleware` for mixed public/private reads.
- Rate limiting is Redis-backed and fail-open if Redis is down (`src/middleware/rateLimiter.ts`).
- Quota checks are in `monthlyGenerationQuota()` and are bypassed in test env (`IS_TEST`).

## Worker and reliability patterns

- Worker retries must be idempotent: always re-read DB state and short-circuit if already completed.
- Use conditional `updateMany` for state claims/refunds to prevent double-processing (claim/refund pattern).
- On enqueue failure, mark job failed and refund credits only once (`creditsRefunded` guard).
- SVG output must be sanitized (`sanitizeSvg`) before persistence/upload.

## External integrations

- Redis: queue + cache + rate limiting.
- OpenAI: generation in `src/services/aiService.ts`.
- S3/CloudFront: asset storage and public URL building (`src/lib/s3.ts`, `PUBLIC_ASSETS_BASE_URL`).
- Socket.IO: authenticated by `token` cookie in `src/server.ts`; optional Redis adapter for multi-instance fanout.

## Dev workflows

- Install: `npm ci`
- API dev: `npm run dev` (or `npm run dev:local` to boot docker `redis` + `db` first)
- Worker dev (required for async completion): `npm run worker:dev`
- Tests: `npm test` (Jest + ts-jest), coverage enabled by default.
- Prisma: `npm run prisma:generate`, `npm run prisma:migrate`

## Test conventions

- Tests live under `src/**/*.test.ts` (many route tests in `src/routes/__tests__`).
- `jest.setup.js` globally mocks BullMQ and Redis; keep tests isolated from real infra.
- Common style: route-level tests with `supertest`, mocked Prisma modules, and explicit assertions on transaction behavior.

## Environment gotchas

- `src/config/env.ts` validates many vars at startup (JWT, OpenAI, Resend, OAuth), so missing env vars fail fast.
- In production, `TRUST_PROXY` defaults to `1`; this affects `req.ip` and rate-limit identity.
