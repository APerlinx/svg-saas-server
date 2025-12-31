[![CI (server)](https://github.com/APerlinx/svg-saas-server/actions/workflows/ci.yml/badge.svg)](https://github.com/APerlinx/svg-saas-server/actions/workflows/ci.yml)

# chatSVG - Backend

A production-ready SaaS backend for generating SVG assets with enterprise-grade authentication, session management, and asynchronous job processing. Built with modern best practices including BullMQ queues, refresh token rotation, reuse detection, CSRF protection, and comprehensive test coverage.

## 🚀 Tech Stack

### Backend

- **Node.js** + **Express** + **TypeScript**
- **PostgreSQL** (Neon hosted database)
- **Redis** (Upstash for BullMQ and caching)
- **Prisma ORM** (type-safe database client)
- **BullMQ** (async job queue for SVG generation)
- **Passport.js** (OAuth strategies for Google & GitHub)

### Security & Authentication

- **JWT** access tokens (HttpOnly cookies, 15min expiry)
- **Refresh tokens** (SHA-256 hashed in database, HttpOnly cookies)
- **Token rotation** with reuse detection and family revocation
- **CSRF protection** (double-submit cookie pattern)
- **Rate limiting** (5 attempts per 15 minutes on auth endpoints)
- **bcrypt** password hashing (10 rounds)

### DevOps & Quality

- **Docker** + **Docker Compose** (containerized development environment)
- **Jest** + **Supertest** (comprehensive auth route testing)
- **Node-cron** (automated token cleanup jobs)
- **BullMQ** (Redis-backed job queue with retry logic)
- **Email service** (Resend API for transactional emails)
- **GitHub Actions** (CI/CD with Docker build validation)

---

## ✨ Key Features

### Async SVG Generation Pipeline

- ✅ Non-blocking job queue (BullMQ + Redis)
- ✅ Automatic retries with exponential backoff
- ✅ Idempotent job creation (duplicate prevention)
- ✅ Atomic credit charging and refunding
- ✅ Real-time status updates (Socket.IO)
- ✅ Horizontal worker scaling
- ✅ Queue depth observability

### Authentication & Security

- ✅ Email/password authentication
- ✅ OAuth 2.0 (Google & GitHub) with email verification
- ✅ Composite unique constraint prevents OAuth provider ID conflicts
- ✅ Session persistence with refresh tokens
- ✅ Multi-device session management
- ✅ Per-session revocation (logout from specific devices)
- ✅ Password reset flow with expiring tokens
- ✅ Automated cleanup of expired sessions
- ✅ Token family tracking for breach detection
- ✅ CSRF protection on all write operations

### Session Management

- ✅ View all active sessions (IP, device, last used)
- ✅ Revoke individual sessions
- ✅ Force re-login on security events
- ✅ IP address & user-agent tracking

---

## 🔐 Authentication Architecture

### Two-Token System

- **Access Token** (`token` cookie)
  - Short-lived (15 minutes)
  - Used for API authentication
  - JWT signed with server secret
- **Refresh Token** (`refreshToken` cookie)
  - Long-lived (7-30 days)
  - Used only for `/api/auth/refresh` endpoint
  - Stored hashed (SHA-256) in database
  - Rotated on every use

### Token Rotation & Reuse Detection

1. Each refresh token belongs to a **token family** (same login session)
2. On `/refresh`, old token is revoked and new one issued
3. If a revoked token is reused → **security breach detected**
4. System revokes **entire token family** and forces re-authentication
5. All operations wrapped in database transaction (race condition prevention)

**📖 Detailed Documentation:** See [`AUTHENTICATION.md`](./AUTHENTICATION.md) for complete auth flow diagrams and security details.

---

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (local or Neon)
- npm or yarn

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/svg-saas-server.git
cd svg-saas-server

# Install dependencies
npm install
```

### 2. Environment Setup

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Then edit `.env` with your configuration:

```env
# JWT Configuration
JWT_SECRET=your_long_random_secret_32_chars_minimum

# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Redis (for BullMQ and caching)
REDIS_URL=redis://localhost:6379
# Or for Upstash (TLS):
# REDIS_URL=rediss://default:password@host:port

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_REDIRECT_URI=http://localhost:4000/api/auth/github/callback

# OpenAI (for SVG generation)
OPENAI_API_KEY=your_openai_api_key

# Email Service (Resend)
RESEND_API_KEY=your_resend_api_key

# Worker Configuration
SVG_WORKER_CONCURRENCY=2

# Environment
NODE_ENV=development
```

### 3. Database Setup

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate dev

# (Optional) Seed database
npm run seed
```

### 4. Run Development Server

**Option A: Local Development (API + Worker)**

```bash
# Terminal 1: Start Redis + Postgres
docker compose up -d redis db

# Terminal 2: Start API
npm run dev

# Terminal 3: Start worker
npm run worker:dev
```

Server will start on `http://localhost:4000`

**Option B: Full Docker (API + Worker + PostgreSQL + Redis)**

```bash
# Start API + PostgreSQL containers
docker-compose up --build

# Or run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop containers
docker-compose down
```

Server will start on `http://localhost:4000` with PostgreSQL on `localhost:5432`

**Docker Benefits:**

- ✅ Consistent environment across team
- ✅ Includes PostgreSQL + Redis (no manual setup)
- ✅ Matches production setup
- ✅ Easy onboarding for new developers

**Important:** For async SVG generation to work, you must run both the API server and the worker. See [Async Generation docs](./ASYNC_GENERATION.md) for details.

---

## 🧪 Testing

### Run All Tests

```bash
npm run test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Test Coverage Includes:

- ✅ Authentication routes (register, login, logout)
- ✅ Token refresh flow with rotation
- ✅ OAuth callbacks (Google, GitHub)
- ✅ Password reset flow
- ✅ Session management
- ✅ CSRF protection
- ✅ Rate limiting

---

## 📁 Project Structure

```
server/
├── src/
│   ├── routes/
│   │   ├── auth.routes.ts          # Authentication endpoints
│   │   ├── svg.routes.ts           # SVG generation endpoints
│   │   ├── user.routes.ts          # User management endpoints
│   │   └── __tests__/              # Route tests
│   ├── middleware/
│   │   ├── auth.ts                 # JWT verification
│   │   ├── csrf.ts                 # CSRF protection
│   │   ├── rateLimiter.ts          # Rate limiting
│   │   ├── checkCredits.ts         # Credit validation
│   │   └── dailyLimit.ts           # Usage limits
│   ├── utils/
│   │   ├── refreshToken.ts         # Token rotation logic
│   │   ├── setAuthCookie.ts        # Cookie helpers
│   │   ├── sanitizeInput.ts        # Input sanitization
│   │   └── validateInput.ts        # Input validation
│   ├── config/
│   │   ├── passport.ts             # OAuth strategies
│   │   └── env.ts                  # Environment config
│   ├── services/
│   │   ├── aiService.ts            # AI/LLM integration
│   │   └── emailService.ts         # Email sending
│   ├── jobs/
│   │   ├── cleanupExpiredTokens.ts # Token cleanup cron
│   │   ├── index.ts                # Job scheduler
│   │   └── svgGenerationQueue.ts   # BullMQ queue + scheduler
│   ├── lib/
│   │   ├── bullmq.ts               # Shared BullMQ connection helper
│   │   ├── prisma.ts               # Database client
│   │   └── redis.ts                # Redis client wrapper
│   ├── workers/
│   │   └── svgGenerationWorker.ts  # Queue worker entry point
│   ├── app.ts                      # Express app setup
│   └── server.ts                   # Server entry point
├── prisma/
│   ├── schema.prisma               # Database schema
│   └── migrations/                 # Migration history
├── docs/
│   ├── README.md                   # This file
│   └── AUTHENTICATION.md           # Detailed auth docs
├── Dockerfile                      # Multi-stage Docker build
├── docker-compose.yml              # Local dev environment
├── .env.example                    # Environment variable template
└── jest.config.js                  # Test configuration
```

---

## 🐳 Docker

### Quick Start with Docker

```bash
# Copy environment template
cp .env.example .env

# Start all services (API + PostgreSQL)
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (fresh start)
docker-compose down -v
```

### Docker Architecture

- **Multi-stage build** - Optimized image size (~50MB with Alpine)
- **Non-root user** - Security hardened (runs as `nodejs` user)
- **Health checks** - Container monitoring with `/api/health` and `/api/ready`
- **Volume persistence** - Database data survives container restarts
- **Auto-migrations** - Prisma migrations run on container startup

### Available Endpoints

- `http://localhost:4000/api/health` - Liveness check
- `http://localhost:4000/api/ready` - Readiness check (tests DB connection)

---

## 🔑 API Endpoints

### Authentication

- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Logout and revoke session
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/current-user` - Get authenticated user
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/github` - Initiate GitHub OAuth
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

### Session Management

- `GET /api/auth/sessions` - List all active sessions
- `DELETE /api/auth/sessions/:id` - Revoke specific session

### User

- `GET /api/user/profile` - Get user profile
- `PATCH /api/user/profile` - Update user profile

### SVG Generation

- `POST /api/svg/generate-svg` - Enqueue an SVG generation job
- `GET /api/svg/generation-jobs/:id` - Get current job status/result (also used as a fallback if realtime is unavailable)
- `GET /api/svg/history` - Get generation history
- `GET /api/svg/public` - Browse public gallery
- `GET /api/svg/:id` - Get specific SVG by ID

**See [ASYNC_GENERATION.md](./ASYNC_GENERATION.md) for complete async pipeline documentation.**

---

## ⚙️ Async SVG Generation Pipeline

SVG creation runs through a BullMQ queue so the API never blocks on OpenAI latency.

### How it Works

1. **POST `/api/svg/generate-svg`**

   - Validates prompt, style, and model
   - Creates a `GenerationJob` record (status: `QUEUED`)
   - Enqueues job to Redis via BullMQ
   - Returns `202 Accepted` with job ID

2. **Worker processes job**

   - Claims job atomically (status: `RUNNING`)
   - Charges 1 credit (transactional, idempotent)
   - Calls OpenAI API to generate SVG
   - Sanitizes and stores result
   - Updates job (status: `SUCCEEDED`)

3. **GET `/api/svg/generation-jobs/:id`**
   - Client can fetch the latest status/result at any time
   - Includes updated credits balance on completion

### Realtime Updates (Socket.IO)

After enqueueing a job, the server emits `generation-job:update` events to the authenticated user's room.

- Event: `generation-job:update`
- Payload: `{ jobId, status, progress?, generationId?, errorCode?, errorMessage? }`
- Auth: uses the `token` HttpOnly cookie during the Socket.IO handshake (no extra client-side “join room” step)

The recommended flow is:

1. `POST /api/svg/generate-svg` → get `job.id`
2. Listen for `generation-job:update` for that `jobId`
3. On terminal status (`SUCCEEDED`/`FAILED`), do one `GET /api/svg/generation-jobs/:id` to fetch the full record (SVG, credits, etc.)

### Running Locally

```bash
# Start Redis (required)
docker compose up -d redis

# Terminal 1: API server
npm run dev

# Terminal 2: Queue worker
npm run worker:dev
```

### Production Deployment

Deploy the API and worker as **separate services** (same codebase, different entry points):

- **API:** `npm run start` → runs `dist/server.js`
- **Worker:** `npm run worker` → runs `dist/workers/svgGenerationWorker.js`

Both need access to the same `DATABASE_URL` and `REDIS_URL`.

**Scaling:**

- Horizontal: Run multiple worker instances (BullMQ distributes jobs)
- Vertical: Increase `SVG_WORKER_CONCURRENCY` per worker

**📖 Full Documentation:** See [`ASYNC_GENERATION.md`](./ASYNC_GENERATION.md) for architecture, idempotency, credits flow, and troubleshooting.

---

## 🔒 Security Features

### Implemented Protections

1. **Token Security**

   - HttpOnly cookies (XSS prevention)
   - SHA-256 hashing for refresh tokens
   - Token rotation with reuse detection
   - Token family tracking
   - Automatic cleanup of expired tokens

2. **CSRF Protection**

   - Double-submit cookie pattern
   - Header validation on write operations
   - State parameter for OAuth flows

3. **Rate Limiting**

   - 5 attempts per 15 minutes (auth endpoints)
   - 3 attempts per 15 minutes (password reset)
   - IP-based tracking

4. **OAuth Security**

   - Composite unique constraint on `provider` + `providerId`
   - Email verification required (Google: strict, GitHub: on linking)
   - State parameter with timestamp validation
   - Prevents account hijacking via unverified emails

5. **Observability & Incident Response**

   - Request correlation via `x-request-id` header
   - Structured logging with Pino (includes requestId)
   - Sentry integration for error tracking
   - Security incident logging (token reuse detection)
   - Comprehensive audit trails

6. **Input Validation**

   - Email format validation
   - Password strength requirements (8+ chars)
   - Input sanitization
   - Maximum length checks

7. **Database Security**

   - Parameterized queries (SQL injection prevention)
   - Atomic transactions (race condition prevention)
   - Cascading deletes for data consistency

8. **Container Security**
   - Non-root user in Docker containers
   - Multi-stage builds (minimal attack surface)
   - Health checks for monitoring
   - Alpine-based images (small, secure base)

---

## 📊 Database Schema

### Key Models

**User** - User accounts and authentication

- Email/password or OAuth provider
- Composite unique constraint on `provider` + `providerId`
- Credits system for API usage
- Terms acceptance tracking

**RefreshToken** - Session tokens

- SHA-256 hashed tokens
- Token family tracking
- Rotation chain with `replacedByTokenId`
- IP address & user-agent tracking

**SvgGeneration** - Generation history

- Prompt and result tracking
- Credit usage logging
- Privacy controls

**GenerationJob** - Async job tracking

- Job status: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`
- Idempotency key support
- Request hash for parameter validation
- Atomic credit charging/refunding flags
- Retry metadata (attempts, timestamps)

See [`schema.prisma`](../prisma/schema.prisma) for complete schema and [`ASYNC_GENERATION.md`](./ASYNC_GENERATION.md) for job lifecycle details.

---

## 🚀 Deployment

**Note:** CI/CD is documented in the client repository.

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET` (32+ characters)
- [ ] Enable HTTPS (required for secure cookies)
- [ ] Configure CORS for production domain
- [ ] Set up database backups
- [ ] Configure environment variables in hosting platform
- [ ] Set up monitoring and logging
- [ ] Enable rate limiting
- [ ] Configure email service
- [ ] Set up OAuth redirect URIs for production domain
- [ ] Provision managed Redis (Upstash, Render, AWS ElastiCache)
- [ ] Deploy worker service separately from API
- [ ] Configure `SVG_WORKER_CONCURRENCY` based on load
- [ ] Set up health checks for both API and worker

### Recommended Hosting

- **Backend:** Railway, Render, Fly.io, or AWS
- **Database:** Neon, Supabase, or AWS RDS
- **Redis:** Upstash (recommended), Render Redis, or AWS ElastiCache
- **Email:** Resend, SendGrid, or AWS SES

**Worker Deployment:**

- Same codebase as API, different start command (`npm run worker`)
- Can scale independently (1 API + N workers)
- Requires access to same Redis and database

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

---

## 👨‍💻 Author

**Alon perlin**

- GitHub: [@APerlinx](https://github.com/aperlinx)
- LinkedIn: [alon perlin](https://linkedin.com/in/alonperlin)

---

## 🙏 Acknowledgments

- Built as a demonstration of production-ready authentication patterns
- Implements OWASP security best practices
- Designed to be interview-ready and easily explainable
- Emphasizes real-world session handling and token security

---

**Note:** This project intentionally emphasizes security and real-world session handling patterns. The authentication flow is implemented to be explainable in interviews and robust enough for production deployment.
