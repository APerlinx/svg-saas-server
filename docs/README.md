# SVG SaaS - Backend

A production-ready SaaS backend for generating SVG assets with enterprise-grade authentication, session management, and security-first token handling. Built with modern best practices including refresh token rotation, reuse detection, CSRF protection, and comprehensive test coverage.

## 🚀 Tech Stack

### Backend

- **Node.js** + **Express** + **TypeScript**
- **PostgreSQL** (Neon hosted database)
- **Prisma ORM** (type-safe database client)
- **Passport.js** (OAuth strategies for Google & GitHub)

### Security & Authentication

- **JWT** access tokens (HttpOnly cookies, 15min expiry)
- **Refresh tokens** (SHA-256 hashed in database, HttpOnly cookies)
- **Token rotation** with reuse detection and family revocation
- **CSRF protection** (double-submit cookie pattern)
- **Rate limiting** (5 attempts per 15 minutes on auth endpoints)
- **bcrypt** password hashing (10 rounds)

### DevOps & Quality

- **Jest** + **Supertest** (comprehensive auth route testing)
- **Node-cron** (automated token cleanup jobs)
- **Email service** (Resend API for transactional emails)

---

## ✨ Key Features

### Authentication & Security

- ✅ Email/password authentication
- ✅ OAuth 2.0 (Google & GitHub)
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

Create a `.env` file in the root directory:

```env
# JWT Configuration
JWT_SECRET=your_long_random_secret_32_chars_minimum

# Database
DATABASE_URL=postgresql://user:password@host:5432/database

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

# Email Service (Resend)
RESEND_API_KEY=your_resend_api_key

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

```bash
npm run dev
```

Server will start on `http://localhost:4000`

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
│   │   └── index.ts                # Job scheduler
│   ├── lib/
│   │   └── prisma.ts               # Database client
│   ├── app.ts                      # Express app setup
│   └── server.ts                   # Server entry point
├── prisma/
│   ├── schema.prisma               # Database schema
│   └── migrations/                 # Migration history
├── docs/
│   ├── README.md                   # This file
│   └── AUTHENTICATION.md           # Detailed auth docs
└── jest.config.js                  # Test configuration
```

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

- `POST /api/svg/generate` - Generate SVG from prompt
- `GET /api/svg/history` - Get generation history

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

4. **Input Validation**

   - Email format validation
   - Password strength requirements (8+ chars)
   - Input sanitization
   - Maximum length checks

5. **Database Security**
   - Parameterized queries (SQL injection prevention)
   - Atomic transactions (race condition prevention)
   - Cascading deletes for data consistency

---

## 📊 Database Schema

### Key Models

**User** - User accounts and authentication

- Email/password or OAuth provider
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

See [`schema.prisma`](../prisma/schema.prisma) for complete schema.

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

### Recommended Hosting

- **Backend:** Railway, Render, Fly.io, or AWS
- **Database:** Neon, Supabase, or AWS RDS
- **Email:** Resend, SendGrid, or AWS SES

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
