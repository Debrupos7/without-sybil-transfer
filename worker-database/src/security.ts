// ============================================================================
// security.ts — CORS, rate limiting, input validation, security headers
// ============================================================================

import { z } from "zod";

// ---------------------------------------------------------------------------
// CORS — lock to the frontend origin only
// ---------------------------------------------------------------------------
// Reads from ALLOWED_ORIGINS env (comma-separated). No wildcard in production.
export function getAllowedOrigins(env: { ALLOWED_ORIGINS?: string }): string[] {
  if (!env.ALLOWED_ORIGINS) return [];
  return env.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function handleCors(req: Request, env: { ALLOWED_ORIGINS?: string }): Response | null {
  const origin = req.headers.get("origin") || "";
  const allowed = getAllowedOrigins(env);
  // If no allowed origins are configured, deny all cross-origin requests.
  if (allowed.length === 0 || !allowed.includes(origin)) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 403 });
    }
    // For non-preflight, we let the request through but won't echo CORS headers;
    // browser will block the response. To fail fast, return 403 for OPTIONS only.
    return null;
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  // Return null to signal the caller should set these headers on the real response.
  // We use a side channel: stash them on the request so downstream can read.
  (req as any).__corsHeaders = headers;
  return null;
}

export function withCorsHeaders(res: Response, req: Request): Response {
  const headers = (req as any).__corsHeaders as Record<string, string> | undefined;
  if (!headers) return res;
  const newHeaders = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) {
    if (!newHeaders.has(k)) newHeaders.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

// ---------------------------------------------------------------------------
// Security headers (applied to every response)
// ---------------------------------------------------------------------------
export function applySecurityHeaders(res: Response): Response {
  const newHeaders = new Headers(res.headers);
  newHeaders.set("X-Content-Type-Options", "nosniff");
  newHeaders.set("X-Frame-Options", "DENY");
  newHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  newHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  newHeaders.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // CSP for an API worker: only allow same-origin scripts, no inline.
  newHeaders.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'"
  );
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

// ---------------------------------------------------------------------------
// Rate limiting — sliding window via D1 (lazy cleanup on read)
// ---------------------------------------------------------------------------
export type RateLimitConfig = {
  // window in seconds, max requests per window
  windowSec: number;
  maxRequests: number;
};

export const DEFAULT_RATE_LIMITS = {
  // per IP: 100 req / minute
  ip: { windowSec: 60, maxRequests: 100 } satisfies RateLimitConfig,
  // per user: 60 req / minute (most endpoints), 10 req / minute (writes)
  user: { windowSec: 60, maxRequests: 60 } satisfies RateLimitConfig,
  userWrite: { windowSec: 60, maxRequests: 20 } satisfies RateLimitConfig,
};

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  cfg: RateLimitConfig
): Promise<{ ok: boolean; remaining: number; resetAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - cfg.windowSec;

  const existing = await db
    .prepare("SELECT count, window_start FROM rate_limit WHERE key = ?")
    .bind(key)
    .first<{ count: number; window_start: string }>();

  let newCount: number;
  let newStart: string;

  if (!existing) {
    newCount = 1;
    newStart = new Date(now * 1000).toISOString();
    await db
      .prepare("INSERT INTO rate_limit (key, count, window_start) VALUES (?, 1, ?)")
      .bind(key, newStart)
      .run();
  } else {
    const entryStart = Math.floor(new Date(existing.window_start).getTime() / 1000);
    if (entryStart < windowStart) {
      // Window expired, reset.
      newCount = 1;
      newStart = new Date(now * 1000).toISOString();
      await db
        .prepare("UPDATE rate_limit SET count = 1, window_start = ? WHERE key = ?")
        .bind(newStart, key)
        .run();
    } else {
      newCount = existing.count + 1;
      newStart = existing.window_start;
      await db
        .prepare("UPDATE rate_limit SET count = count + 1 WHERE key = ?")
        .bind(key)
        .run();
    }
  }

  const ok = newCount <= cfg.maxRequests;
  const remaining = Math.max(0, cfg.maxRequests - newCount);
  const resetAt = Math.floor(new Date(newStart).getTime() / 1000) + cfg.windowSec;
  return { ok, remaining, resetAt };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address")
  .transform((s) => s.toLowerCase());

export const uuidSchema = z.string().uuid("Invalid UUID");

export const networkIdSchema = z.string().min(1).max(100);

export const chainIdSchema = z.number().int().positive();

export const urlSchema = z.string().url();

export const newTransactionSchema = z.object({
  wallet_address: addressSchema,
  network_id: networkIdSchema,
  contract_id: z.string().optional().nullable(),
  tx_hash: z.string().max(80).optional().nullable(),
  status: z.enum(["pending", "success", "failed"]).default("pending"),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a decimal string"),
  recipients: z.string().optional().nullable(), // JSON string of address array
  child_contracts: z.string().optional().nullable(),
  gas_cost: z.string().optional().nullable(),
  error: z.string().max(500).optional().nullable(),
  timestamp: z.string().optional(),
});

export const updateTransactionSchema = newTransactionSchema.partial().extend({
  status: z.enum(["pending", "success", "failed"]).optional(),
});

export const newNetworkSchema = z.object({
  name: z.string().min(1).max(80),
  chain_id: chainIdSchema,
  rpc_url: urlSchema,
  currency_symbol: z.string().min(1).max(20),
  explorer_url: urlSchema,
  is_testnet: z.boolean(),
});

export const updateNetworkSchema = newNetworkSchema.partial();

export const newContractSchema = z.object({
  network_id: networkIdSchema,
  name: z.string().min(1).max(80),
  address: addressSchema,
});

export const updateContractSchema = newContractSchema.partial();

export const newWalletSchema = z.object({
  address: addressSchema,
  name: z.string().max(80).optional().nullable(),
  is_whitelisted: z.boolean().optional(),
});

export const updateWalletSchema = newWalletSchema.partial();

export const newWalletGroupSchema = z.object({
  name: z.string().min(1).max(80),
  wallet_ids: z.array(uuidSchema).optional().default([]),
});

export const updateWalletGroupSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  wallet_ids: z.array(uuidSchema).optional(),
});

export function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function clientIp(req: Request): string {
  const cf = (req as any).cf as Record<string, string> | undefined;
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    cf?.ip ||
    "0.0.0.0"
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuidV4(): string {
  // Crypto.randomUUID is available in Workers runtime and Node 19+.
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  // Fallback (very rare in Workers).
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
