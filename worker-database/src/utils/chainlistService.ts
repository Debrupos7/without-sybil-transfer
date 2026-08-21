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

// Function to fetch networks from Chainlist
export const fetchChainlistNetworks = async (): Promise<ChainlistNetwork[]> => {
  try {
    const response = await fetch('https://chainlist.org/rpcs.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch chainlist data: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data as ChainlistNetwork[];
  } catch (error) {
    console.error('Error fetching chainlist networks:', error);
    throw error;
  }
};

// Function to get the best RPC URL from a network
export const getBestRpcUrl = (network: ChainlistNetwork): string => {
  // First try to find an RPC with no tracking and that isn't a WebSocket URL
  const trackingNoneRpc = network.rpc
    .filter(rpc => {
      if (typeof rpc === 'string') return !rpc.startsWith('wss://');
      return rpc.url && !rpc.url.startsWith('wss://') && rpc.tracking === 'none';
    })
    .map(rpc => typeof rpc === 'string' ? rpc : rpc.url)[0];
    
  if (trackingNoneRpc) return trackingNoneRpc;
  
  // If no tracking-free RPC is found, get the first non-WebSocket URL
  const anyRpc = network.rpc
    .filter(rpc => {
      if (typeof rpc === 'string') return !rpc.startsWith('wss://');
      return rpc.url && !rpc.url.startsWith('wss://');
    })
    .map(rpc => typeof rpc === 'string' ? rpc : rpc.url)[0];
    
  if (anyRpc) return anyRpc;
  
  // If only WebSocket URLs are available, return the first one
  const firstRpc = network.rpc[0];
  return typeof firstRpc === 'string' ? firstRpc : firstRpc.url;
};

// Function to get the explorer URL from a network
export const getExplorerUrl = (network: ChainlistNetwork): string => {
  if (!network.explorers || network.explorers.length === 0) return '';
  
  // Get the explorer URL, ensure it ends with a slash
  const explorerUrl = network.explorers[0].url;
  return explorerUrl.endsWith('/') ? explorerUrl : `${explorerUrl}/`;
};

// Function to determine if a network is a testnet
export const isTestnet = (network: ChainlistNetwork): boolean => {
  return network.name.toLowerCase().includes('testnet') || 
         network.name.toLowerCase().includes('test') ||
         network.shortName?.toLowerCase().includes('test') || 
         false;
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