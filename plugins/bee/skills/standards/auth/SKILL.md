---
name: auth-patterns
description: "Authentication and authorization patterns -- JWT, OAuth, sessions, refresh tokens, RBAC. Cross-stack security standards for any backend."
---

# Authentication & Authorization Standards

These patterns apply cross-stack. Read the relevant stack skill for framework-specific implementation details.

## JWT Authentication

### Token Structure

```typescript
// Access token: short-lived (15 min), carries user identity
interface AccessTokenPayload {
  sub: string;       // user ID
  email: string;
  role: 'user' | 'admin';
  iat: number;       // issued at
  exp: number;       // expires at (15 min from iat)
}

// Refresh token: long-lived (7-30 days), stored securely, used to get new access tokens
interface RefreshTokenPayload {
  sub: string;
  jti: string;       // unique token ID (for revocation)
  exp: number;
}
```

### Token Flow

1. User logs in → server returns `{ accessToken, refreshToken }`
2. Client sends `Authorization: Bearer <accessToken>` on every request
3. When access token expires (401) → client sends refresh token to `/auth/refresh`
4. Server validates refresh token → issues new access + refresh tokens
5. On logout → server revokes refresh token (delete from DB/blocklist)

### Storage Rules

| Token | Web (browser) | Mobile (RN) |
|-------|--------------|-------------|
| Access token | Memory (variable) or httpOnly cookie | SecureStore |
| Refresh token | httpOnly secure cookie | SecureStore |

- Never store tokens in localStorage (XSS vulnerable)
- Never store tokens in sessionStorage (XSS vulnerable)
- httpOnly cookies prevent JavaScript access entirely
- Mobile: use encrypted storage (Keychain/EncryptedSharedPreferences)

## OAuth 2.0 / Social Login

```
1. Client redirects to provider: GET /authorize?client_id=...&redirect_uri=...&scope=...
2. User authenticates with provider
3. Provider redirects to callback: GET /callback?code=...
4. Server exchanges code for tokens: POST /token (server-to-server, with client_secret)
5. Server creates/links user account, issues your JWT
```

- Always exchange auth code on the server (never expose `client_secret` to client)
- Validate `state` parameter to prevent CSRF
- Store provider user ID for account linking (don't rely on email — it can change)

## Session Authentication

For server-rendered apps (Laravel, Rails, Django):

- Sessions stored server-side (database, Redis)
- Session ID in httpOnly secure cookie
- CSRF token required on all state-changing requests
- Session rotation on login (prevent fixation)
- Session expiry: sliding (extend on activity) or absolute (fixed duration)

## RBAC (Role-Based Access Control)

```typescript
// Define permissions per role
type Permission = 'orders:read' | 'orders:create' | 'orders:update' | 'orders:delete' | 'users:manage';

const permissions: Record<string, Permission[]> = {
  admin: ['orders:read', 'orders:create', 'orders:update', 'orders:delete', 'users:manage'],
  manager: ['orders:read', 'orders:create', 'orders:update'],
  viewer: ['orders:read'],
};

// Check permission
function can(user: User, permission: Permission): boolean {
  return permissions[user.role]?.includes(permission) ?? false;
}

// Middleware
function requirePermission(permission: Permission) {
  return (req, res, next) => {
    if (!can(req.user, permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
```

## Security Rules

- Hash passwords with bcrypt (cost factor 12+) or Argon2. Never store plaintext.
- Rate limit login endpoints: 5 attempts per minute per IP/email
- Lock accounts after 10 failed attempts (temporary, 15 min)
- Log all auth events: login, logout, failed attempts, password changes, token refresh
- Validate email with verification link before granting full access
- Password reset tokens: single-use, expire in 1 hour, tied to specific user
- Never reveal if email exists: "If an account exists, we sent a reset link" (not "Email not found")

## Common Pitfalls

- **Storing JWT in localStorage** — XSS steals it. Use httpOnly cookies or memory.
- **No refresh token rotation** — reuse of refresh tokens allows stolen tokens to work indefinitely
- **Missing CSRF protection on session auth** — sessions in cookies auto-send, enabling CSRF attacks
- **Checking auth on client only** — client-side auth checks are bypassable. Always verify server-side.
- **Long-lived access tokens** — 24h+ access tokens are security risks. Use 15 min + refresh pattern.
- **No token revocation** — when user changes password or is deactivated, old tokens still work
