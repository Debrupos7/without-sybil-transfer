"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { ethers } from 'ethers';
import {
  getUserNetworks,
  getUserContracts,
  createUserNetwork,
  updateUserNetwork,
  deleteUserNetwork,
  createUserContract,
  deleteUserContract,
  upsertWallet,
  getNetworks,
  workerPost,
  workerGet,
  workerPut,
  workerDelete,
} from '@/utils/workerClient';
import MainContractABI from '@/utils/MainContractABI.json';
import { NetworkInfo } from '@/types/NetworkTypes';
import { useAuth } from './AuthContext';

// Add Ethereum provider type
declare global {
  interface Window {
    ethereum?: any;
  }
}

// Remove the redundant NetworkInfo type since we're importing it
type Web3ContextType = {
  account: string | null;
  provider: ethers.providers.Web3Provider | null;
  signer: ethers.Signer | null;
  networkType: 'mainnet' | 'testnet';
  selectedNetwork: NetworkInfo | null;
  isOwner: boolean;
  isWhitelisted: boolean;
  availableNetworks: {
    mainnet: Record<string, NetworkInfo>;
    testnet: Record<string, NetworkInfo>;
  };
  userNetworks: NetworkInfo[];
  userContracts: UserContract[];
  addNetwork: (network: Omit<NetworkInfo, 'id'>) => Promise<any>;
  editNetwork: (id: string, network: Partial<NetworkInfo>) => Promise<any>;
  deleteNetwork: (id: string) => Promise<void>;
  addContract: (contract: Omit<UserContract, 'id'>) => Promise<UserContract>;
  editContract: (id: string, contract: Partial<UserContract>) => Promise<UserContract>;
  deleteContract: (id: string) => Promise<void>;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: (chainId: number, network?: NetworkInfo) => Promise<boolean>;
  setNetworkType: (type: 'mainnet' | 'testnet') => void;
  // Returns false when a connected wallet refused / failed to switch, so
  // callers can revert the UI instead of showing a network the wallet
  // is not actually on. Returns true when there is no wallet to switch.
  selectNetwork: (networkKey: string) => Promise<boolean>;
  setSelectedNetwork: (network: NetworkInfo | null) => void;
  checkContractPermissions: () => Promise<void>;
  contractABI: any;
  getContractInstance: (address: string) => ethers.Contract | null;
  getProvider: (rpcUrl: string) => ethers.providers.JsonRpcProvider | null;
};

// Define user contract type
type UserContract = {
  id: string;
  user_id: string;
  network_id: string;
  name: string;
  address: string;
  created_at: string;
};

// Create context with default value
const Web3Context = createContext<Web3ContextType | null>(null);

export const useWeb3 = () => {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error('useWeb3 must be used within a Web3Provider');
  }
  return context;
};

export const Web3Provider = ({ children }: { children: ReactNode }) => {
  const { user, session } = useAuth();
  const accessToken = session?.access_token;
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [networkType, setNetworkType] = useState<'mainnet' | 'testnet'>('mainnet');
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkInfo | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [availableNetworks, setAvailableNetworks] = useState<{
    mainnet: Record<string, NetworkInfo>;
    testnet: Record<string, NetworkInfo>;
  }>({
    mainnet: {},
    testnet: {},
  });
  const [userNetworks, setUserNetworks] = useState<NetworkInfo[]>([]);
  const [userContracts, setUserContracts] = useState<UserContract[]>([]);
  // Chain the user explicitly asked to switch to. While this is set and
  // the wallet has not yet moved to it, the wallet-sync effect below must
  // NOT revert the UI back to the wallet's old chain (that was the
  // /admin bug: picking anything other than the wallet's current chain,
  // e.g. away from Monad Testnet, snapped straight back to Monad).
  const pendingSwitchRef = useRef<number | null>(null);

  // Load network configurations and user-specific data
  useEffect(() => {
    const loadNetworks = async () => {
      try {
        // Load networks from the Worker (default + user networks, organized
        // by mainnet/testnet). Worker requires auth — fetch the session token.
        if (!accessToken) {
          console.warn('No session token; cannot load networks from Worker');
          return;
        }
        const { data, error } = await getNetworks(accessToken);
        if (error || !data) {
          console.error('Failed to load networks from Worker:', error);
          return;
        }
        setAvailableNetworks(data as any);

        // Set default network
        if (data.mainnet && Object.keys(data.mainnet).length > 0) {
          const firstNetwork = Object.keys(data.mainnet)[0];
          setSelectedNetwork(data.mainnet[firstNetwork] as NetworkInfo);
        }
      } catch (error) {
        console.error('Failed to load network configurations:', error);
      }
    };

    loadNetworks();
  }, [user]);

  // Load user-specific networks and contracts
  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;

      try {
        // Load user networks via Worker
        const { data: networks } = await getUserNetworks(accessToken);

        if (networks) {
          // Map snake_case to camelCase for the NetworkInfo type
          const mappedNetworks = networks.map(network => ({
            ...network,
            id: network.id,
            name: network.name,
            chainId: network.chain_id,
            rpcUrl: network.rpc_url,
            currencySymbol: network.currency_symbol,
            explorerUrl: network.explorer_url,
            isTestnet: Boolean(network.is_testnet) // Ensure Boolean conversion
          }));
          setUserNetworks(mappedNetworks);
        }

        // Load user contracts via Worker
        const { data: contracts } = await getUserContracts(accessToken);

        if (contracts) {
          setUserContracts(contracts as any);
        }
      } catch (error) {
        console.error('Failed to load user data:', error);
      }
    };

    loadUserData();
  }, [user, accessToken]);

  // Handle account changes
  useEffect(() => {
    if (provider && account && window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          // User disconnected their wallet
          disconnectWallet();
        } else if (accounts[0] !== account) {
          // User switched accounts
          setAccount(accounts[0]);
        }
      };

      const handleChainChanged = (chainId: string) => {
        pendingSwitchRef.current = null;
        // Force page refresh on chain change
        window.location.reload();
      };

      // Subscribe to events
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      // Cleanup
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, [provider, account]);

  // Check contract permissions when account or selected network changes
  useEffect(() => {
    if (account && selectedNetwork) {
      checkContractPermissions();
    }
  }, [account, selectedNetwork]);

  // Fix circular dependency issues by moving the autoConnect logic to a separate effect
  useEffect(() => {
    // This effect attempts to reconnect the wallet when the component mounts
    const autoConnectWallet = async () => {
      // Check if there's a connected wallet and Ethereum provider is available
      if (window.ethereum && !account && user) {
        try {
          // Check if wallet is already connected in the browser
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          
          // If the user has an account already connected, restore the connection
          if (accounts && accounts.length > 0) {
            console.log('Auto-reconnecting wallet:', accounts[0]);
            const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
            const web3Signer = web3Provider.getSigner();
            
            setAccount(accounts[0]);
            setProvider(web3Provider);
            setSigner(web3Signer);
            
            // Store last connected wallet info via Worker (user_id forced from JWT)
            if (user) {
              await upsertWallet({
                address: accounts[0].toLowerCase(),
              }, accessToken);
            }
          }
        } catch (error) {
          console.error('Error auto-connecting wallet:', error);
        }
      }
    };
    
    autoConnectWallet();
  }, [account, user]);

  // Sync the UI to the wallet's chain on connect / when the network
  // lists load — but NOT on every selectedNetwork change. The old effect
  // depended on selectedNetwork, so any explicit choice in /admin (which
  // only called setSelectedNetwork, never switchNetwork) was immediately
  // undone: the wallet was still on its old chain, so the effect reverted
  // the dropdown to that chain. A user on Monad Testnet could therefore
  // never leave Monad from /admin. This effect now only runs when the
  // wallet, or the lists it can match against, change, and it stays out
  // of the way while a user-requested switch is pending.
  useEffect(() => {
    const syncNetworkWithWallet = async () => {
      if (!window.ethereum || !account) return;
      try {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        const currentChainId = parseInt(chainIdHex, 16);

        // A switch the user asked for is in flight: the wallet is still
        // on the old chain by design. Do not revert the new selection.
        if (pendingSwitchRef.current !== null && pendingSwitchRef.current !== currentChainId) {
          return;
        }
        pendingSwitchRef.current = null;

        if (!selectedNetwork || selectedNetwork.chainId !== currentChainId) {
          console.log('Syncing selected network with wallet network. Chain ID:', currentChainId);
          const matchingUserNetwork = userNetworks.find(n => n.chainId === currentChainId);
          if (matchingUserNetwork && matchingUserNetwork.id) {
            console.log(`Auto-selecting network ${matchingUserNetwork.name} to match wallet's current network`);
            setNetworkType(matchingUserNetwork.isTestnet ? 'testnet' : 'mainnet');
            setSelectedNetwork(matchingUserNetwork);
          } else {
            for (const type of ['mainnet', 'testnet'] as const) {
              for (const [, network] of Object.entries(availableNetworks[type])) {
                if (network.chainId === currentChainId) {
                  console.log(`Auto-selecting default network ${network.name} to match wallet's current network`);
                  setNetworkType(type);
                  setSelectedNetwork(network);
                  return;
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error syncing network with wallet:', error);
      }
    };

    syncNetworkWithWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, userNetworks, availableNetworks]);

  // Add a new user network
  const addNetwork = async (network: Omit<NetworkInfo, 'id'>) => {
    if (!user) throw new Error('User not authenticated');

    // Make sure the is_testnet flag is properly set
    const isTestnet = Boolean(network.isTestnet);
    console.log(`Adding network: ${network.name}, isTestnet: ${isTestnet}`);

    const { data, error } = await createUserNetwork({
      name: network.name,
      chain_id: network.chainId,
      rpc_url: network.rpcUrl,
      currency_symbol: network.currencySymbol,
      explorer_url: network.explorerUrl,
      is_testnet: isTestnet,
    }, accessToken);

    if (error) throw error;

    const networkData = data!.network;
    const mappedNetwork = {
      id: networkData.id,
      name: networkData.name,
      chainId: networkData.chain_id,
      rpcUrl: networkData.rpc_url,
      currencySymbol: networkData.currency_symbol,
      explorerUrl: networkData.explorer_url,
      isTestnet: Boolean(networkData.is_testnet)
    };

    // Update local state
    setUserNetworks([...userNetworks, mappedNetwork]);

    return mappedNetwork;
  };

  // Edit a user network
  const editNetwork = async (id: string, network: Partial<NetworkInfo>) => {
    if (!user) throw new Error('User not authenticated');

    const updateData: any = {
      name: network.name,
      chain_id: network.chainId,
      rpc_url: network.rpcUrl,
      currency_symbol: network.currencySymbol,
      explorer_url: network.explorerUrl,
    };

    // Only include is_testnet if it's defined in the update
    if (network.isTestnet !== undefined) {
      updateData.is_testnet = Boolean(network.isTestnet);
      console.log(`Editing network ${id}, setting isTestnet: ${updateData.is_testnet}`);
    }

    const { data, error } = await updateUserNetwork(id, updateData, accessToken);

    if (error) throw error;

    // Manually map the returned data to ensure isTestnet is properly set
    const networkData = data!.network;
    const mappedNetwork = {
      id: networkData.id,
      name: networkData.name,
      chainId: networkData.chain_id,
      rpcUrl: networkData.rpc_url,
      currencySymbol: networkData.currency_symbol,
      explorerUrl: networkData.explorer_url,
      isTestnet: Boolean(networkData.is_testnet)
    };

    // Update local state
    setUserNetworks(userNetworks.map(n => n.id === id ? mappedNetwork : n));

    return mappedNetwork;
  };

  // Delete a user network
  const deleteNetwork = async (id: string) => {
    if (!user) throw new Error('User not authenticated');

    const { error } = await deleteUserNetwork(id, accessToken);

    if (error) throw error;

    // Update local state
    setUserNetworks(userNetworks.filter(n => n.id !== id));

    // Also delete associated contracts
    setUserContracts(userContracts.filter(c => c.network_id !== id));
  };

  // Add a user contract
  const addContract = async (contract: Omit<UserContract, 'id'>) => {
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await createUserContract({
      network_id: contract.network_id,
      name: contract.name,
      address: contract.address,
    }, accessToken);

    if (error) throw error;
    if (!data?.contract) throw new Error('Server did not return the created contract');

    // The Worker returns { contract: {...} }, not the contract itself.
    // The old code appended the wrapper object as if it were a contract,
    // so the new row had address/name/network_id all undefined — and the
    // Dashboard table then crashed rendering it
    // (contract.address.substring(...) on undefined), which is the
    // "Application error: a client-side exception has occurred" seen
    // right after adding a contract. addNetwork/editNetwork already
    // unwrap data.network; contracts must unwrap data.contract the same way.
    const created = data.contract as UserContract;
    setUserContracts([...userContracts, created]);

    return created;
  };

  // Edit a user contract
  const editContract = async (id: string, contract: Partial<UserContract>) => {
    if (!user) throw new Error('User not authenticated');

    // Worker's PUT endpoint for user-contracts takes the same shape
    const { data, error } = await workerPut<{ contract: UserContract }>(`/user-contracts/${id}`, {
      name: contract.name,
      address: contract.address,
      network_id: contract.network_id,
    }, accessToken);

    if (error) throw error;
    if (!data?.contract) throw new Error('Server did not return the updated contract');

    // Same unwrap as addContract — do not store the { contract } wrapper.
    const updated = data.contract as UserContract;
    setUserContracts(userContracts.map(c => c.id === id ? updated : c));

    return updated;
  };

  // Delete a user contract
  const deleteContract = async (id: string) => {
    if (!user) throw new Error('User not authenticated');

    const { error } = await deleteUserContract(id, accessToken);

    if (error) throw error;

    // Update local state
    setUserContracts(userContracts.filter(c => c.id !== id));
  };

  // Connect wallet
  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        // Request account access
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
        const web3Signer = web3Provider.getSigner();
        
        setAccount(accounts[0]);
        setProvider(web3Provider);
        setSigner(web3Signer);
        
        // Save wallet info via Worker if user is logged in (user_id is forced from JWT)
        if (accounts[0] && user) {
          await upsertWallet({
            address: accounts[0].toLowerCase(),
          }, accessToken);
        }

        return accounts[0];
      } catch (error) {
        console.error('Error connecting to wallet:', error);
        throw error;
      }
    } else {
      window.alert('Please install MetaMask or another Ethereum wallet provider!');
      throw new Error('No Ethereum wallet detected');
    }
  };

  // Disconnect wallet
  const disconnectWallet = () => {
    pendingSwitchRef.current = null;
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setIsOwner(false);
    setIsWhitelisted(false);
  };

  // Switch the connected wallet to `chainId`. `network` must be the network
  // being switched TO: the old code used the (stale) selectedNetwork for
  // wallet_addEthereumChain, so adding an unlisted chain sent the wallet
  // the previous network's name/RPC/explorer instead of the new one's.
  // Returns false (instead of throwing) for a rejection / failed add, so
  // callers can revert the UI. Never retries a user rejection or a
  // pending-request error (-32002): retrying those just re-prompts MetaMask.
  const switchNetwork = async (chainId: number, network?: NetworkInfo): Promise<boolean> => {
    if (!window.ethereum) {
      console.error('No Ethereum wallet detected');
      return false;
    }
    const target = network || selectedNetwork;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
      return true;
    } catch (switchError: any) {
      if (switchError?.code === 4001 || switchError?.code === -32002) {
        console.error('Network switch rejected or already pending:', switchError);
        return false;
      }
      if (switchError?.code === 4902 && target) {
        try {
          // explorerUrl may be a "/tx/" URL (e.g. Monad's
          // https://testnet.monadexplorer.com/tx/) or missing entirely;
          // only pass blockExplorerUrls when we actually have one, and
          // never call .split() on undefined (that crashed the add flow).
          const explorerBase = target.explorerUrl
            ? target.explorerUrl.split('/tx')[0].replace(/\/+$/, '')
            : undefined;
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: `0x${chainId.toString(16)}`,
                chainName: target.name,
                nativeCurrency: {
                  name: target.currencySymbol,
                  symbol: target.currencySymbol,
                  decimals: 18,
                },
                ...(target.rpcUrl ? { rpcUrls: [target.rpcUrl] } : {}),
                ...(explorerBase ? { blockExplorerUrls: [explorerBase] } : {}),
              },
            ],
          });
          return true;
        } catch (addError: any) {
          console.error('Error adding Ethereum chain:', addError);
          return false;
        }
      }
      console.error('Error switching Ethereum chain:', switchError);
      return false;
    }
  };

  // Select a network and, when a wallet is connected, switch the wallet
  // to it. The old version was fire-and-forget (switchNetwork().catch),
  // so /admin could show a network the wallet was never switched to —
  // and the sync effect then snapped it back. This returns whether the
  // wallet switch succeeded and reverts the UI on failure.
  const selectNetwork = async (networkKey: string): Promise<boolean> => {
    const userNetwork = userNetworks.find(n => n.id === networkKey);
    const network = userNetwork || availableNetworks[networkType]?.[networkKey];
    if (!network) return false;

    const previous = selectedNetwork;
    const previousType = networkType;
    const isTestnetNetwork = Boolean(network.isTestnet);
    console.log(`Selecting network: ${network.name}, isTestnet: ${isTestnetNetwork}`);
    setNetworkType(isTestnetNetwork ? 'testnet' : 'mainnet');
    setSelectedNetwork(network);

    if (provider && account) {
      pendingSwitchRef.current = network.chainId;
      const ok = await switchNetwork(network.chainId, network);
      if (!ok) {
        // Wallet did not move: do not leave the UI on a chain the wallet
        // is not on (contract calls would go to the wrong chain).
        pendingSwitchRef.current = null;
        setNetworkType(previousType);
        setSelectedNetwork(previous);
        return false;
      }
      // chainChanged reloads the page on most wallets; if it does not,
      // the pending flag keeps the sync effect from reverting us.
    }
    return true;
  };

  // Check contract permissions (owner, whitelist)
  const checkContractPermissions = async () => {
    if (!account || !provider || !selectedNetwork) {
      setIsOwner(false);
      setIsWhitelisted(false);
      return;
    }

    try {
      // Fetch contract address via Worker (GET /contracts/:network_id/:address
      // would need the address; we use GET /contracts to list all, then
      // filter by network_id client-side)
      const { data: contractsList, error } = await workerGet<{ contracts: any[] }>('/contracts', accessToken);
      if (error || !contractsList) {
        setIsOwner(false);
        setIsWhitelisted(false);
        return;
      }
      const contractData = contractsList.contracts?.find(
        (c) => c.network_id === selectedNetwork.id || c.network_id === selectedNetwork.chainId?.toString()
      );

      if (!contractData?.address) {
        setIsOwner(false);
        setIsWhitelisted(false);
        return;
      }

      // Use the contract data from the Worker
      const contract = new ethers.Contract(
        contractData.address,
        MainContractABI,
        provider
      );

      // Check if current account is owner
      try {
        const ownerAddress = await contract.owner();
        const currentIsOwner = ownerAddress.toLowerCase() === account.toLowerCase();
        setIsOwner(currentIsOwner);
      } catch (error) {
        console.error('Error checking owner:', error);
        setIsOwner(false);
      }

      // Check if current account is whitelisted
      try {
        const currentIsWhitelisted = await contract.isWhitelisted(account);
        setIsWhitelisted(currentIsWhitelisted);
      } catch (error) {
        console.error('Error checking whitelist:', error);
        setIsWhitelisted(false);
      }
    } catch (error) {
      console.error('Error checking contract permissions:', error);
      setIsOwner(false);
      setIsWhitelisted(false);
    }
  };

  // Get contract instance with current signer
  const getContractInstance = (address: string) => {
    if (!signer) return null;
    return new ethers.Contract(address, MainContractABI, signer);
  };

  // Create a provider for a specific RPC URL
  const getProvider = (rpcUrl: string): ethers.providers.JsonRpcProvider | null => {
    try {
      return new ethers.providers.JsonRpcProvider(rpcUrl);
    } catch (error) {
      console.error('Error creating provider for RPC URL:', rpcUrl, error);
      return null;
    }
  };

  const value = {
    account,
    provider,
    signer,
    networkType,
    selectedNetwork,
    isOwner,
    isWhitelisted,
    availableNetworks,
    userNetworks,
    userContracts,
    addNetwork,
    editNetwork,
    deleteNetwork,
    addContract,
    editContract,
    deleteContract,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    setNetworkType,
    selectNetwork,
    setSelectedNetwork,
    checkContractPermissions,
    contractABI: MainContractABI,
    getContractInstance,
    getProvider,
  };

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}; 