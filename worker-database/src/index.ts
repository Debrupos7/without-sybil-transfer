// ============================================================================
// index.ts — Cloudflare Worker entry point
// ----------------------------------------------------------------------------
// Stack: Hono router + D1 database + Supabase JWT verification
//
// Architecture:
//   * Every request passes through:
//       1. CORS preflight
//       2. Security headers (secureHeaders)
//       3. Per-IP rate limit
//       4. JWT verification (except /healthz and OPTIONS)
//       5. Per-user rate limit
//       6. Zod input validation (inside route handlers)
//       7. Handler that scopes EVERY D1 query by the verified user_id
//       8. Audit log entry (after response)
//       9. Final security headers pass
//
//   * BUG FIX (transaction history):
//     GET /history and GET /transactions ALWAYS query by the JWT sub (user_id),
//     NEVER by wallet_address. When a user connects a different wallet, they
//     still see all their account's transactions because rows are scoped by
//     user_id, not by which wallet signed them.
// ============================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import {
  verifyJwt,
  extractBearer,
  AuthError,
  type AuthenticatedUser,
} from "./auth";
import {
  DEFAULT_RATE_LIMITS,
  applySecurityHeaders,
  checkRateLimit,
  clientIp,
  nowIso,
  sha256Hex,
} from "./security";
import { transactionsRoute } from "./routes/transactions";
import { networksRoute } from "./routes/networks";
import { userNetworksRoute } from "./routes/user-networks";
import { userContractsRoute } from "./routes/user-contracts";
import { contractsRoute } from "./routes/contracts";
import { walletsRoute } from "./routes/wallets";
import { walletGroupsRoute } from "./routes/wallet-groups";
import { historyRoute } from "./routes/history";
import { cleanupRoute } from "./routes/cleanup";
import { authRoute } from "./routes/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Env = {
  DB: D1Database;
  // JWT
  JWT_SECRET: string;
  // CORS
  ALLOWED_ORIGINS: string; // comma-separated list of frontend origins
  // Admin
  ADMIN_USER_IDS?: string; // comma-separated user ids allowed to call /cleanup
  CLEANUP_API_KEY?: string; // legacy bearer for cron-triggered cleanup
  // Misc
  ENVIRONMENT: string; // "production" | "preview" | "development"
};

export type AppContext = {
  Bindings: Env;
  Variables: {
    user: AuthenticatedUser;
    ip: string;
  };
};

// Alias for the Hono Context object that the middleware functions receive.
// This avoids the common mistake of using AppContext where Context is needed.
type C = import("hono").Context<AppContext, "*", any>;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = new Hono<AppContext>();

// 1. Logging + final security headers pass.
//    Registered FIRST so its response-phase logic runs LAST (LIFO) — every
//    response, including /healthz and 404s, gets the security headers applied.
app.use("*", logger());
app.use("*", async (c, next) => {
  await next();
  c.res = applySecurityHeaders(c.res);
});

// 2. CORS — lock to allowed origins only. No wildcard in production.
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = (c.env as Env).ALLOWED_ORIGINS.split(",").map((s) => s.trim());
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
    credentials: true,
    maxAge: 86400,
  })
);

// 3. Public health check — registered at the END (after the final middleware)
//    so it gets security headers applied. See app.get("/healthz", ...) below.

// 4. Auth + audit middleware — applies to all routes below this point.
app.use("*", async (c, next) => {
  // Skip auth for health check, CORS preflight, and public auth routes (POST only).
  // GET /auth/me requires auth.
  const isPublicAuth = c.req.path.startsWith("/auth/") && c.req.method === "POST";
  if (c.req.path === "/healthz" || c.req.method === "OPTIONS" || isPublicAuth) {
    return next();
  }
  return authAndRateLimit(c, next);
});

app.use("*", async (c, next) => {
  const isPublicAuth = c.req.path.startsWith("/auth/") && c.req.method === "POST";
  if (c.req.path === "/healthz" || c.req.method === "OPTIONS" || isPublicAuth) {
    return next();
  }
  return auditMiddleware(c, next);
});

// 5. Authenticated routes
app.route("/auth", authRoute);
app.route("/transactions", transactionsRoute);
app.route("/networks", networksRoute);
app.route("/user-networks", userNetworksRoute);
app.route("/user-contracts", userContractsRoute);
app.route("/contracts", contractsRoute);
app.route("/wallets", walletsRoute);
app.route("/wallet-groups", walletGroupsRoute);
app.route("/history", historyRoute);
app.route("/cleanup-transactions", cleanupRoute);

// 6. Public health check — registered after the final middleware so it picks
//    up security headers. Returns 200 with no auth.
app.get("/healthz", (c) =>
  c.json({ ok: true, ts: nowIso(), env: c.env.ENVIRONMENT })
);

// 7. 404 + global error handler
app.notFound((c) =>
  c.json({ error: "not_found", message: "Route not found" }, 404)
);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    { error: "internal_error", message: "An unexpected error occurred" },
    500
  );
});

export default app;

// ---------------------------------------------------------------------------
// Auth + rate limit middleware
// ---------------------------------------------------------------------------
async function authAndRateLimit(c: C, next: () => Promise<void>) {
  const ip = clientIp(c.req.raw);

  // Per-IP rate limit (cheap; blocks flood attacks before JWT parsing)
  const ipRl = await checkRateLimit(c.env.DB, `ip:${ip}`, DEFAULT_RATE_LIMITS.ip);
  if (!ipRl.ok) {
    return c.json(
      { error: "rate_limited", message: "Too many requests from this IP" },
      429
    );
  }

  const token = extractBearer(c.req.raw);
  if (!token) {
    return c.json(
      { error: "unauthorized", message: "Missing bearer token" },
      401
    );
  }

  let user: AuthenticatedUser;
  try {
    user = await verifyJwt(token, c.env.JWT_SECRET);
  } catch (e) {
    const err = e as AuthError;
    return c.json(
      { error: err.code || "unauthorized", message: err.message },
      401
    );
  }

  // Per-user rate limit
  const userRl = await checkRateLimit(
    c.env.DB,
    `user:${user.sub}`,
    DEFAULT_RATE_LIMITS.user
  );
  if (!userRl.ok) {
    return c.json(
      { error: "rate_limited", message: "Too many requests from this user" },
      429
    );
  }

  // Make sure the user exists in our local `users` table (mirror of auth.users).
  // This is the lookup table that makes the email-based history work —
  // regardless of which wallet is currently connected.
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, email_verified, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       updated_at = excluded.updated_at`
  )
    .bind(user.sub, user.email, nowIso(), nowIso())
    .run();

  c.set("user", user);
  c.set("ip", ip);
  await next();
}

// ---------------------------------------------------------------------------
// Audit middleware — runs AFTER handler, logs the request
// ---------------------------------------------------------------------------
async function auditMiddleware(c: C, next: () => Promise<void>) {
  await next();
  const user = c.get("user");
  const ip = c.get("ip") || "";
  if (!user) return;
  try {
    const method = c.req.method;
    const path = c.req.path;
    const status = c.res.status;
    let bodyHash = "";
    if (method !== "GET" && method !== "HEAD") {
      try {
        const body = await c.req.raw.clone().text();
        bodyHash = body ? await sha256Hex(body) : "";
      } catch {
        // ignore
      }
    }
    await c.env.DB.prepare(
      `INSERT INTO audit_log (user_id, ip, method, path, status, body_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(user.sub, ip, method, path, status, bodyHash)
      .run();
  } catch {
    // Audit logging must never break a request.
  }
}
