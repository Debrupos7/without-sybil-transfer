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

// Cache the (2.4 MB) chain list for the session: the modal used to
// re-download it every time it opened, and a failed download left it
// showing "Loading..." forever.
let cachedNetworks: ChainlistNetwork[] | null = null;
let cachedFetch: Promise<ChainlistNetwork[]> | null = null;

// Function to fetch networks from Chainlist
export const fetchChainlistNetworks = async (): Promise<ChainlistNetwork[]> => {
  if (cachedNetworks) return cachedNetworks;
  if (cachedFetch) return cachedFetch;

  cachedFetch = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // NOTE: this fetch is only allowed in the browser because
      // next.config.js lists https://chainlist.org in CSP connect-src.
      // It was never in that list before, so the browser refused the
      // request and the modal could never load — the main reason
      // Chainlist "stopped working".
      const response = await fetch('https://chainlist.org/rpcs.json', {
        signal: controller.signal,
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
