"use client";

// Interface for a Chainlist RPC entry
export interface ChainlistRPC {
  url: string;
  tracking?: string;
  isOpenSource?: boolean;
}

// Interface for a Chainlist explorer entry
export interface ChainlistExplorer {
  name: string;
  url: string;
  standard?: string;
  icon?: string;
}

// Interface for the native currency of a network
export interface ChainlistNativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

// Interface for a Chainlist network entry
export interface ChainlistNetwork {
  name: string;
  chain: string;
  icon?: string;
  rpc: (ChainlistRPC | string)[];
  features?: { name: string }[];
  faucets?: string[];
  nativeCurrency: ChainlistNativeCurrency;
  infoURL?: string;
  shortName?: string;
  chainId: number;
  networkId?: number;
  ens?: { registry: string };
  explorers?: ChainlistExplorer[];
}

// Well-known testnets whose names do NOT contain "test"/"testnet"
// (Sepolia, Holesky, Amoy, Mumbai, Goerli, Linea Sepolia, ...). The old
// isTestnet() only looked at the name, so all of these were imported as
// mainnets and then vanished from the Testnet tab in NetworkSelector.
const KNOWN_TESTNET_CHAIN_IDS = new Set([
  5, // Goerli
  11155111, // Sepolia
  17000, // Holesky
  80001, // Mumbai
  80002, // Amoy (Polygon)
  84532, // Base Sepolia
  59141, // Linea Sepolia
  421614, // Arbitrum Sepolia
  11155420, // Optimism Sepolia
  10143, // Monad Testnet
  998, // Hyperliquid EVM Testnet
  // Note: Monad mainnet (143) is deliberately NOT in this set.
]);

// The Chainlist list (~2.4 MB, 3,000+ chains) is fetched live from the
// direct API — https://chainlist.org/rpcs.json — every time it is
// needed, NOT from a bundled copy, so chains Chainlist adds later show
// up automatically. The old code cached the list forever for the whole
// browser session, so a chain added after the first load never appeared
// until the tab was reloaded. Now the cache lives for at most
// CHAINLIST_CACHE_TTL_MS and is revalidated in the background whenever
// the modal opens with stale data, plus a manual Refresh in the modal.
export const CHAINLIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedNetworks: ChainlistNetwork[] | null = null;
let cachedAt = 0;
let cachedFetch: Promise<ChainlistNetwork[]> | null = null;

export const getChainlistLastUpdated = (): Date | null =>
  cachedAt ? new Date(cachedAt) : null;

export const isChainlistCacheStale = (): boolean =>
  !cachedNetworks || Date.now() - cachedAt >= CHAINLIST_CACHE_TTL_MS;

// Function to fetch networks from Chainlist
export const fetchChainlistNetworks = async (opts?: { forceRefresh?: boolean }): Promise<ChainlistNetwork[]> => {
  const now = Date.now();
  const fresh = cachedNetworks !== null && now - cachedAt < CHAINLIST_CACHE_TTL_MS;
  if (cachedNetworks && fresh && !opts?.forceRefresh) return cachedNetworks;
  if (cachedFetch && !opts?.forceRefresh) return cachedFetch;

  cachedFetch = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // NOTE: this fetch is only allowed in the browser because
      // next.config.js lists https://chainlist.org in CSP connect-src.
      // It was never in that list before, so the browser refused the
      // request and the modal could never load — the main reason
      // Chainlist "stopped working".
      // cache: 'no-store' so the browser's HTTP cache cannot serve a
      // stale copy of the list either — freshness comes from the API.
      const response = await fetch('https://chainlist.org/rpcs.json', {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch chainlist data: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('Chainlist returned data in an unexpected format');
      }
      // Drop entries that can never be added: no usable chain ID / name.
      const networks = (data as ChainlistNetwork[]).filter(
        (n) => n && typeof n.chainId === 'number' && n.chainId > 0 && typeof n.name === 'string' && n.name.trim() !== ''
      );
      cachedNetworks = networks;
      cachedAt = Date.now();
      return networks;
    } catch (error) {
      // Allow a later retry after a failure instead of caching the error.
      cachedFetch = null;
      console.error('Error fetching chainlist networks:', error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  return cachedFetch;
};

// Re-fetch in the background without blocking the UI. The modal keeps
// showing the (possibly stale) list it already has and swaps in the
// fresh one when it arrives, so new chains appear automatically.
export const refreshChainlistNetworksInBackground = (): Promise<ChainlistNetwork[]> => {
  cachedFetch = null;
  return fetchChainlistNetworks({ forceRefresh: true });
};

// A usable RPC for ethers' JsonRpcProvider: http(s) only, no ${...}
// placeholders (e.g. https://mainnet.infura.io/v3/${INFURA_API_KEY}),
// no wss:// URLs, no empty strings.
const usableRpcUrls = (network: ChainlistNetwork): string[] => {
  const rpcs = Array.isArray(network.rpc) ? network.rpc : [];
  const urls = rpcs
    .map((rpc) => (typeof rpc === 'string' ? rpc : rpc?.url))
    .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
    .map((url) => url.trim())
    .filter((url) => url.startsWith('http://') || url.startsWith('https://'))
    .filter((url) => !url.includes('${'));
  // De-duplicate, preserving Chainlist's order (most preferred first).
  return [...new Set(urls)];
};

// Function to get the best RPC URL from a network.
// Returns '' when the network has no usable HTTP RPC — callers must
// check for that instead of saving an empty / wss / placeholder URL.
// The old version crashed here on chains with an empty rpc list
// (network.rpc[0].url on undefined) and happily returned wss:// and
// ${PLACEHOLDER} URLs that can never be used as an RPC.
export const getBestRpcUrl = (network: ChainlistNetwork): string => {
  const urls = usableRpcUrls(network);
  if (urls.length === 0) return '';

  const rpcs = Array.isArray(network.rpc) ? network.rpc : [];
  const urlOf = (rpc: ChainlistRPC | string) =>
    typeof rpc === 'string' ? rpc : rpc?.url;
  // Prefer a tracking-free RPC, then any usable one.
  const trackingNone = rpcs.find(
    (rpc) => typeof rpc !== 'string' && rpc?.tracking === 'none' && urls.includes(urlOf(rpc))
  );
  if (trackingNone) return urlOf(trackingNone);
  return urls[0];
};

// Function to get the explorer URL from a network.
// Returns the explorer base URL with no trailing slash and no /tx
// suffix (e.g. https://testnet.monadexplorer.com), because the app
// builds links as `${explorer}/address/...` and `${explorer}/tx/...`.
// The old version returned a trailing slash (and, for user-added
// networks, /tx/ URLs were stored), producing broken //address/ and
// /tx/tx/ links. Returns '' when the chain has no explorer — callers
// must treat explorer as optional, not as a required field.
export const getExplorerUrl = (network: ChainlistNetwork): string => {
  if (!network.explorers || network.explorers.length === 0) return '';
  const url = (network.explorers[0]?.url || '').trim();
  if (!url) return '';
  return url.replace(/\/tx\/?$/, '').replace(/\/+$/, '');
};

// Function to determine if a network is a testnet
export const isTestnet = (network: ChainlistNetwork): boolean => {
  if (KNOWN_TESTNET_CHAIN_IDS.has(network.chainId)) return true;
  const haystack = [
    network.name,
    network.shortName || '',
    network.chain || '',
  ]
    .join(' ')
    .toLowerCase();
  return (
    haystack.includes('testnet') ||
    haystack.includes('test') ||
    haystack.includes('sepolia') ||
    haystack.includes('holesky') ||
    haystack.includes('goerli') ||
    haystack.includes('amoy') ||
    haystack.includes('mumbai') ||
    haystack.includes('devnet')
  );
};

// Function to search networks by a query string
export const searchNetworks = (networks: ChainlistNetwork[], query: string, limit = 10): ChainlistNetwork[] => {
  if (!query.trim() || !networks.length) return [];

  const normalizedQuery = query.toLowerCase().trim();

  return networks
    .filter(network =>
      network.name.toLowerCase().includes(normalizedQuery) ||
      network.shortName?.toLowerCase().includes(normalizedQuery) ||
      network.chain?.toLowerCase().includes(normalizedQuery) ||
      network.chainId.toString().includes(normalizedQuery)
    )
    .slice(0, limit);
};
