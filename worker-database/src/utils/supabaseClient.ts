"use client";

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Handle missing environment variables with better error messages
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Make sure you have set up .env.local with:');
  console.warn('NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co');
  console.warn('NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key');
}

// Create and export the Supabase client with a fallback for development/testing
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Use implicit flow which works better with Supabase RLS
        flowType: 'implicit',
        // Cookie settings are handled by the browser
      },
      db: {
        schema: 'public',
      },
      global: {
        headers: {
          'X-Client-Info': `sybil-transfer-webapp/1.0.0`,
          // Add security headers
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
        },
      },
      // Set shorter timeouts for better security
      realtime: {
        timeout: 30000, // 30 seconds
      },
    })
  : createClient('https://mock.supabase.co', 'mock-key', {
      auth: { persistSession: false },
    });

// Helper function to securely execute queries
export async function executeSecureQuery<T>(
  queryFunction: () => Promise<T>,
  errorMessage = 'Database query failed'
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const data = await queryFunction();
    return { data, error: null };
  } catch (error) {
    console.error(`${errorMessage}:`, error);
    return { data: null, error: error as Error };
  }
}

// Helper function to sanitize data before storing in database
export function sanitizeInput(input: string): string {
  // Basic sanitization to prevent SQL injection and XSS
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
    .trim();
}

// Helper to validate blockchain addresses
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Types for Supabase tables
export type UserWallet = {
  id: string;
  user_id: string;
  address: string;
  name: string;
  is_whitelisted: boolean;
  created_at: string;
};

export type Network = {
  id: string;
  name: string;
  chain_id: number;
  rpc_url: string;
  currency_symbol: string;
  explorer_url: string;
  is_testnet: boolean;
};

export type Transaction = {
  id: string;
  user_id: string;
  wallet_address: string;
  network_id: string;
  contract_id: string;
  tx_hash: string;
  status: 'pending' | 'success' | 'failed';
  amount: string;
  recipients: any;
  timestamp: string;
  error?: string;
  gas_cost?: string;
  child_contracts?: any;
}; 