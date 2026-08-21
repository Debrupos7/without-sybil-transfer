# Security Documentation — Sybil v5

## Architecture (v2 — Cloudflare Worker + D1 backend)

As of the latest migration, the application has been split into:

1. **Next.js frontend** — React UI + Supabase Auth (for login only)
2. **Cloudflare Worker + D1** — the new backend that handles all data storage

The Supabase database is left untouched as a backup. All data reads/writes
now flow through the Worker, which enforces authentication, authorization,
input validation, rate limiting, and audit logging.

### Authentication

- **Login**: still handled by Supabase Auth (email/password)
- **JWT verification**: the Worker verifies every Supabase JWT using the
  project's HS256 JWT secret. RS256/JWKS fallback is supported but not
  required for default Supabase configurations.
- **Per-user access scoping**: every D1 query in the Worker is scoped by
  the JWT `sub` claim (user_id). This is the Cloudflare equivalent of
  Supabase RLS — D1 has no native RLS, so we enforce it in the Worker.

### Authorization

- **Authenticated endpoints**: require `Authorization: Bearer <supabase-jwt>`
- **Admin-only endpoints**: `/cleanup-transactions` requires the caller's
  user_id to be in the `ADMIN_USER_IDS` allowlist (configured via
  `wrangler.toml` or Worker secret)
- **Cross-user isolation**: every query includes `WHERE user_id = ?` with
  the JWT `sub`. If user B tries to read user A's transaction by id, the
  query returns no rows (404 — existence is not leaked)

### The bug fix

**Original bug**: transaction history was keyed by the connected wallet
address (not by the authenticated user). Switching wallets made prior
transactions disappear from the history page.

**Fix**: the Worker forces `user_id = JWT.sub` on every transaction
insert. The body's `user_id` field is ignored. The D1 schema also has a
foreign key constraint `transactions.user_id REFERENCES users(id)` that
rejects any `user_id` that isn't a real user row — defense-in-depth.

The migration script (`worker-database/scripts/migrate-supabase-to-d1.mjs`)
also retroactively fixes historical rows in Supabase where `user_id` was
stored as a wallet address, by looking up the real `user_id` from
`user_wallets` and writing the corrected row to D1.

## Security features (top-level)

### 1. JWT verification (HS256 + RS256 fallback)
Every authenticated endpoint verifies the Supabase JWT. The verification
checks:
- Signature (HS256 with the project's JWT secret)
- `iss` (issuer)
- `aud` (must be `"authenticated"`)
- `exp` (not expired)
- `role` (must be `"authenticated"` or `"service_role"`)

### 2. Per-IP + per-user rate limiting
A D1-backed sliding window counter:
- Per IP: 100 requests / minute
- Per user: 60 requests / minute (most endpoints), 20 / minute (writes)

When exceeded, the Worker returns 429 with `{ error: "rate_limited" }`.

### 3. Zod input validation
Every POST/PUT body is validated against a Zod schema. Invalid input
returns 400 with `{ error: "validation_failed", issues: [...] }`.

Examples:
- Ethereum addresses: `^0x[a-fA-F0-9]{40}$`
- Transaction status: enum `["pending", "success", "failed"]`
- Amount: must be a decimal string (not a float)
- URLs: must be valid URLs (for `rpc_url`, `explorer_url`)

### 4. Strict CORS
- The `ALLOWED_ORIGINS` env var (comma-separated) lists the allowed
  frontend origins
- No wildcard (`*`) in production
- Disallowed origins don't get the `Access-Control-Allow-Origin` header
  echoed back, so browsers block the response

### 5. Security headers
Every response includes:
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; ...`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=(), ...`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

The Next.js frontend (`next.config.js`) also sets the same headers on
its own responses.

### 6. Audit log
Every authenticated request is logged to the `audit_log` table with:
- `user_id` (from JWT)
- `ip` (from `CF-Connecting-IP` header)
- `method`, `path`, `status`
- `body_hash` (SHA-256 of the request body, for forensics)

### 7. Parameterized SQL only
The Worker uses D1's `prepare().bind()` API for every query — zero
string interpolation of user input. SQL injection is not possible.

### 8. Constant-time secret comparison
The `safeEqual()` function (in `worker-database/src/security.ts`) compares
strings in constant time, avoiding timing-based auth bypass on the
`CLEANUP_API_KEY` check.

### 9. Service-role Supabase key isolation
The Supabase `service_role` key is NEVER used by the Worker. It's only
used by the migration script (`migrate-supabase-to-d1.mjs`), which runs
locally on the operator's machine.

### 10. Defense-in-depth: foreign key constraints
The D1 schema enforces referential integrity:
- `transactions.user_id` → `users.id` (FK with ON DELETE CASCADE)
- `user_networks.user_id` → `users.id`
- `user_contracts.user_id` → `users.id`
- `user_wallets.user_id` → `users.id`
- `wallet_groups.user_id` → `users.id`
- `wallet_group_members.group_id` → `wallet_groups.id`
- `wallet_group_members.wallet_id` → `user_wallets.id`

This means even if a future bug let a wallet address slip through as
`user_id`, the DB would reject the insert (no such user row).

## Setup instructions

### Frontend (Next.js)

Create `.env.local` (NEVER commit this):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_WORKER_URL=https://sybil-transfer-worker.your-subdomain.workers.dev
```

### Worker

See `worker-database/README.md` and `worker-database/.dev.vars.example`.
Secrets are set via `wrangler secret put` and are stored encrypted in
Cloudflare. They NEVER appear in the repo or in `wrangler.toml`.

Required Worker secrets:
- `SUPABASE_JWT_SECRET` — your Supabase project's JWT secret
- `CLEANUP_API_KEY` — a random 32-byte hex string (generate with `openssl rand -hex 32`)

## Security checks

### Verify the Worker is healthy
```bash
curl https://sybil-transfer-worker.your-subdomain.workers.dev/healthz
# Expected: {"ok":true,"ts":"...","env":"production"}
```

### Verify auth is enforced
```bash
# Without token — should be 401:
curl https://sybil-transfer-worker.your-subdomain.workers.dev/transactions

# With garbage token — should be 401:
curl -H "Authorization: Bearer garbage.token.here" \
  https://sybil-transfer-worker.your-subdomain.workers.dev/transactions
```

### Verify the bug fix
```bash
# After logging in, grab your access_token from the browser's Supabase session
# (DevTools -> Application -> Local Storage -> sb-...-auth-token -> access_token)

# /history should return ALL of your transactions, regardless of which wallet
# is currently connected:
curl -H "Authorization: Bearer <access_token>" \
  https://sybil-transfer-worker.your-subdomain.workers.dev/history
```

### Check audit log
```bash
# In the worker-database directory:
npx wrangler d1 execute sybil-transfer-db --remote \
  --command "SELECT COUNT(*) FROM audit_log"
```

### Check RLS-equivalent scoping
```bash
# Log in as user A, create a transaction, note the id.
# Then log in as user B and try to fetch it:
curl -H "Authorization: Bearer <user-b-token>" \
  https://sybil-transfer-worker.your-subdomain.workers.dev/transactions/<tx-id>
# Expected: 404 (not 403 — we don't leak existence)
```

## Reporting security issues

If you discover a security vulnerability, please email
[security@example.com](mailto:security@example.com). Do NOT disclose
security issues publicly until they have been handled.
