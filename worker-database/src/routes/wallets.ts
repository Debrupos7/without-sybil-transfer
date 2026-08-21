// ============================================================================
// wallets.ts — /wallets route (per-user saved wallets)
// ----------------------------------------------------------------------------
// One user can have many wallets. The address is stored lowercase.
// This table is what enables the email-based history lookup.
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import {
  newWalletSchema,
  updateWalletSchema,
  nowIso,
  uuidV4,
} from "../security";

export const walletsRoute = new Hono<AppContext>();

walletsRoute.get("/", async (c) => {
  const user = c.get("user")!;
  const result = await c.env.DB.prepare(
    `SELECT * FROM user_wallets WHERE user_id = ? ORDER BY created_at DESC`
  )
    .bind(user.sub)
    .all();
  return c.json({ wallets: result.results || [] });
});

walletsRoute.post("/", async (c) => {
  const user = c.get("user")!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = newWalletSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const w = parsed.data;
  const id = uuidV4();
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO user_wallets
       (id, user_id, address, name, is_whitelisted, last_connected, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, address) DO UPDATE SET
       name = COALESCE(excluded.name, user_wallets.name),
       is_whitelisted = excluded.is_whitelisted,
       last_connected = excluded.last_connected,
       updated_at = excluded.updated_at`
  )
    .bind(
      id,
      user.sub,
      w.address,                  // already lowercased by schema transform
      w.name ?? null,
      w.is_whitelisted ? 1 : 0,
      ts,
      ts,
      ts
    )
    .run();
  const created = await c.env.DB.prepare(
    `SELECT * FROM user_wallets WHERE user_id = ? AND address = ?`
  )
    .bind(user.sub, w.address)
    .first();
  return c.json({ wallet: created }, 201);
});

walletsRoute.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = updateWalletSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const w = parsed.data;

  const existing = await c.env.DB.prepare(
    `SELECT id FROM user_wallets WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  if (!existing) {
    return c.json({ error: "not_found", message: "Wallet not found" }, 404);
  }

  const sets: string[] = [];
  const binds: any[] = [];
  if (w.address !== undefined) {
    sets.push("address = ?");
    binds.push(w.address);
  }
  if (w.name !== undefined) {
    sets.push("name = ?");
    binds.push(w.name);
  }
  if (w.is_whitelisted !== undefined) {
    sets.push("is_whitelisted = ?");
    binds.push(w.is_whitelisted ? 1 : 0);
  }
  if (sets.length === 0) {
    return c.json({ error: "bad_request", message: "No fields to update" }, 400);
  }
  sets.push("updated_at = ?");
  binds.push(nowIso());
  binds.push(id, user.sub);

  await c.env.DB.prepare(
    `UPDATE user_wallets SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
  )
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT * FROM user_wallets WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ wallet: updated });
});

walletsRoute.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `DELETE FROM user_wallets WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "not_found", message: "Wallet not found" }, 404);
  }
  return c.json({ deleted: true, id });
});
