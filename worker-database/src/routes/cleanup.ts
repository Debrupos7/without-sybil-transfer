// ============================================================================
// cleanup.ts — /cleanup-transactions route (admin-only)
// ----------------------------------------------------------------------------
// POST   /cleanup-transactions          — delete transactions older than 7 days
// GET    /cleanup-transactions          — count what would be deleted (preview)
//
// Auth: caller must be in ADMIN_USER_IDS env list OR present the legacy
// CLEANUP_API_KEY bearer. Both checks go through the auth middleware first
// (so the caller still needs a valid JWT), then this route checks the admin
// allowlist.
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import { safeEqual } from "../security";

export const cleanupRoute = new Hono<AppContext>();

function isAdmin(c: import("hono").Context<AppContext, "/", any>): boolean {
  const user = c.get("user")!;
  // Admin allowlist
  const adminIds = (c.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  if (adminIds.includes(user.sub)) return true;
  // Legacy bearer
  const legacyKey = c.env.CLEANUP_API_KEY;
  if (legacyKey) {
    const authHeader = c.req.raw.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token && safeEqual(token, legacyKey)) return true;
  }
  return false;
}

cleanupRoute.get("/", async (c) => {
  const user = c.get("user")!;
  if (!isAdmin(c)) {
    return c.json({ error: "forbidden", message: "Admin access required" }, 403);
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM transactions WHERE timestamp < ?`
  )
    .bind(sevenDaysAgo)
    .first<{ n: number }>();
  return c.json({
    called_by: user.sub,
    older_than: sevenDaysAgo,
    old_transactions_count: row?.n ?? 0,
  });
});

cleanupRoute.post("/", async (c) => {
  const user = c.get("user")!;
  if (!isAdmin(c)) {
    return c.json({ error: "forbidden", message: "Admin access required" }, 403);
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await c.env.DB.prepare(
    `DELETE FROM transactions WHERE timestamp < ?`
  )
    .bind(sevenDaysAgo)
    .run();
  return c.json({
    called_by: user.sub,
    older_than: sevenDaysAgo,
    deleted_count: result.meta.changes || 0,
  });
});
