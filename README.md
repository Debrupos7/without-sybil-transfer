# Sybil v5 — Without Sybil Transfer

A secure web application for managing cryptocurrency transactions and wallets.

## Architecture (v2 — Cloudflare Worker + D1 backend)

The app has been migrated from **Supabase for data storage** to a
**Cloudflare Worker + D1** backend. The new architecture:

```
┌────────────────────────────┐         ┌──────────────────────────────┐
│  Next.js frontend          │         │  Cloudflare Worker            │
│  (this repo)               │ ──JWT──>│  (worker-database/)          │
│                            │         │                              │
│  - React UI                │         │  - Hono router               │
│  - Supabase Auth (login)   │         │  - JWT verification (HS256)  │
│  - Web3 wallet connect     │         │  - Per-user rate limit       │
│  - Worker API client       │         │  - Zod input validation      │
│                            │         │  - Audit log                 │
└─────────────┬──────────────┘         │  - RLS-equivalent scoping    │
              │                        └──────────┬───────────────────┘
              │                                   │
              ▼                                   ▼
┌────────────────────────────┐         ┌──────────────────────────────┐
│  Supabase Auth              │         │  Cloudflare D1 (SQLite)      │
│  (sign up / in / out)       │         │  - transactions              │
│  Issues JWTs the Worker     │         │  - user_wallets              │
│  verifies                   │         │  - user_networks / contracts │
│                              │         │  - wallet_groups             │
└────────────────────────────┘         │  - audit_log / rate_limit    │
                                       └──────────────────────────────┘
```

### What's where now

| Concern | Old location | New location |
|---|---|---|
| User auth (login/signup) | Supabase Auth | Supabase Auth (unchanged — issues JWTs the Worker verifies) |
| Transaction storage | Supabase Postgres | Cloudflare D1 (via Worker) |
| Wallets, networks, contracts | Supabase Postgres | Cloudflare D1 (via Worker) |
| Wallet groups | Supabase Postgres | Cloudflare D1 (via Worker) |
| RLS (row-level security) | Supabase Postgres RLS | Worker-level per-user scoping on every query |
| Input validation | Frontend + scattered | Zod schemas enforced on every Worker POST/PUT |
| Rate limiting | None | Per-IP + per-user (D1-backed sliding window) |
| Audit logging | None | Every authenticated request logged to `audit_log` table |

### Why migrate?

1. **Bug fix**: transaction history was being keyed by the connected wallet
   address, not by the authenticated user. Switching wallets made old
   transactions disappear. The Worker forces `user_id = JWT.sub` on every
   transaction insert, so the bug cannot recur.
2. **Top-level security**: Zod validation, strict CORS, security headers,
   rate limiting, audit logging — all enforced at the API gateway level.
3. **Cost**: D1 is much cheaper than Supabase Postgres for this workload.
4. **Portability**: the Worker is a single TypeScript codebase; deploy
   anywhere with `wrangler deploy`.

## The bug fix (in detail)

**Original symptom:** Switching wallets makes your previous transactions
disappear from the history page.

**Root cause:** in `src/components/TransferForm.tsx`, the original code was:
```js
user_id: user?.id || account || ''
```
When `user.id` was missing, the wallet address got stored as `user_id`.
Then `src/app/transactions/page.tsx` queried `.eq('user_id', user.id)`,
missing all rows where `user_id` was a wallet address.

**Fix:** the Worker (`worker-database/src/routes/transactions.ts`) forces
`user_id = JWT.sub` on every insert. The body's `user_id` field is ignored.
The migration script (`worker-database/scripts/migrate-supabase-to-d1.mjs`)
also retroactively fixes historical rows where `user_id` was a wallet
address by looking up the real `user_id` from `user_wallets`.

## Security features

- 🔐 **JWT verification** on every authenticated endpoint (HS256 with RS256/JWKS fallback)
- 🛡️ **Per-user access scoping** on every D1 query (RLS equivalent)
- 🚦 **Per-IP + per-user rate limiting** (D1-backed sliding window)
- 🎯 **Zod input validation** on every POST/PUT body
- 🔒 **Strict CORS** (origin allowlist, no wildcard)
- 🧱 **Strict security headers** (CSP, HSTS, XFO, nosniff, referrer-policy, permissions-policy, COOP, CORP)
- 📒 **Audit log** of every authenticated request (method, path, status, body hash)
- 🔁 **Constant-time secret comparison** (avoids timing-based auth bypass)
- 🚫 **Service-role Supabase key** used only by the migration script, never by the Worker
- 🛟 **Supabase database left untouched** as a backup; migration is read-only on Supabase, idempotent on D1
- 📦 **`uuid` package** added to `package.json` (was missing despite being imported)

## Getting started

### Prerequisites

- Node.js (v18+)
- A Supabase project (for auth)
- A Cloudflare account (for the Worker + D1)
- An Ethereum RPC provider (Alchemy, Infura, etc.)

### Installation

1. **Clone and install:**
   ```bash
   git clone https://github.com/Debrupos7/without-sybil-transfer.git
   cd without-sybil-transfer
   npm install
   ```

2. **Set up the Worker backend first** — see `worker-database/README.md`
   for full instructions. The short version:
   ```bash
   cd worker-database
   npm install
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars to fill in SUPABASE_JWT_SECRET, ALLOWED_ORIGINS, etc.
   npx wrangler d1 create sybil-transfer-db
   # Paste the printed database_id into wrangler.toml
   npm run migrate:remote
   npm run secret:jwt
   npm run secret:cleanup
   npm run deploy
   ```

3. **Configure the frontend** — create `.env.local`:
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local to fill in your Supabase + Worker URLs
   ```

4. **Start the dev server:**
   ```bash
   npm run dev
   ```

5. **Test the bug fix:**
   - Sign in
   - Connect wallet A
   - Make a transaction
   - Switch to wallet B (without disconnecting A first)
   - The transaction from A should STILL be visible in `/transactions`

## Folder structure

```
without-sybil-transfer/
├── src/                          # Next.js frontend
│   ├── app/
│   │   ├── transactions/page.tsx     # Uses Worker /history (bug fix)
│   │   ├── wallets/page.tsx           # Uses Worker /wallets + /wallet-groups
│   │   ├── dashboard/page.tsx
│   │   ├── admin/page.tsx
│   │   ├── sign-in/page.tsx
│   │   ├── sign-up/page.tsx
│   │   └── api/                       # Legacy Next.js API routes (deprecated)
│   ├── components/
│   │   ├── TransferForm.tsx           # Uses Worker createTransaction (bug fix)
│   │   ├── Header.tsx
│   │   └── WalletConnect.tsx
│   ├── context/
│   │   ├── AuthContext.tsx            # Supabase auth (unchanged)
│   │   └── Web3Context.tsx             # Uses Worker for data, Supabase for auth
│   └── utils/
│       ├── supabaseClient.ts          # AUTH ONLY (data calls moved to workerClient)
│       └── workerClient.ts            # NEW: Worker API client
├── worker-database/                   # NEW: Cloudflare Worker + D1 backend
│   ├── migrations/0001_init.sql
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth.ts
│   │   ├── security.ts
│   │   └── routes/                    # transactions, networks, wallets, etc.
│   ├── scripts/
│   │   └── migrate-supabase-to-d1.mjs
│   ├── test/
│   │   └── smoke-test.mjs             # 31 integration tests, all green
│   ├── wrangler.toml
│   ├── package.json
│   └── README.md
├── next.config.js                     # Strict CSP, HSTS, XFO, nosniff, etc.
├── .env.local.example                 # Frontend env vars
├── README.md                          # This file
└── SECURITY.md                        # Updated security documentation
```

## Testing

The Worker has a 31-test smoke suite that exercises every endpoint:

```bash
cd worker-database
npm install
node test/smoke-test.mjs
```

Expected output: `PASSED: 31, FAILED: 0`.

The tests cover:
- Auth: missing token, garbage token, expired token (all → 401)
- The bug fix: POST forces user_id from JWT; /history returns all of the user's txs across multiple wallets; schema FK constraint blocks wallet-as-user_id (defense-in-depth)
- Zod validation: invalid ETH address, invalid enum, invalid amount, missing fields (all → 400)
- CORS: disallowed origin doesn't get ACAO header; allowed origin does
- Security headers: CSP, HSTS, XFO=DENY, nosniff, referrer-policy all present
- Cross-user isolation: user B gets 404 (not 403 — no existence leak) on user A's data
- Admin-only: /cleanup-transactions returns 403 for non-admins, 200 for admins
- Audit log: captures method, path, status for every request
- Rate limiting: per-IP + per-user buckets populated correctly

## Deployment

See `worker-database/README.md` for the full deployment guide. The TL;DR:

1. Rotate all secrets (Supabase service_role, Supabase JWT secret, GitHub PAT, Cloudflare API token)
2. Create the D1 database
3. Apply the schema (`npm run migrate:remote`)
4. Migrate data from Supabase (`npm run migrate-from-supabase`)
5. Set Worker secrets (`npm run secret:jwt`, `npm run secret:cleanup`)
6. Deploy the Worker (`npm run deploy`)
7. Update `.env.local` with the Worker URL
8. Deploy the frontend (Netlify, Vercel, or any Next.js host)

## Security disclosure

See [SECURITY.md](./SECURITY.md) for the full security documentation,
including how to report vulnerabilities.
