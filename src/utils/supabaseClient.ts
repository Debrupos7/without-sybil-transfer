// ============================================================================
// supabaseClient.ts — DEPRECATED, kept as stub for backward compatibility
// ----------------------------------------------------------------------------
// Supabase is no longer used. Auth is handled by the Cloudflare Worker.
// See authClient.ts for the new auth implementation.
// ============================================================================

"use client";

// Re-export from workerClient for backward compatibility
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
