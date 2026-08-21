// ============================================================================
// workerClient.ts — Cloudflare Worker API client (replaces Supabase data calls)
// ----------------------------------------------------------------------------
// This module replaces direct Supabase database calls with calls to the
// Cloudflare Worker. The Worker handles:
//   - JWT verification (per-user auth, equivalent to Supabase RLS)
//   - Input validation (Zod)
//   - Rate limiting (per-IP + per-user)
//   - Audit logging
//   - Security headers
//
// AUTHENTICATION:
//   The Worker expects a Supabase access_token as a Bearer token. Get it from
//   the Supabase session in your React context:
//
//     import { supabase } from '@/utils/supabaseClient';
//     const { data } = await supabase.auth.getSession();
//     const token = data.session?.access_token;
//
//   Pass that token to every worker*() call below.
//
// ENVIRONMENT:
//   Set NEXT_PUBLIC_WORKER_URL in .env.local to your deployed Worker URL.
//   Example: https://sybil-transfer-worker.your-subdomain.workers.dev
// ============================================================================

"use client";

const WORKER_URL = (process.env.NEXT_PUBLIC_WORKER_URL || "").replace(/\/+$/, "");

// Get JWT from localStorage (set by authClient.ts)
function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sybil_transfer_token");
}

if (!WORKER_URL && typeof window !== "undefined") {
  console.warn(
    "NEXT_PUBLIC_WORKER_URL is not set. Worker API calls will fail.\n" +
      "Add it to .env.local:\n" +
      "  NEXT_PUBLIC_WORKER_URL=https://sybil-transfer-worker.<your-subdomain>.workers.dev"
  );
}

// ---------------------------------------------------------------------------
// Types (mirror of the D1 schema in worker-database/migrations/0001_init.sql)
// ---------------------------------------------------------------------------
export type UserWallet = {
  id: string;
  user_id: string;
  address: string;
  name: string | null;
  is_whitelisted: boolean;
  last_connected: string | null;
  created_at: string;
  updated_at: string;
};

export type Network = {
  id: string;
  name: string;
  chain_id: number;
  rpc_url: string;
  currency_symbol: string;
  explorer_url: string;
  is_testnet: boolean;
  // UI-friendly aliases (computed client-side):
  chainId?: number;
  rpcUrl?: string;
  currencySymbol?: string;
  explorerUrl?: string;
  isTestnet?: boolean;
};

export type Transaction = {
  id: string;
  user_id: string;
  wallet_address: string;
  network_id: string;
  contract_id: string | null;
  tx_hash: string | null;
  status: "pending" | "success" | "failed";
  amount: string;
  recipients: string | any[] | null;
  child_contracts: string | any[] | null;
  gas_cost: string | null;
  error: string | null;
  timestamp: string;
  updated_at: string;
};

export type UserContract = {
  id: string;
  user_id: string;
  network_id: string;
  name: string;
  address: string;
  created_at: string;
  updated_at: string;
};

export type WalletGroup = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  members: Array<{
    member_id: string;
    wallet_id: string;
    address: string;
    name: string | null;
  }>;
};

// ---------------------------------------------------------------------------
// Low-level fetch wrapper
// ---------------------------------------------------------------------------
async function workerFetch<T = any>(
  path: string,
  accessToken: string | null | undefined,
  init: RequestInit = {}
): Promise<{ data: T | null; error: Error | null; status: number }> {
  const token = accessToken || getStoredToken();
  if (!token) {
    return { data: null, error: new Error("No access token"), status: 401 };
  }
  if (!WORKER_URL) {
    return {
      data: null,
      error: new Error("NEXT_PUBLIC_WORKER_URL is not set"),
      status: 0,
    };
  }
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as any)?.message || (errBody as any)?.error || `HTTP ${res.status}`;
      return {
        data: null,
        error: new Error(msg),
        status: res.status,
      };
    }
    const data = (await res.json()) as T;
    return { data, error: null, status: res.status };
  } catch (e: any) {
    return { data: null, error: e, status: 0 };
  }
}

export const workerGet = <T = any>(path: string, token?: string | null) =>
  workerFetch<T>(path, token, { method: "GET" });

export const workerPost = <T = any>(path: string, body: unknown, token?: string | null) =>
  workerFetch<T>(path, token, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export const workerPut = <T = any>(path: string, body: unknown, token?: string | null) =>
  workerFetch<T>(path, token, {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export const workerDelete = <T = any>(path: string, token?: string | null) =>
  workerFetch<T>(path, token, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Convenience wrappers — these mirror the most common Supabase calls so
// existing components can switch with minimal changes.
// ---------------------------------------------------------------------------

/**
 * THE BUG FIX: get all transactions for the logged-in user, regardless of
 * which wallet is currently connected. Replaces:
 *
 *   const { data } = await supabase
 *     .from('transactions')
 *     .select('*')
 *     .eq('user_id', user.id)
 *     .order('timestamp', { ascending: false });
 *
 * The Worker ALWAYS scopes by the JWT sub (user_id), so this returns the
 * same set regardless of which wallet is connected.
 */
export async function getTransactionHistory(token?: string | null) {
  const { data, error, status } = await workerGet<{
    transactions: Transaction[];
    user_id: string;
    email: string;
    count: number;
  }>("/history", token);
  return { data: data?.transactions || null, error, status, raw: data };
}

/**
 * Create a new transaction. The user_id is forced by the Worker to be the
 * JWT sub — body's user_id is ignored. This is the bug fix at the data layer.
 */
export async function createTransaction(
  body: {
    wallet_address: string;
    network_id: string;
    contract_id?: string | null;
    tx_hash?: string | null;
    status?: "pending" | "success" | "failed";
    amount: string;
    recipients?: string | null;
    child_contracts?: string | null;
    gas_cost?: string | null;
    error?: string | null;
    timestamp?: string;
  },
  token?: string | null
) {
  return workerPost<{ transaction: Transaction }>("/transactions", body, token);
}

export async function updateTransaction(
  id: string,
  body: Partial<{
    wallet_address: string;
    network_id: string;
    contract_id: string | null;
    tx_hash: string | null;
    status: "pending" | "success" | "failed";
    amount: string;
    recipients: string | null;
    child_contracts: string | null;
    gas_cost: string | null;
    error: string | null;
  }>,
  token?: string | null
) {
  return workerPut<{ transaction: Transaction }>(`/transactions/${id}`, body, token);
}

export async function deleteTransaction(id: string, token?: string | null) {
  return workerDelete<{ deleted: boolean; id: string }>(`/transactions/${id}`, token);
}

// Wallets
export async function getWallets(token?: string | null) {
  const r = await workerGet<{ wallets: UserWallet[] }>("/wallets", token);
  return { data: r.data?.wallets || null, error: r.error, status: r.status };
}

export async function upsertWallet(
  body: { address: string; name?: string | null; is_whitelisted?: boolean },
  token?: string | null
) {
  return workerPost<{ wallet: UserWallet }>("/wallets", body, token);
}

export async function deleteWallet(id: string, token?: string | null) {
  return workerDelete<{ deleted: boolean; id: string }>(`/wallets/${id}`, token);
}

// User networks
export async function getUserNetworks(token?: string | null) {
  const r = await workerGet<{ networks: any[] }>("/user-networks", token);
  return { data: r.data?.networks || null, error: r.error, status: r.status };
}

export async function createUserNetwork(
  body: {
    name: string;
    chain_id: number;
    rpc_url: string;
    currency_symbol: string;
    explorer_url: string;
    is_testnet: boolean;
  },
  token?: string | null
) {
  return workerPost<{ network: any }>("/user-networks", body, token);
}

export async function updateUserNetwork(
  id: string,
  body: Partial<{
    name: string;
    chain_id: number;
    rpc_url: string;
    currency_symbol: string;
    explorer_url: string;
    is_testnet: boolean;
  }>,
  token?: string | null
) {
  return workerPut<{ network: any }>(`/user-networks/${id}`, body, token);
}

export async function deleteUserNetwork(id: string, token?: string | null) {
  return workerDelete<{ deleted: boolean; id: string }>(`/user-networks/${id}`, token);
}

// User contracts
export async function getUserContracts(token?: string | null, networkId?: string) {
  const path = networkId ? `/user-contracts?network_id=${encodeURIComponent(networkId)}` : "/user-contracts";
  const r = await workerGet<{ contracts: UserContract[] }>(path, token);
  return { data: r.data?.contracts || null, error: r.error, status: r.status };
}

export async function createUserContract(
  body: { network_id: string; name: string; address: string },
  token?: string | null
) {
  return workerPost<{ contract: UserContract }>("/user-contracts", body, token);
}

export async function deleteUserContract(id: string, token?: string | null) {
  return workerDelete<{ deleted: boolean; id: string }>(`/user-contracts/${id}`, token);
}

// Wallet groups
export async function getWalletGroups(token?: string | null) {
  const r = await workerGet<{ groups: WalletGroup[] }>("/wallet-groups", token);
  return { data: r.data?.groups || null, error: r.error, status: r.status };
}

export async function createWalletGroup(
  body: { name: string; wallet_ids?: string[] },
  token?: string | null
) {
  return workerPost<{ group: WalletGroup }>("/wallet-groups", body, token);
}

export async function deleteWalletGroup(id: string, token?: string | null) {
  return workerDelete<{ deleted: boolean; id: string }>(`/wallet-groups/${id}`, token);
}

export async function updateWalletGroup(
  id: string,
  body: { name: string; wallet_ids?: string[] },
  token?: string | null
) {
  return workerPut<{ group: WalletGroup }>(`/wallet-groups/${id}`, body, token);
}

// Networks (default + user, organized by mainnet/testnet)
export async function getNetworks(token?: string | null) {
  return workerGet<{
    mainnet: Record<string, Network>;
    testnet: Record<string, Network>;
  }>("/networks", token);
}

// ---------------------------------------------------------------------------
// Helpers (kept from the old supabaseClient.ts)
// ---------------------------------------------------------------------------
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .trim();
}

export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function executeSecureQuery<T>(
  queryFunction: () => Promise<T>,
  errorMessage = "Database query failed"
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const data = await queryFunction();
    return { data, error: null };
  } catch (error) {
    console.error(`${errorMessage}:`, error);
    return { data: null, error: error as Error };
  }
}

// Export the base URL so components can build absolute URLs if needed.
export const WORKER_URL_VALUE = WORKER_URL;
