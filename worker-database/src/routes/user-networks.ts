// ============================================================================
// user-networks.ts — /user-networks route (CRUD for per-user custom networks)
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import {
  newNetworkSchema,
  updateNetworkSchema,
  nowIso,
  uuidV4,
} from "../security";

export const userNetworksRoute = new Hono<AppContext>();

userNetworksRoute.get("/", async (c) => {
  const user = c.get("user")!;
  const result = await c.env.DB.prepare(
    `SELECT * FROM user_networks WHERE user_id = ? ORDER BY name ASC`
  )
    .bind(user.sub)
    .all();
  return c.json({ networks: result.results || [] });
});

userNetworksRoute.post("/", async (c) => {
  const user = c.get("user")!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = newNetworkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const n = parsed.data;
  const id = uuidV4();
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO user_networks
       (id, user_id, name, chain_id, rpc_url, currency_symbol, explorer_url,
        is_testnet, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.sub,
      n.name,
      n.chain_id,
      n.rpc_url,
      n.currency_symbol,
      n.explorer_url,
      n.is_testnet ? 1 : 0,
      ts,
      ts
    )
    .run();
  const created = await c.env.DB.prepare(
    `SELECT * FROM user_networks WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ network: created }, 201);
});

userNetworksRoute.put("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = updateNetworkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const n = parsed.data;

  const existing = await c.env.DB.prepare(
    `SELECT id FROM user_networks WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  if (!existing) {
    return c.json({ error: "not_found", message: "Network not found" }, 404);
  }

  const sets: string[] = [];
  const binds: any[] = [];
  const fieldMap: Record<string, string> = {
    name: "name",
    chain_id: "chain_id",
    rpc_url: "rpc_url",
    currency_symbol: "currency_symbol",
    explorer_url: "explorer_url",
  };
  for (const [k, v] of Object.entries(n)) {
    if (v === undefined) continue;
    if (k === "is_testnet") {
      sets.push(`is_testnet = ?`);
      binds.push(v ? 1 : 0);
    } else if (fieldMap[k]) {
      sets.push(`${fieldMap[k]} = ?`);
      binds.push(v);
    }
  }
  if (sets.length === 0) {
    return c.json({ error: "bad_request", message: "No fields to update" }, 400);
  }
  sets.push("updated_at = ?");
  binds.push(nowIso());
  binds.push(id, user.sub);

  await c.env.DB.prepare(
    `UPDATE user_networks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
  )
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT * FROM user_networks WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .first();
  return c.json({ network: updated });
});

userNetworksRoute.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    `DELETE FROM user_networks WHERE id = ? AND user_id = ?`
  )
    .bind(id, user.sub)
    .run();
  if (!result.meta.changes) {
    return c.json({ error: "not_found", message: "Network not found" }, 404);
  }
  return c.json({ deleted: true, id });
});
