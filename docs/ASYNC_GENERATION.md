# Async SVG Generation with BullMQ

## Overview

SVG generation now runs asynchronously through a **BullMQ** queue, decoupling the HTTP layer from OpenAI's latency. This enables horizontal scaling, reliable retries, and better UX (no long-blocking requests).

---

## Architecture

```
┌─────────┐      POST /generate-svg       ┌─────────┐
│ Client  │ ──────────────────────────────▶│   API   │
└─────────┘                                 └─────────┘
  │                                           │
  │  202 Accepted                             │ 1. Validate input
  │  job: { id, status: "QUEUED" }            │ 2. Create GenerationJob
  │                                           │ 3. Enqueue to Redis
  │◀─────────────────────────────────────────┘
  │
  │      Socket.IO: generation-job:update
  │◀───────────────────────────────────────────────
  │   { jobId, status, progress?, generationId? }
  │
  │      GET /generation-jobs/:id (optional)
  │ ─────────────────────────────────────▶
  │  { job: { status: "SUCCEEDED", ... },
  │    credits: 95 }
  │◀─────────────────────────────────────┘
  │
  │                                       ┌──────────┐
  │                                       │  Worker  │◀──Redis Queue
  │                                       └──────────┘
  │                                            │
  │                                            │ 1. Claim job
  │                                            │ 2. Charge credits
  │                                            │ 3. Generate SVG
  │                                            │ 4. Store result
  │                                            │ 5. Mark SUCCEEDED
```

---

## Components

### 1. Queue (`src/jobs/svgGenerationQueue.ts`)

- **BullMQ Queue** configured with:
  - 3 retry attempts with exponential backoff (5s base)
  - Job retention: 1 hour for success, 24 hours for failures
  - Idempotent enqueuing by `jobId`

**Key function:**

```ts
enqueueSvgGenerationJob(jobId: string, userId: string)
```

Enqueues a job or silently ignores if the job already exists (prevents duplicates during retries or race conditions).

The BullMQ job data includes `jobId` and `userId` so realtime status updates can be routed to the correct user.

### 2. Worker (`src/workers/svgGenerationWorker.ts`)

Processes jobs from the queue with the following steps:

1. **Claim the job** – Atomically transition `QUEUED → RUNNING`
2. **Charge credits** – Transactional debit with `creditsCharged` flag
3. **Generate SVG** – Call OpenAI API
4. **Sanitize & Store** – Clean the SVG and persist `SvgGeneration`
5. **Mark success** – Update job to `SUCCEEDED` and link `generationId`
6. **Refund on failure** – If final attempt fails, atomically refund credits with `creditsRefunded` flag

**Error Mapping:**

- `INSUFFICIENT_CREDITS` – User ran out of credits
- `OPENAI_RATE_LIMIT` – Hit OpenAI rate limit (429)
- `OPENAI_MODEL_NOT_FOUND` – Invalid model (404)
- `OPENAI_PERMISSION` – Auth issue (401/403)
- `REDIS_DOWN` – Redis connection lost
- `VALIDATION_ERROR` – Invalid input
- `DATABASE_ERROR` – Prisma/DB failure
- `GENERATION_FAILED` – Generic error

**Retry Logic:**

- Non-final failures reset status to `QUEUED` so retry can reclaim
- Final failures refund credits and mark `FAILED`

### 3. API Routes (`src/routes/svg.routes.ts`)

#### POST `/api/svg/generate-svg`

**Request:**

```json
{
  "prompt": "A mountain landscape at sunset",
  "style": "minimalist",
  "model": "gpt-4o",
  "privacy": false
}
```

**Response (202 Accepted):**

```json
{
  "job": {
    "id": "cm5abc123...",
    "status": "QUEUED",
    "prompt": "A mountain landscape at sunset",
    "style": "minimalist",
    "model": "gpt-4o",
    "privacy": false,
    "createdAt": "2025-12-29T10:00:00.000Z",
    "startedAt": null,
    "finishedAt": null,
    "errorCode": null,
    "errorMessage": null,
    "generationId": null,
    "generation": null
  },
  "queue": {
    "waiting": 2,
    "delayed": 0,
    "active": 1
  }
}
```

**Headers:**

- `Location: /api/svg/generation-jobs/cm5abc123...`
- Optional `x-idempotency-key` for duplicate prevention

**Idempotency:**

- If `x-idempotency-key` matches an existing job with **same parameters** → return existing job (200 or 202)
- If `x-idempotency-key` matches an existing job with **different parameters** → reject with 409
- Request hash (SHA-256 of prompt + style + model + privacy) prevents parameter mismatches

#### GET `/api/svg/generation-jobs/:id`

**Response (QUEUED/RUNNING - 200):**

```json
{
  "job": {
    "id": "cm5abc123...",
    "status": "RUNNING",
    "prompt": "A mountain landscape at sunset",
    "style": "minimalist",
    "model": "gpt-4o",
    "createdAt": "2025-12-29T10:00:00.000Z",
    "startedAt": "2025-12-29T10:00:05.000Z",
    "finishedAt": null,
    "errorCode": null,
    "errorMessage": null,
    "generationId": null,
    "generation": null
  }
}
```

**Response (SUCCEEDED - 200):**

```json
{
  "job": {
    "id": "cm5abc123...",
    "status": "SUCCEEDED",
    "prompt": "A mountain landscape at sunset",
    "style": "minimalist",
    "model": "gpt-4o",
    "createdAt": "2025-12-29T10:00:00.000Z",
    "startedAt": "2025-12-29T10:00:05.000Z",
    "finishedAt": "2025-12-29T10:00:12.000Z",
    "errorCode": null,
    "errorMessage": null,
    "generationId": "cm5def456...",
    "generation": {
      "id": "cm5def456...",
      "prompt": "A mountain landscape at sunset",
      "style": "minimalist",
      "model": "gpt-4o",
      "privacy": false,
      "svg": "<svg>...</svg>",
      "createdAt": "2025-12-29T10:00:12.000Z"
    }
  },
  "credits": 95
}
```

**Response (FAILED - 200):**

```json
{
  "job": {
    "id": "cm5abc123...",
    "status": "FAILED",
    "prompt": "A mountain landscape at sunset",
    "style": "minimalist",
    "model": "gpt-4o",
    "createdAt": "2025-12-29T10:00:00.000Z",
    "startedAt": "2025-12-29T10:00:05.000Z",
    "finishedAt": "2025-12-29T10:00:30.000Z",
    "errorCode": "OPENAI_RATE_LIMIT",
    "errorMessage": "Rate limit exceeded. Please try again later.",
    "generationId": null,
    "generation": null
  },
  "credits": 100
}
```

**Credits Field:**

- Only returned when job is in a terminal state (`SUCCEEDED` or `FAILED`)
- Reflects the user's remaining credits after the job completed
- Frontend can update the balance immediately without a separate API call

### Realtime Updates (Socket.IO)

The API emits job state changes over Socket.IO so the client does not need to poll.

- Event: `generation-job:update`
- Payload: `{ jobId, status, progress?, generationId?, errorCode?, errorMessage? }`
- Delivery: server joins the socket to `user:<userId>` during the authenticated handshake and emits updates to that room

Recommended client flow:

1. `POST /api/svg/generate-svg` → get `job.id`
2. Listen for `generation-job:update` for that `jobId`
3. On terminal status, do one `GET /api/svg/generation-jobs/:id` to fetch the full record (SVG, credits, etc.)

**Multi-instance:** enable the Socket.IO Redis adapter with `SOCKET_IO_REDIS_ADAPTER=true` (defaults to enabled in production unless explicitly set to `false`).

---

## Database Schema

### GenerationJob

```prisma
model GenerationJob {
  id               String              @id @default(cuid())
  userId           String
  prompt           String
  style            String
  model            String
  privacy          Boolean             @default(false)
  status           GenerationJobStatus @default(QUEUED)
  createdAt        DateTime            @default(now())
  startedAt        DateTime?
  finishedAt       DateTime?
  errorCode        String?
  errorMessage     String?
  generationId     String?             @unique
  idempotencyKey   String?
  requestHash      String
  creditsCharged   Boolean             @default(false)
  creditsRefunded  Boolean             @default(false)
  attemptsMade     Int                 @default(0)
  lastStartedAt    DateTime?
  lastFailedAt     DateTime?

  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  generation SvgGeneration? @relation(fields: [generationId], references: [id])

  @@unique([userId, idempotencyKey])
  @@index([userId, createdAt])
}

enum GenerationJobStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
}
```

**Key Fields:**

- `requestHash` – SHA-256 hash of request parameters for idempotency validation
- `creditsCharged` – Prevents double-charging on retries
- `creditsRefunded` – Prevents double-refunds on failure
- `attemptsMade` – Tracks retry count
- `lastStartedAt` / `lastFailedAt` – Debugging and observability

---

## Credits Management

### Charging Flow

1. Worker atomically checks `creditsCharged` flag
2. If not charged yet:
   - Transaction: `updateMany` user credits where `credits > 0` AND set `creditsCharged = true`
   - If `updateMany` returns 0 rows → insufficient credits → fail job
3. Continue with generation

**Why atomic?**

- Prevents double-charging if job retries after crash
- Prevents race if multiple workers claim same job (only one succeeds)

### Refunding Flow

1. On final failure, worker fetches `userId` from job
2. Transaction:
   - `updateMany` job where `creditsCharged = true AND creditsRefunded = false AND generationId = null`
   - If updated → increment user credits
3. Log refund event

**Why atomic?**

- Prevents double-refunds if worker crashes after refund
- Prevents lost refunds if worker crashes before refund
- Only refunds if generation didn't succeed

---

## Idempotency

### Client-Side

1. Frontend generates UUIDv4 for each request
2. Sends `x-idempotency-key: <uuid>` header
3. If request fails (network timeout, 5xx), retry with **same key**
4. Backend returns existing job if key matches + params identical

### Server-Side

1. Compute `requestHash = SHA256(prompt + style + model + privacy)`
2. Check for existing job with same `userId` + `idempotencyKey`
3. If found:
   - If `requestHash` matches → return existing job (200/202)
   - If `requestHash` differs → reject with 409 Conflict
4. If not found → create new job and enqueue

**Race Condition Handling:**

- If two requests with same key arrive simultaneously, one creates the job and the other catches a Prisma `P2002` (unique constraint violation)
- The second request fetches the job created by the first and validates the `requestHash`

---

## Deployment

### Local Development

```bash
# Terminal 1: Start Redis + Postgres
docker compose up -d redis db

# Terminal 2: Start API
npm run dev

# Terminal 3: Start worker
npm run worker:dev
```

### Production (Render / Fly / Railway)

1. **Provision Redis** (Upstash, Render Redis, etc.)
   - Set `REDIS_URL=rediss://...` in environment
2. **Deploy API Service**
   - `npm run start` (runs `src/server.ts`)
   - Ensure `PORT`, `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL` are set
3. **Deploy Worker Service**
   - Same codebase, different entry point
   - `npm run worker` (runs `dist/workers/svgGenerationWorker.js`)
   - Set `SVG_WORKER_CONCURRENCY=2` (or higher for more throughput)
   - Ensure same `DATABASE_URL` and `REDIS_URL` as API

**Health Checks:**

- API: `GET /api/health` (liveness), `GET /api/ready` (readiness)
- Worker: Logs `SVG generation worker started and ready` on startup

**Scaling:**

- Horizontal: Deploy multiple worker instances (BullMQ handles job distribution)
- Vertical: Increase `SVG_WORKER_CONCURRENCY` per worker

---

## Monitoring & Observability

### Logs

- **API:** Request ID (`x-request-id`), user ID, job creation events
- **Worker:** Job ID, attempt number, error codes, completion times

**Structured Logging (Pino):**

```json
{
  "level": "info",
  "time": 1672531200000,
  "jobId": "cm5abc123...",
  "userId": "user_123",
  "msg": "SVG generation job completed"
}
```

### Metrics

Use BullMQ metrics API:

```ts
const counts = await svgGenerationQueue.getJobCounts(
  'waiting',
  'delayed',
  'active',
  'completed',
  'failed'
)
```

**Dev-only:** API returns queue stats in POST response (removed in production for performance).

### Error Tracking

- Sentry integration captures unhandled errors
- Worker logs include `errorCode` and `errorMessage` for debugging

---

## Security Considerations

### Rate Limiting

- API enforces `svgGenerationLimiter` (per-user rate limit)
- `dailyGenerationLimit(50)` middleware caps daily usage

### Input Validation

- Prompt length: 10-500 characters
- Forbidden patterns (XSS, prompt injection)
- Valid style/model enums

### Authorization

- All endpoints require `authMiddleware` (JWT validation)
- All job reads validate `userId` ownership

### Queue Security

- BullMQ job data stores `{ jobId, userId }` for routing realtime updates
- Prompts, SVG content, and credit balances remain in the database
- Worker validates job ownership via database

---

## Testing

### Unit Tests

- `generate-svg.test.ts` – Route validation, idempotency, duplicate handling
- Mock Prisma and BullMQ for isolated tests

### Integration Tests

1. Create job → verify `QUEUED` status
2. Start worker → wait for `SUCCEEDED` (Socket.IO update or `GET /generation-jobs/:id`)
3. Verify credits debited
4. Test idempotency (same key = same job)
5. Test failure refunds

### Load Testing

- Use tools like `k6` or `autocannon` to simulate concurrent requests
- Monitor Redis memory usage and worker throughput

---

## Common Issues

### Worker not processing jobs

- Check `REDIS_URL` matches between API and worker
- Verify Redis is accessible (firewall, TLS config)
- Check worker logs for connection errors

### Jobs stuck in RUNNING

- Worker crashed mid-execution → restart worker
- Job will retry after timeout or stall interval

### Double-charging credits

- Ensure `creditsCharged` flag is used
- Transaction guarantees prevent race conditions

### Idempotency key conflicts

- If params change, generate new key
- Backend enforces parameter match via `requestHash`

---

## Future Enhancements

- [ ] Priority queue (premium users get faster processing)
- [ ] Batch job support (generate multiple SVGs in one request)
- [ ] Admin dashboard (BullMQ UI for monitoring)
- [ ] Cost tracking (per-model pricing)

---

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Idempotency Patterns](https://stripe.com/docs/api/idempotent_requests)
