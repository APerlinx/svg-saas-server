# Auth Hardening: Refresh Token Rotation & Session Stability

## Context

While building the authentication system, I encountered a subtle but serious issue:
the UI could enter a "logged-in" state even when authentication cookies were missing
or invalid due to race conditions during token refresh.

This document explains the root cause, the security risks, and the final solution.

---

## Problems Identified

### 1. Refresh Token Race Conditions

Multiple requests could trigger `/auth/refresh` simultaneously:

- Each request attempted to rotate the same refresh token
- One request succeeded, others failed
- Failed requests could invalidate cookies unexpectedly

### 2. Token Reuse Risk

If a refresh token were stolen and reused:

- The system previously could not reliably detect replay
- This creates a session hijacking risk

### 3. UI / Auth State Desynchronization

The frontend initially trusted the `/login` response user object:

- Cookies could be cleared **after** login response
- UI showed authenticated state with no valid session

---

## Backend Solution

### Atomic Verify + Rotate

- Merged refresh token verification and rotation into a **single atomic operation**
- Used a database transaction to prevent race conditions

### Refresh Token Reuse Detection

- Each refresh token belongs to a **token family**
- If a revoked token is reused:
  - Entire token family is revoked
  - All sessions are invalidated
- Forces full re-authentication on both attacker and victim

### Security Properties

- Prevents refresh replay attacks
- Eliminates race conditions
- Guarantees single valid refresh token per session chain

---

## Frontend Solution

### Session Validation as Source of Truth

- The frontend no longer trusts login/register responses for auth state
- After login/register, it fetches `/current-user`
- Auth state is derived only from validated cookies

### Single-Flight Refresh Lock

- Prevents multiple concurrent refresh calls in a single tab
- Eliminates frontend-side refresh races

### Result

- UI state cannot diverge from actual session state
- Logged-in UI always implies valid cookies

---

## Testing Strategy

- Unit tests for refresh token rotation
- Reuse-detection tests (revoked token replay)
- Integration tests covering login → refresh → protected routes
- Frontend E2E tests validating persistence after reload

---

## Outcome

The authentication system now provides:

- Robust refresh token rotation
- Replay detection and session revocation
- Stable frontend session handling
- Clear separation between authentication and intent (CSRF)

This architecture is production-ready and aligns with best practices for
JWT-based, cookie-backed authentication systems.
