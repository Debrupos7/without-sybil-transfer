// ============================================================================
// history.ts — /history route (THE BUG FIX)
// ----------------------------------------------------------------------------
// ORIGINAL BUG (in the Supabase version):
//   In src/components/TransferForm.tsx line 507, the code did:
//       user_id: user?.id || account || ''
//   So if user.id was missing for any reason (race condition, session not
//   yet loaded, etc.), the wallet address was stored as user_id. Then
//   src/app/transactions/page.tsx line 155 queried `.eq('user_id', user.id)`,
//   which would miss any rows stored with the wallet address as user_id.
//   The symptom: switching wallets made prior transactions disappear.
//
// FIX:
//   1. The Worker ALWAYS requires a verified Supabase JWT.
//   2. The user_id of every transaction is FORCED to the JWT `sub` claim
//      (see routes/transactions.ts POST handler — body.user_id is ignored).
//   3. /history returns ALL transactions for the authenticated user,
//      regardless of which wallet is currently connected. The optional
//      `:wallet` query param lets the frontend filter the view, but the
//      auth scope is ALWAYS the JWT sub.
//   4. /history/by-email is provided as a convenience: it returns the same
//      result as /history, just confirming that the lookup is email-based.
//      (Email != auth scope; the auth scope is always the JWT sub.)
//
// ENDPOINTS:
//   GET /history                         — all of this user's transactions
//   GET /history?wallet=0x...            — filter to a specific wallet
//                                          (still scoped to the user)
//   GET /history/by-email                — same as /history, explicit alias
//   GET /history/wallets                 — list of wallets that signed txs
//                                          for this user (useful for the UI
//                                          to render "your wallets" even if
//                                          they're not in user_wallets)
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";
import { addressSchema } from "../security";

export const historyRoute = new Hono<AppContext>();

// GET /history
historyRoute.get("/", async (c) => {
  const user = c.get("user")!;
  const wallet = c.req.query("wallet");
  const limit = Math.min(parseInt(c.req.query("limit") || "200", 10), 500);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);

  // We ALWAYS scope by user_id (the JWT sub), never by wallet_address.
  // This is the core of the bug fix.
  let sql = `SELECT * FROM transactions WHERE user_id = ?`;
  const binds: any[] = [user.sub];

  if (wallet) {
    const parsed = addressSchema.safeParse(wallet);
    if (!parsed.success) {
      return c.json({ error: "validation_failed", message: "Invalid wallet address" }, 400);
    }
    sql += ` AND wallet_address = ?`;
    binds.push(parsed.data); // lowercased
  }

  sql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const result = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({
    user_id: user.sub,
    email: user.email,
    count: result.results?.length || 0,
    transactions: result.results || [],
  });
});

// GET /history/by-email — explicit alias; same auth scope (JWT sub)
historyRoute.get("/by-email", async (c) => {
  const user = c.get("user")!;
  // We deliberately ignore any `email` query param — the email is taken
  // from the verified JWT, so a user can never read another user's history
  // by passing a different email.
  const result = await c.env.DB.prepare(
    `SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 500`
  )
    .bind(user.sub)
    .all();
  return c.json({
    user_id: user.sub,
    email: user.email,
    count: result.results?.length || 0,
    transactions: result.results || [],
  });
});

// GET /history/wallets — list distinct wallets the user has ever signed with
historyRoute.get("/wallets", async (c) => {
  const user = c.get("user")!;
  const result = await c.env.DB.prepare(
    `SELECT DISTINCT wallet_address, COUNT(*) AS tx_count, MAX(timestamp) AS last_used
       FROM transactions
       WHERE user_id = ? AND wallet_address IS NOT NULL
       GROUP BY wallet_address
       ORDER BY last_used DESC`
  )
    .bind(user.sub)
    .all();
  return c.json({
    user_id: user.sub,
    email: user.email,
    wallets: result.results || [],
  });
});
