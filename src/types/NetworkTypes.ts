export interface NetworkInfo {
  id?: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  currencySymbol: string;
  explorerUrl: string;
  isTestnet?: boolean;
} 