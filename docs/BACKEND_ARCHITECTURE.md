# Backend Architecture

This document describes the **backend (this repo)** architecture and runtime flows for ChatSVG.

- **Production API:** https://api.chatsvg.dev
- **Frontend:** https://chatsvg.dev
- **Infrastructure:** `INFRA.md`
- **System diagram:** `SYSTEM_ARCHITECTURE.md`

---

## Runtime overview

```mermaid
flowchart TB
  Client[Clients\nBrowser / Frontend] -->|HTTPS + cookies| Ingress[Traefik Ingress\nTLS termination\nHost routing]
  Ingress --> ApiSvc[Service\nClusterIP\nchatsvg-api]
  ApiSvc --> API[API Pods\nNode.js/Express\n`src/server.ts` + `src/app.ts`]

  API --> Routes[Routes\n`src/routes/*`]
  Routes --> Auth[Auth\n`src/routes/auth.routes.ts`]
  Routes --> Svg[SVG\n`src/routes/svg.routes.ts`]
  Routes --> User[User\n`src/routes/user.routes.ts`]

  API --> Prisma[Prisma\n`src/lib/prisma.ts`]
  Prisma --> Postgres[(PostgreSQL\nNeon)]

  API --> Redis[(Redis\nAWS ElastiCache)]

  Svg --> Queue[enqueueSvgGenerationJob\n`src/jobs/svgGenerationQueue.ts`]
  Queue --> Redis

  Redis --> Worker[Worker Pods\nBullMQ\n`src/workers/svgGenerationWorker.ts`]
  Worker --> OpenAI[OpenAI\n`src/services/aiService.ts`]
  Worker --> Sanitize[sanitizeInput/sanitizeSvg\n`src/utils/*`]
  Worker --> Prisma
  Worker --> S3[(AWS S3\nGenerated SVG artifacts)]

  API -->|presign download URL| S3
  API --> Realtime[Socket.IO\njob updates\n`src/realtime/*`]
```

---

## HTTP entry points

- `src/server.ts`: boots the HTTP server and Socket.IO.
- `src/app.ts`: Express app setup (middleware, routing, error handling).

---

## Authentication & session model

Auth is cookie-based.

- Access token: short-lived JWT (`token` cookie)
- Refresh token: long-lived, stored hashed in the DB (`refreshToken` cookie)
- Rotation + reuse detection: reusing an old refresh token revokes the full token family
- CSRF protection: double-submit cookie pattern for state-changing requests

For detailed flows: `AUTHENTICATION.md`.

---

## Async SVG generation (API → queue → worker)

SVG generation is asynchronous so API requests stay fast even with long OpenAI latencies.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant API as API
  participant DB as Postgres
  participant R as Redis (BullMQ)
  participant W as Worker
  participant O as OpenAI
  participant S3 as S3

  C->>API: POST /api/svg/generate-svg
  API->>API: validate + sanitize input
  API->>DB: create GenerationJob (QUEUED)
  API->>R: enqueue job (jobId)
  API-->>C: 202 + jobId

  W->>R: claim job
  W->>DB: mark RUNNING + charge credits (transactional)
  W->>O: generate SVG
  O-->>W: SVG
  W->>W: sanitize SVG
  W->>S3: upload artifact
  W->>DB: create SvgGeneration + link job.generationId
  W-->>R: mark complete
```

Notes:

- Jobs are created with an idempotency key (optional) to safely retry requests.
- Worker failures refund credits on permanent failure.

For deeper details: `ASYNC_GENERATION.md`.

---

## Download flow (signed URLs)

Generated files are stored in S3. The API returns short-lived signed URLs for downloads.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant API as API
  participant DB as Postgres
  participant S3 as S3

  C->>API: GET /api/svg/:generationId/download (auth)
  API->>DB: verify ownership + read s3Key
  API->>S3: create signed URL (GetObject)
  API-->>C: { downloadUrl } (no-store)
  C->>S3: GET downloadUrl
  S3-->>C: SVG file
```

---

## Data & services

- PostgreSQL (Neon): users, sessions, job metadata, generation metadata
- Redis (ElastiCache): BullMQ queues and coordination
- S3: generated SVG artifacts + signed download URLs

---

## CI/CD (high level)

- GitHub Actions builds Docker images and pushes to ECR.
- A self-hosted runner on the EC2 instance updates k3s deployments via `kubectl set image`.

See: `INFRA.md`.
