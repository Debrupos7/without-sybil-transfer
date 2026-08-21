// ============================================================================
// contracts.ts — /contracts route (deployed main contracts; address unique
// per network). Authenticated; the owner field tracks who deployed it.
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import { nowIso, uuidV4, addressSchema, networkIdSchema } from "../security";
import { z } from "zod";

export const contractsRoute = new Hono<AppContext>();

contractsRoute.get("/", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT * FROM contracts ORDER BY deployed_at DESC`
  ).all();
  return c.json({ contracts: result.results || [] });
});

const postSchema = z.object({
  network_id: networkIdSchema,
  address: addressSchema,
  owner: z.string().optional(),
});

contractsRoute.post("/", async (c) => {
  const user = c.get("user")!;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Invalid JSON body" }, 400);
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", issues: parsed.error.issues }, 400);
  }
  const ct = parsed.data;
  const id = uuidV4();
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO contracts (id, network_id, address, owner, deployed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(network_id, address) DO UPDATE SET
       owner = excluded.owner,
       updated_at = excluded.updated_at`
  )
    .bind(id, ct.network_id, ct.address, ct.owner || user.sub, ts, ts)
    .run();
  const created = await c.env.DB.prepare(
    `SELECT * FROM contracts WHERE network_id = ? AND address = ?`
  )
    .bind(ct.network_id, ct.address)
    .first();
  return c.json({ contract: created }, 201);
});

contractsRoute.get("/:network_id/:address", async (c) => {
  const networkId = c.req.param("network_id");
  const addr = c.req.param("address")?.toLowerCase();
  const row = await c.env.DB.prepare(
    `SELECT * FROM contracts WHERE network_id = ? AND address = ?`
  )
    .bind(networkId, addr)
    .first();
  if (!row) {
    return c.json({ error: "not_found", message: "Contract not found" }, 404);
  }
  return c.json({ contract: row });
});
