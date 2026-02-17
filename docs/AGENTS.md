# AI Agent Reference Guide

This document provides comprehensive context for AI agents working on the ChatSVG codebase. Use this as a reference to understand the system architecture, patterns, and implementation details.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Project Structure](#project-structure)
3. [Core Concepts](#core-concepts)
4. [Authentication & Authorization](#authentication--authorization)
5. [Plan & Subscription System](#plan--subscription-system)
6. [API Endpoints](#api-endpoints)
7. [Database Schema](#database-schema)
8. [Services & Utilities](#services--utilities)
9. [Async Job Processing](#async-job-processing)
10. [Code Patterns & Conventions](#code-patterns--conventions)
11. [Testing](#testing)
12. [Development Workflow](#development-workflow)

---

## System Overview

**ChatSVG** is a SaaS application that generates SVG images using AI (OpenAI GPT models). It consists of:

- **Backend (this repo)**: Node.js/Express REST API + BullMQ workers
- **Frontend (../client)**: React application deployed on Vercel (separate repo)
- **Infrastructure**: Kubernetes (k3s) on AWS EC2, PostgreSQL (Neon), Redis (ElastiCache), S3

### Key Technologies

- **Runtime**: Node.js 20+, TypeScript
- **Framework**: Express 5
- **Database**: PostgreSQL via Prisma ORM
- **Cache/Queue**: Redis + BullMQ
- **Storage**: AWS S3 (SVG artifacts)
- **Auth**: JWT (access tokens) + refresh tokens (rotation, reuse detection)
- **Realtime**: Socket.IO for job status updates
- **AI**: OpenAI API (gpt-5.2-2025-12-11, gpt-5-mini-2025-08-07)

### Production URLs

- Backend API: `https://api.chatsvg.dev`
- Frontend: `https://chatsvg.dev`

---

## Project Structure

```
server/
├── src/
│   ├── app.ts                    # Express app setup (middleware, routes, error handling)
│   ├── server.ts                 # HTTP server + Socket.IO bootstrap
│   ├── config/
│   │   ├── env.ts                # Environment variables & validation
│   │   └── passport.ts           # OAuth strategies (Google, GitHub)
│   ├── constants/
│   │   ├── models.ts             # Valid AI models
│   │   ├── svgStyles.ts          # Valid SVG styles
│   │   └── tokenExpiry.ts        # Token expiration constants
│   ├── jobs/
│   │   ├── svgGenerationQueue.ts # BullMQ queue setup + job enqueueing
│   │   └── cleanupExpiredTokens.ts
│   ├── lib/
│   │   ├── prisma.ts             # Prisma client singleton
│   │   ├── redis.ts              # Redis client singleton
│   │   ├── openai.ts             # OpenAI client
│   │   ├── s3.ts                 # S3 operations (upload, delete, presigned URLs)
│   │   ├── logger.ts             # Pino logger
│   │   └── cache.ts              # Redis caching utilities
│   ├── middleware/
│   │   ├── auth.ts               # authMiddleware, optionalAuthMiddleware
│   │   ├── csrf.ts               # CSRF token generation & validation
│   │   ├── rateLimiter.ts        # Unified Redis/Lua rate limiting (fixed + plan-based)
│   │   └── requestId.ts          # Request ID tracking
│   ├── realtime/
│   │   └── io.ts                 # Socket.IO setup for job updates
│   ├── routes/
│   │   ├── auth.routes.ts        # /api/auth (register, login, logout, OAuth)
│   │   ├── user.routes.ts        # /api/user (profile, generations, delete)
│   │   ├── svg.routes.ts         # /api/svg (generate-svg, cancel, etc.)
│   │   ├── plans.routes.ts       # /api/plans (plan metadata, limits, recommendation)
│   │   ├── notification.routes.ts # /api/notification
│   │   ├── support.routes.ts     # /api/support (contact form)
│   │   ├── apiKeys.routes.ts     # /api/keys (API key management)
│   │   ├── admin.routes.ts       # /api/admin (admin endpoints)
│   │   └── v1.routes.ts          # /v1 (public API for developers)
│   ├── services/
│   │   ├── aiService.ts          # OpenAI integration (prompt generation, SVG generation)
│   │   ├── emailService.ts       # Email sending (welcome, password reset, support)
│   │   ├── notificationService.ts # In-app notifications
│   │   ├── svgGenerationService.ts # Core SVG generation logic
│   │   ├── usageTrackingService.ts # Usage tracking & quota management
│   │   └── apiKeyService.ts      # API key validation & usage logging
│   ├── utils/
│   │   ├── planLimits.ts         # Plan limits, features, upgrade recommendations
│   │   ├── validateInput.ts      # Input validation (email, password, name)
│   │   ├── sanitizeInput.ts      # HTML/XSS sanitization
│   │   ├── sanitizeSvg.ts        # SVG sanitization (remove scripts, etc.)
│   │   ├── getUserId.ts          # Extract userId from req
│   │   ├── getUserIp.ts          # Extract IP from req (proxy-aware)
│   │   ├── setAuthCookie.ts      # Cookie helpers (set/clear auth cookies)
│   │   ├── refreshToken.ts       # Refresh token rotation, reuse detection
│   │   └── createPasswordResetToken.ts
│   └── workers/
│       └── svgGenerationWorker.ts # BullMQ worker (processes SVG generation jobs)
├── prisma/
│   ├── schema.prisma             # Database schema
│   └── migrations/               # Migration history
├── docs/
│   ├── AGENTS.md                 # This file
│   ├── BACKEND_ARCHITECTURE.md   # Backend architecture overview
│   ├── SYSTEM_ARCHITECTURE.md    # Full system architecture
│   ├── AUTHENTICATION.md         # Auth flows & security patterns
│   ├── ASYNC_GENERATION.md       # Async job processing details
│   └── INFRA.md                  # Infrastructure setup
├── package.json
├── tsconfig.json
└── jest.config.js
```

---

## Core Concepts

### 1. SVG Generation Flow (Async)

SVG generation is **asynchronous** to keep API responses fast:

1. User submits prompt via `POST /api/svg/generate-svg`
2. API validates input, creates `GenerationJob` in DB (status: `QUEUED`)
3. Job is enqueued to BullMQ (Redis)
4. API responds immediately with `jobId` (202 Accepted)
5. Worker picks up job, marks as `RUNNING`, charges credits
6. Worker calls OpenAI API, sanitizes SVG, uploads to S3
7. Worker creates `SvgGeneration` record, marks job as `SUCCEEDED`
8. Socket.IO notifies frontend of completion

**Key files**:

- `src/routes/svg.routes.ts` (API endpoint)
- `src/jobs/svgGenerationQueue.ts` (enqueue logic)
- `src/workers/svgGenerationWorker.ts` (worker logic)
- `src/services/svgGenerationService.ts` (core generation logic)

### 2. Credits & Quota System

Users have two types of limits:

- **Credits**: Rolling refill model (`startingCredits`, `creditRefillAmount`, `creditRefillDays`)
- **Generations**: Unified monthly generation quota (`generationsPerMonth`)

Credits are charged **before** generation starts (in worker). If generation fails, credits are refunded.

**Key files**:

- `src/utils/planLimits.ts` (plan definitions)
- `src/services/usageTrackingService.ts` (quota tracking)

### 3. API Access

Users can create API keys to access the public API (`/v1/*` endpoints). Both plans currently have API access (`FREE`: 1 key, `SUPPORTER`: 5 keys).

**Key files**:

- `src/routes/apiKeys.routes.ts` (key management)
- `src/routes/v1.routes.ts` (public API)
- `src/services/apiKeyService.ts` (validation, logging)

---

## Authentication & Authorization

### Auth Model

- **Access tokens**: Short-lived JWT (15 minutes), stored in `token` cookie
- **Refresh tokens**: Long-lived (7 days default, 30 days with "remember me"), stored in DB (hashed) + `refreshToken` cookie
- **Rotation**: Every refresh generates a new token and revokes the old one
- **Reuse detection**: If an old refresh token is reused, the entire token family is revoked (security)

### CSRF Protection

All state-changing requests require CSRF token validation. Token is stored in `csrf-token` cookie and must be sent in `X-CSRF-Token` header.

### Middleware

- `authMiddleware`: Requires valid JWT, sets `req.user = { userId }`
- `optionalAuthMiddleware`: Allows both authenticated and anonymous requests
- `validateCsrfToken`: Validates CSRF token on POST/PUT/DELETE

**Key files**:

- `src/middleware/auth.ts`
- `src/middleware/csrf.ts`
- `src/utils/refreshToken.ts`
- `docs/AUTHENTICATION.md`

### OAuth

Supports Google and GitHub OAuth via Passport.js. On OAuth success, creates/finds user, generates tokens, sets cookies, redirects to frontend.

### Email Auth Feature Flag

Email/password routes are runtime-gated by `ENABLE_EMAIL_AUTH` (see `src/config/env.ts`).

- When `ENABLE_EMAIL_AUTH=true` (default): email auth routes work normally.
- When `ENABLE_EMAIL_AUTH=false`: `register`, `login`, `forgot-password`, and `reset-password` return `403` with `errorCode: EMAIL_AUTH_DISABLED`.

Frontend capability discovery endpoint:

- `GET /api/auth/options` returns:
  - `emailAuthEnabled: boolean`
  - `oauthProviders: string[]` (currently `google`, `github`)

**Key files**:

- `src/config/passport.ts` (strategies)
- `src/routes/auth.routes.ts` (OAuth routes)

---

## Plan & Subscription System

### Plan Types

- `FREE`: 100 starting credits, 50 credits every 30 days, 100 generations/month, API access (1 key max)
- `SUPPORTER`: 1000 starting credits, 500 credits every 30 days, 1000 generations/month, API access (5 keys max)

### Plan Limits

Defined in `src/utils/planLimits.ts`:

```typescript
export interface PlanLimits {
  startingCredits: number
  creditRefillAmount: number
  creditRefillDays: number
  generationsPerMonth: number
  apiAccess: boolean
  maxApiKeys: number
  rateLimits: { perMinute: number; perHour: number; perDay: number }
  supportLevel: 'community' | 'email' | 'priority'
  supportChannel?: 'email' | 'discord'
}
```

### Utility Functions

- `getPlanLimits(plan)`: Get full limits object
- `hasFeature(plan, feature)`: Check if plan has a specific feature
- `canCreateApiKey(plan, currentKeyCount)`: Check if user can create more API keys
- `getUpgradeRecommendation(currentPlan, usage)`: Get upgrade suggestion based on usage

### API Endpoints

- `GET /api/plans`: List all plans with metadata (public, cacheable)
- `GET /api/plans/limits/:plan`: Get limits for a specific plan
- `GET /api/plans/has-feature?plan=SUPPORTER&feature=apiAccess`: Check feature availability
- `GET /api/plans/can-create-api-key?plan=SUPPORTER&currentKeyCount=2`: Check API key creation eligibility
- `POST /api/plans/recommendation`: Get upgrade recommendation (requires `currentPlan` and `usage` in body)

**Key files**:

- `src/utils/planLimits.ts` (plan definitions + utilities)
- `src/routes/plans.routes.ts` (plan API endpoints)

---

## API Endpoints

### Authentication (`/api/auth`)

| Method | Endpoint           | Auth | Description                    |
| ------ | ------------------ | ---- | ------------------------------ |
| GET    | `/options`         | No   | Auth capabilities for frontend |
| POST   | `/register`        | No   | Register new user              |
| POST   | `/login`           | No   | Login (email/password)         |
| POST   | `/logout`          | Yes  | Logout (revoke refresh token)  |
| POST   | `/refresh`         | No   | Refresh access token           |
| GET    | `/current-user`    | Yes  | Get current user data          |
| POST   | `/forgot-password` | No   | Request password reset         |
| POST   | `/reset-password`  | No   | Reset password with token      |
| GET    | `/google`          | No   | Start Google OAuth             |
| GET    | `/google/callback` | No   | Google OAuth callback          |
| GET    | `/github`          | No   | Start GitHub OAuth             |
| GET    | `/github/callback` | No   | GitHub OAuth callback          |
| GET    | `/sessions`        | Yes  | List active sessions           |
| DELETE | `/sessions/:id`    | Yes  | Revoke specific session        |

### User (`/api/user`)

| Method | Endpoint           | Auth | Description                             |
| ------ | ------------------ | ---- | --------------------------------------- |
| GET    | `/me`              | Yes  | Get user profile + stats                |
| GET    | `/generations`     | Yes  | List user's SVG generations (paginated) |
| DELETE | `/generations/:id` | Yes  | Delete specific generation              |

### SVG Generation (`/api/svg`)

| Method | Endpoint             | Auth | Description               |
| ------ | -------------------- | ---- | ------------------------- |
| POST   | `/generate-svg`      | Yes  | Create SVG generation job |
| GET    | `/job/:jobId`        | Yes  | Get job status            |
| POST   | `/cancel-job/:jobId` | Yes  | Cancel pending job        |

### Plans (`/api/plans`)

| Method | Endpoint              | Auth | Description                        |
| ------ | --------------------- | ---- | ---------------------------------- |
| GET    | `/`                   | No   | List all plans (public, cacheable) |
| GET    | `/limits/:plan`       | No   | Get limits for specific plan       |
| GET    | `/has-feature`        | No   | Check feature availability         |
| GET    | `/can-create-api-key` | No   | Check API key eligibility          |
| POST   | `/recommendation`     | No   | Get upgrade recommendation         |

### API Keys (`/api/keys`)

| Method | Endpoint | Auth | Description          |
| ------ | -------- | ---- | -------------------- |
| GET    | `/`      | Yes  | List user's API keys |
| POST   | `/`      | Yes  | Create new API key   |
| DELETE | `/:id`   | Yes  | Delete API key       |

### Public API (`/v1`)

| Method | Endpoint        | Auth    | Description                        |
| ------ | --------------- | ------- | ---------------------------------- |
| POST   | `/svg/generate` | API Key | Create SVG generation job          |
| GET    | `/svg/job/:id`  | API Key | Get SVG generation job status/data |

### Notifications (`/api/notification`)

| Method | Endpoint | Auth | Description                |
| ------ | -------- | ---- | -------------------------- |
| GET    | `/`      | Yes  | List user notifications    |
| PUT    | `/read`  | Yes  | Mark notifications as read |

### Support (`/api/support`)

| Method | Endpoint   | Auth     | Description            |
| ------ | ---------- | -------- | ---------------------- |
| POST   | `/contact` | Optional | Submit support message |

### Admin (`/api/admin`)

| Method | Endpoint             | Auth  | Description         |
| ------ | -------------------- | ----- | ------------------- |
| GET    | `/stats`             | Admin | Get system stats    |
| POST   | `/users/:id/credits` | Admin | Adjust user credits |

---

## Database Schema

### Key Models

#### `User`

- `id`: cuid
- `email`: unique
- `passwordHash`: bcrypt (nullable for OAuth users)
- `name`: display name
- `provider`: EMAIL | GOOGLE | GITHUB
- `plan`: FREE | SUPPORTER
- `credits`: monthly allowance
- `avatar`: URL
- `generationsQuotaLimit/Used/ResetAt`: unified generation quota
- Relations: `generations`, `refreshTokens`, `generationJobs`, `apiKeys`

#### `SvgGeneration`

- `id`: cuid
- `userId`: FK to User
- `prompt`: user's prompt
- `svg`: generated SVG code
- `style`: SVG style (outline, duotone, etc.)
- `model`: AI model used
- `creditsUsed`: credits charged
- `privacy`: public/private
- `s3Key`: S3 object key
- `createdAt`: timestamp

#### `GenerationJob`

- `id`: cuid
- `userId`: FK to User
- `prompt`, `style`, `model`, `privacy`: generation params
- `status`: QUEUED | RUNNING | SUCCEEDED | FAILED
- `createdAt`, `startedAt`, `finishedAt`: timestamps
- `errorCode`, `errorMessage`: failure info
- `creditsCharged`, `creditsRefunded`: billing flags
- `attemptsMade`: retry count
- `idempotencyKey`: for safe retries
- `generationId`: FK to SvgGeneration (nullable)
- `source`: WEB_APP | API
- `apiKeyId`: FK to ApiKey (nullable)
- AI metrics: `aiModel`, `aiPromptTokens`, `aiCompletionTokens`, `aiLatencyMs`

#### `RefreshToken`

- `id`: cuid
- `token`: hashed refresh token (unique)
- `userId`: FK to User
- `familyId`: token family (for reuse detection)
- `createdAt`, `expiresAt`, `lastUsedAt`: timestamps
- `revokedAt`: revocation timestamp
- `replacedByTokenId`: FK to new token (for rotation)
- `ipAddress`, `userAgent`: session metadata

#### `ApiKey`

- `id`: cuid
- `userId`: FK to User
- `name`: user-friendly name
- `keyHash`: bcrypt hash of API key
- `lastUsedAt`: last usage timestamp
- `createdAt`: creation timestamp

#### `Notification`

- `id`: cuid
- `userId`: FK to User
- `type`: JOB_SUCCEEDED | JOB_FAILED | LOW_CREDITS | PROMO_MONTHLY | CREDITS_PURCHASED | CREDITS_REFUNDED | ACCOUNT_SECURITY | SYSTEM_ANNOUNCEMENT
- `message`: notification text
- `isRead`: boolean
- `createdAt`: timestamp

**Full schema**: `prisma/schema.prisma`

---

## Services & Utilities

### Services (`src/services/`)

#### `aiService.ts`

- `generateSvg(prompt, style, model)`: Calls OpenAI to generate SVG
- Uses strict system prompt + style-specific constraints
- Uses one style-matched few-shot example per request
- Validates SVG tags and structure against allow-list rules
- Performs one targeted repair pass if first output fails validation

#### `emailService.ts`

- `sendWelcomeEmail(email, name)`: Welcome email on registration
- `sendPasswordResetEmail(email, resetToken)`: Password reset email
- `sendSupportMessageEmail(payload, metadata)`: Support form submission
- Uses nodemailer or email provider

#### `notificationService.ts`

- `createWelcomeNotification(userId, name)`: Create welcome notification
- `createNotification(userId, type, message)`: Generic notification creation

#### `svgGenerationService.ts`

- `processSvgGenerationJob(jobId)`: Main worker logic
- Orchestrates: charge credits → call AI → sanitize → upload S3 → save DB → notify

#### `usageTrackingService.ts`

- `trackGenerationUsage(userId)`: Increment generation quota
- `hasRemainingGenerations(userId)`: Check if user can generate more
- `resetQuotaIfNeeded(user)`: Reset quota on new billing cycle

#### `apiKeyService.ts`

- `validateApiKey(keyPrefix)`: Validate and return API key details
- `logApiKeyUsage(apiKeyId, endpoint, generationJobId)`: Log API usage

### Utilities (`src/utils/`)

#### `planLimits.ts`

- `PLAN_LIMITS`, `PLAN_NAMES`, `PLAN_PRICES`, `PLAN_DESCRIPTIONS`: Constants
- `getPlanLimits(plan)`: Get limits
- `hasFeature(plan, feature)`: Check feature
- `canCreateApiKey(plan, count)`: Check API key eligibility
- `getUpgradeRecommendation(plan, usage)`: Get upgrade suggestion

#### `validateInput.ts`

- `validateEmail(email)`: Email validation
- `validatePassword(password)`: Password strength check
- `validateName(name)`: Name validation

#### `sanitizeInput.ts`

- `sanitizeInput(input)`: HTML/XSS sanitization (DOMPurify)

#### `sanitizeSvg.ts`

- `sanitizeSvg(svgString)`: Remove scripts, event handlers, external resources from SVG

#### `refreshToken.ts`

- `createRefreshToken(userId, expiryDays, ip, userAgent)`: Create new refresh token
- `verifyAndRotateRefreshToken(oldToken, expiryDays, ip, userAgent)`: Rotate token
- `revokeRefreshToken(plainToken)`: Revoke token
- `revokeAllUserTokens(userId)`: Revoke all tokens for user (security)

#### `getUserId.ts`

- `getUserId(req)`: Extract userId from JWT (returns `undefined` if not authenticated)
- `requireUserId(req)`: Extract userId (throws if not authenticated)

#### `getUserIp.ts`

- `getUserIp(req)`: Extract client IP (proxy-aware via `X-Forwarded-For`)

#### `setAuthCookie.ts`

- `setAccessTokenCookie(res, token)`: Set access token cookie
- `setRefreshTokenCookie(res, token, rememberMe)`: Set refresh token cookie
- `clearAuthCookie(res)`: Clear all auth cookies

---

## Async Job Processing

SVG generation uses **BullMQ** (Redis-backed queue) for async processing.

### Why Async?

- OpenAI API calls can take 5-30 seconds
- Keeps API responses fast (202 Accepted)
- Allows retries on failures
- Scales workers independently

### Flow

1. **API enqueues job**: `enqueueSvgGenerationJob(jobId, jobData)`
2. **Worker picks up job**: `svgGenerationWorker.ts` listens to queue
3. **Worker processes**: Calls `processSvgGenerationJob(jobId)` from `svgGenerationService.ts`
4. **Worker updates DB**: Marks job as SUCCEEDED/FAILED
5. **Worker emits event**: Socket.IO notifies frontend

### Job States

- `QUEUED`: Job created, waiting for worker
- `RUNNING`: Worker processing
- `SUCCEEDED`: Success
- `FAILED`: Permanent failure (refund credits)

### Idempotency

Jobs support `idempotencyKey` to safely retry requests without duplicate charges.

**Key files**:

- `src/jobs/svgGenerationQueue.ts` (queue setup)
- `src/workers/svgGenerationWorker.ts` (worker)
- `src/services/svgGenerationService.ts` (job processing logic)
- `docs/ASYNC_GENERATION.md`

---

## Code Patterns & Conventions

### Error Handling

```typescript
try {
  // operation
  res.json({ success: true })
} catch (error) {
  logger.error({ error, userId: getUserId(req) }, 'Operation failed')
  res.status(500).json({ error: 'Internal server error' })
}
```

Always log errors with context (userId, requestId, etc.)

### Input Validation

```typescript
// Sanitize first
let email = sanitizeInput(req.body.email?.toLowerCase() || '')

// Then validate
const emailError = validateEmail(email)
if (emailError) {
  return res.status(400).json({ error: emailError })
}
```

### Auth Middleware

```typescript
router.get('/protected', authMiddleware, async (req, res) => {
  const userId = requireUserId(req)
  // userId is guaranteed to exist
})

router.get('/optional', optionalAuthMiddleware, async (req, res) => {
  const userId = getUserId(req) // may be undefined
})
```

### CSRF Protection

All state-changing routes use `validateCsrfToken`:

```typescript
router.post('/action', validateCsrfToken, authMiddleware, async (req, res) => {
  // CSRF token validated
})
```

### Rate Limiting

```typescript
router.post('/expensive', rateLimiter, async (req, res) => {
  // Rate limited
})
```

Limiters defined in `src/middleware/rateLimiter.ts`

### Database Queries

```typescript
// Use select to avoid exposing sensitive fields
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { id: true, email: true, name: true }, // no passwordHash
})
```

### Pagination

```typescript
const generations = await prisma.svgGeneration.findMany({
  where: { userId },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
})

const hasMore = generations.length > limit
const items = hasMore ? generations.slice(0, -1) : generations
const nextCursor = hasMore ? items[items.length - 1]!.id : null
```

---

## Testing

### Test Setup

- **Framework**: Jest
- **Test DB**: PostgreSQL (separate test database)
- **Test environment**: `NODE_ENV=test`

### Running Tests

```bash
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage
```

### Test Patterns

```typescript
import request from 'supertest'
import app from '../app'
import prisma from '../lib/prisma'

describe('POST /api/auth/register', () => {
  beforeAll(async () => {
    // Setup
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'Test123!', name: 'Test' })
      .expect(201)

    expect(res.body.user).toHaveProperty('id')
  })
})
```

---

## Development Workflow

### Local Setup

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Start local services (Redis, Postgres)
docker compose up -d redis db

# Run migrations
npm run prisma:migrate

# Start dev server
npm run dev

# Start worker (in separate terminal)
npm run worker:dev
```

### Environment Variables

Key variables in `.env`:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: JWT signing secret
- `OPENAI_API_KEY`: OpenAI API key
- `AWS_*`: S3 credentials
- `FRONTEND_URL`: Frontend URL (CORS)
- `GOOGLE_CLIENT_ID/SECRET`: OAuth credentials
- `GITHUB_CLIENT_ID/SECRET`: OAuth credentials
- `ENABLE_EMAIL_AUTH`: feature flag for email/password routes
- `TRUST_PROXY`: proxy hop/boolean setting for correct IP resolution
- `PUBLIC_ASSETS_BASE_URL`: public URL prefix for generated SVG assets

### Git Workflow

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes, test locally
3. Commit with descriptive messages
4. Push and create PR
5. CI runs tests automatically
6. Merge after review

### Deployment

CI/CD via GitHub Actions:

1. Push to `main` triggers build
2. Build Docker images (API + worker)
3. Push to AWS ECR
4. Self-hosted runner deploys to k3s via `kubectl`

---

## Common Tasks for AI Agents

### Adding a New API Endpoint

1. Define route in appropriate file (`src/routes/*.routes.ts`)
2. Add middleware (auth, CSRF, rate limiting)
3. Implement handler with validation
4. Add tests in `src/routes/__tests__/`
5. Update this doc if it's a key endpoint

### Modifying Database Schema

1. Edit `prisma/schema.prisma`
2. Run `npm run prisma:migrate` to create migration
3. Update types in code (Prisma auto-generates)
4. Update seed file if needed (`prisma/seed-test.ts`)

### Adding a New Service

1. Create `src/services/myService.ts`
2. Export functions with clear interfaces
3. Add unit tests
4. Import and use in routes/workers

### Debugging Issues

1. Check logs: `logger.error()` calls
2. Check Sentry (production errors)
3. Check database state: `npm run prisma:studio`
4. Check Redis: `redis-cli` or GUI tool
5. Check job queue: BullBoard (if enabled)

---

## Additional Resources

- **Backend Architecture**: `docs/BACKEND_ARCHITECTURE.md`
- **System Architecture**: `docs/SYSTEM_ARCHITECTURE.md`
- **Authentication**: `docs/AUTHENTICATION.md`
- **Async Generation**: `docs/ASYNC_GENERATION.md`
- **Infrastructure**: `docs/INFRA.md`
- **Prisma Schema**: `prisma/schema.prisma`
- **API Routes**: `src/routes/*.routes.ts`

---

## Quick Reference

### Request User ID

```typescript
const userId = requireUserId(req) // throws if not auth
const userId = getUserId(req) // undefined if not auth
```

### Check Plan Feature

```typescript
import { hasFeature, getPlanLimits } from '../utils/planLimits'

if (!hasFeature(user.plan, 'apiAccess')) {
  return res.status(403).json({ error: 'API access requires SUPPORTER plan' })
}
```

### Enqueue Job

```typescript
import { enqueueSvgGenerationJob } from '../jobs/svgGenerationQueue'

const jobId = 'generated-or-existing-id'
await enqueueSvgGenerationJob(jobId, { userId, prompt, style })
```

### Send Notification

```typescript
import { createNotification } from '../services/notificationService'

await createNotification(userId, 'GENERATION_COMPLETE', 'Your SVG is ready!')
```

### Log Error

```typescript
logger.error({ error, userId, requestId: req.requestId }, 'Operation failed')
```

### Validate Input

```typescript
import { validateEmail, sanitizeInput } from '../utils/validateInput'

const email = sanitizeInput(req.body.email?.toLowerCase() || '')
const error = validateEmail(email)
if (error) return res.status(400).json({ error })
```

---

**Last Updated**: 2026-02-17

For questions or clarifications, refer to the docs folder or check the code directly. Happy coding! 🚀
