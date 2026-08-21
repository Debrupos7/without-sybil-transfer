// ============================================================================
// supabaseClient.ts — Supabase client for AUTH ONLY
// ----------------------------------------------------------------------------
// IMPORTANT: As of the Cloudflare Worker + D1 migration, Supabase is NO LONGER
// used for data storage. The Worker (worker-database/) is the new source of
// truth for transactions, wallets, networks, contracts, and wallet groups.
//
// What Supabase is STILL used for:
//   - User authentication (sign up, sign in, sign out, password reset)
//   - JWT issuance (the Worker verifies these JWTs)
//
// What Supabase is NO LONGER used for:
//   - Any data reads or writes
//   - All `supabase.from('...')` calls have been migrated to the Worker
//     via the helpers in `@/utils/workerClient`.
//
// The Supabase database itself is kept as a BACKUP — it has not been deleted.
// ============================================================================

"use client";

import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client (for auth only)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Missing Supabase environment variables. Set in .env.local:\n" +
      "NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\n" +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key"
  );
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
      global: {
        headers: {
          "X-Client-Info": `sybil-transfer-webapp/1.0.0`,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
      },
      realtime: { timeout: 30000 },
    })
  : createClient("https://mock.supabase.co", "mock-key", {
      auth: { persistSession: false },
    });

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------
// These types and helpers used to be defined here; they're now in workerClient.ts
// so existing imports don't break.
export {
  sanitizeInput,
  isValidEthereumAddress,
  executeSecureQuery,
} from "./workerClient";
export type {
  UserWallet,
  Network,
  Transaction,
  UserContract,
  WalletGroup,
} from "./workerClient";
