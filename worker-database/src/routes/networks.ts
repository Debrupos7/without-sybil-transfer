// ============================================================================
// networks.ts — /networks route
// ----------------------------------------------------------------------------
// GET /networks — returns default networks (public, but still requires auth
//                because the whole worker requires auth).
//                If the user is authenticated, also returns their custom
//                user_networks merged in.
// ============================================================================

import { Hono } from "hono";
import type { AppContext } from "../index";

export const networksRoute = new Hono<AppContext>();

networksRoute.get("/", async (c) => {
  const user = c.get("user")!;

  // Fetch default networks (no user_id filter — they're public)
  const defaultRes = await c.env.DB.prepare(
    `SELECT * FROM default_networks ORDER BY is_testnet ASC, name ASC`
  ).all();

  // Fetch user's custom networks
  const userRes = await c.env.DB.prepare(
    `SELECT * FROM user_networks WHERE user_id = ? ORDER BY name ASC`
  )
    .bind(user.sub)
    .all();

  // Organize: { mainnet: {...}, testnet: {...} }
  const organized: any = { mainnet: {}, testnet: {} };

  for (const n of defaultRes.results || []) {
    const key = String((n as any).name).toLowerCase().replace(/\s+/g, "_");
    const entry = {
      id: (n as any).id,
      name: (n as any).name,
      chainId: (n as any).chain_id,
      rpcUrl: (n as any).rpc_url,
      currencySymbol: (n as any).currency_symbol,
      explorerUrl: (n as any).explorer_url,
      isTestnet: !!(n as any).is_testnet,
    };
    if (entry.isTestnet) organized.testnet[key] = entry;
    else organized.mainnet[key] = entry;
  }

  for (const n of userRes.results || []) {
    const key = `user_${(n as any).id}`;
    const entry = {
      id: (n as any).id,
      name: (n as any).name,
      chainId: (n as any).chain_id,
      rpcUrl: (n as any).rpc_url,
      currencySymbol: (n as any).currency_symbol,
      explorerUrl: (n as any).explorer_url,
      isTestnet: !!(n as any).is_testnet,
    };
    if (entry.isTestnet) organized.testnet[key] = entry;
    else organized.mainnet[key] = entry;
  }

  return c.json(organized);
});
