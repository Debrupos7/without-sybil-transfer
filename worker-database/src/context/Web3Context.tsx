"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ethers } from 'ethers';
import { supabase } from '@/utils/supabaseClient';
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
  addNetwork: (network: Omit<NetworkInfo, 'id'>) => Promise<void>;
  editNetwork: (id: string, network: Partial<NetworkInfo>) => Promise<void>;
  deleteNetwork: (id: string) => Promise<void>;
  addContract: (contract: Omit<UserContract, 'id'>) => Promise<void>;
  editContract: (id: string, contract: Partial<UserContract>) => Promise<void>;
  deleteContract: (id: string) => Promise<void>;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: (chainId: number) => Promise<boolean | undefined>;
  setNetworkType: (type: 'mainnet' | 'testnet') => void;
  selectNetwork: (networkKey: string) => void;
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
  const { user } = useAuth();
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

  // Load network configurations and user-specific data
  useEffect(() => {
    const loadNetworks = async () => {
      try {
        // Load default networks from API
        const response = await fetch('/api/networks');
        if (response.ok) {
          const data = await response.json();
          setAvailableNetworks(data);
          
          // Set default network
          if (data.mainnet && Object.keys(data.mainnet).length > 0) {
            const firstNetwork = Object.keys(data.mainnet)[0];
            setSelectedNetwork(data.mainnet[firstNetwork]);
          }
        }
      } catch (error) {
        console.error('Failed to load network configurations:', error);
      }
    };

    loadNetworks();
  }, []);

  // Load user-specific networks and contracts
  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;
      
      try {
        // Load user networks
        const { data: networks } = await supabase
          .from('user_networks')
          .select('*')
          .eq('user_id', user.id);
          
        if (networks) {
          // Make sure to properly map is_testnet to isTestnet
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
        
        // Load user contracts
        const { data: contracts } = await supabase
          .from('user_contracts')
          .select('*')
          .eq('user_id', user.id);
          
        if (contracts) {
          setUserContracts(contracts);
        }
      } catch (error) {
        console.error('Failed to load user data:', error);
      }
    };
    
    loadUserData();
  }, [user]);

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
            
            // Store last connected wallet info
            if (user) {
              await supabase
                .from('user_wallets')
                .upsert({
                  user_id: user.id,
                  address: accounts[0].toLowerCase(),
                  last_connected: new Date().toISOString(),
                }, {
                  onConflict: 'address',
                });
            }
          }
        } catch (error) {
          console.error('Error auto-connecting wallet:', error);
        }
      }
    };
    
    autoConnectWallet();
  }, [account, user]);

  // Add a separate effect to sync networks after wallet connection is established
  useEffect(() => {
    // Only run if we have an account but need to sync the network
    const syncNetworkWithWallet = async () => {
      if (window.ethereum && account) {
        try {
          // Get the current chainId from the wallet
          const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
          const currentChainId = parseInt(chainIdHex, 16);
          
          // Only sync if we don't already have a matching network selected
          if (!selectedNetwork || selectedNetwork.chainId !== currentChainId) {
            console.log('Syncing selected network with wallet network. Chain ID:', currentChainId);
            
            // Find the network that matches this chainId
            const matchingUserNetwork = userNetworks.find(n => n.chainId === currentChainId);
            
            // If a matching network is found in user networks, select it
            if (matchingUserNetwork && matchingUserNetwork.id) {
              console.log(`Auto-selecting network ${matchingUserNetwork.name} to match wallet's current network`);
              
              // Manually update network state instead of calling selectNetwork to avoid circular dependencies
              setNetworkType(matchingUserNetwork.isTestnet ? 'testnet' : 'mainnet');
              setSelectedNetwork(matchingUserNetwork);
            } else {
              // Check default networks
              let found = false;
              for (const type of ['mainnet', 'testnet'] as const) {
                for (const [key, network] of Object.entries(availableNetworks[type])) {
                  if (network.chainId === currentChainId) {
                    console.log(`Auto-selecting default network ${network.name} to match wallet's current network`);
                    setNetworkType(type);
                    setSelectedNetwork(network);
                    found = true;
                    break;
                  }
                }
                if (found) break;
              }
            }
          }
        } catch (error) {
          console.error('Error syncing network with wallet:', error);
        }
      }
    };
    
    syncNetworkWithWallet();
  }, [account, userNetworks, availableNetworks, selectedNetwork]);

  // Add a new user network
  const addNetwork = async (network: Omit<NetworkInfo, 'id'>) => {
    if (!user) throw new Error('User not authenticated');
    
    // Make sure the is_testnet flag is properly set
    const isTestnet = Boolean(network.isTestnet);
    console.log(`Adding network: ${network.name}, isTestnet: ${isTestnet}`);
    
    const { data, error } = await supabase
      .from('user_networks')
      .insert({
        user_id: user.id,
        name: network.name,
        chain_id: network.chainId,
        rpc_url: network.rpcUrl,
        currency_symbol: network.currencySymbol,
        explorer_url: network.explorerUrl,
        is_testnet: isTestnet,
      })
      .select()
      .single();
      
    if (error) throw error;
    
    // Manually map the returned data to ensure isTestnet is properly set
    const mappedNetwork = {
      ...data,
      id: data.id,
      name: data.name,
      chainId: data.chain_id,
      rpcUrl: data.rpc_url,
      currencySymbol: data.currency_symbol,
      explorerUrl: data.explorer_url,
      isTestnet: Boolean(data.is_testnet)
    };
    
    // Update local state
    setUserNetworks([...userNetworks, mappedNetwork]);
    
    return mappedNetwork;
  };
  
  // Edit a user network
  const editNetwork = async (id: string, network: Partial<NetworkInfo>) => {
    if (!user) throw new Error('User not authenticated');
    
    // Make sure the is_testnet flag is properly set if it's being updated
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
    
    const { data, error } = await supabase
      .from('user_networks')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
      
    if (error) throw error;
    
    // Manually map the returned data to ensure isTestnet is properly set
    const mappedNetwork = {
      ...data,
      id: data.id,
      name: data.name,
      chainId: data.chain_id,
      rpcUrl: data.rpc_url,
      currencySymbol: data.currency_symbol,
      explorerUrl: data.explorer_url,
      isTestnet: Boolean(data.is_testnet)
    };
    
    // Update local state
    setUserNetworks(userNetworks.map(n => n.id === id ? mappedNetwork : n));
    
    return mappedNetwork;
  };
  
  // Delete a user network
  const deleteNetwork = async (id: string) => {
    if (!user) throw new Error('User not authenticated');
    
    const { error } = await supabase
      .from('user_networks')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
      
    if (error) throw error;
    
    // Update local state
    setUserNetworks(userNetworks.filter(n => n.id !== id));
    
    // Also delete associated contracts
    setUserContracts(userContracts.filter(c => c.network_id !== id));
  };
  
  // Add a user contract
  const addContract = async (contract: Omit<UserContract, 'id'>) => {
    if (!user) throw new Error('User not authenticated');
    
    const { data, error } = await supabase
      .from('user_contracts')
      .insert({
        user_id: user.id,
        network_id: contract.network_id,
        name: contract.name,
        address: contract.address,
      })
      .select()
      .single();
      
    if (error) throw error;
    
    // Update local state
    setUserContracts([...userContracts, data]);
    
    return data;
  };
  
  // Edit a user contract
  const editContract = async (id: string, contract: Partial<UserContract>) => {
    if (!user) throw new Error('User not authenticated');
    
    const { data, error } = await supabase
      .from('user_contracts')
      .update({
        name: contract.name,
        address: contract.address,
        network_id: contract.network_id,
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
      
    if (error) throw error;
    
    // Update local state
    setUserContracts(userContracts.map(c => c.id === id ? data : c));
    
    return data;
  };
  
  // Delete a user contract
  const deleteContract = async (id: string) => {
    if (!user) throw new Error('User not authenticated');
    
    const { error } = await supabase
      .from('user_contracts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
      
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
        
        // Check and save wallet info to Supabase if user is logged in
        if (accounts[0] && user) {
          const { data } = await supabase
            .from('user_wallets')
            .upsert({
              user_id: user.id,
              address: accounts[0].toLowerCase(),
              last_connected: new Date().toISOString(),
            }, {
              onConflict: 'address',
            });
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
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setIsOwner(false);
    setIsWhitelisted(false);
  };

  // Improved switchNetwork function with retry mechanism and connection persistence
  const switchNetwork = async (chainId: number) => {
    if (!window.ethereum) {
      console.error('No Ethereum wallet detected');
      return;
    }

    // Maximum number of retries
    const maxRetries = 3;
    let retries = 0;
    let success = false;

    // Keep track of the original connection state
    const wasConnected = !!account;

    while (!success && retries < maxRetries) {
      try {
        // Try to switch to the network
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
        success = true;
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask
        if (switchError.code === 4902 && selectedNetwork) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: `0x${chainId.toString(16)}`,
                  chainName: selectedNetwork.name,
                  nativeCurrency: {
                    name: selectedNetwork.currencySymbol,
                    symbol: selectedNetwork.currencySymbol,
                    decimals: 18,
                  },
                  rpcUrls: [selectedNetwork.rpcUrl],
                  blockExplorerUrls: [selectedNetwork.explorerUrl.split('/tx')[0]],
                },
              ],
            });
            success = true;
          } catch (addError) {
            console.error(`Error adding Ethereum chain (attempt ${retries+1}/${maxRetries}):`, addError);
            retries++;
            
            // Small delay before retry
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } else if (switchError.code === 4001) {
          // User rejected the request
          console.error('User rejected the network switch request');
          throw switchError;
        } else {
          console.error(`Error switching Ethereum chain (attempt ${retries+1}/${maxRetries}):`, switchError);
          retries++;
          
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    // If we were connected before and the switch succeeded, ensure we're still connected
    if (wasConnected && success && !account) {
      try {
        // Reconnect wallet if it got disconnected during the network switch
        await connectWallet();
      } catch (error) {
        console.error('Failed to reconnect wallet after network switch:', error);
      }
    }

    return success;
  };

  // Select network
  const selectNetwork = (networkKey: string) => {
    // Check if this is a user-defined network first
    const userNetwork = userNetworks.find(n => n.id === networkKey);
    
    if (userNetwork) {
      // Set the network type based on the isTestnet flag of the selected network
      // Ensure isTestnet is treated as a boolean
      const isTestnetNetwork = Boolean(userNetwork.isTestnet);
      console.log(`Selecting user network: ${userNetwork.name}, isTestnet: ${isTestnetNetwork}`);
      setNetworkType(isTestnetNetwork ? 'testnet' : 'mainnet');
      setSelectedNetwork(userNetwork);
      
      // If wallet is connected, try to switch to this network
      if (provider && account) {
        switchNetwork(userNetwork.chainId).catch(console.error);
      }
      return;
    }
    
    // If not a user network, check available networks
    const network = availableNetworks[networkType][networkKey];
    if (network) {
      // Set the network type based on the isTestnet flag
      const isTestnetNetwork = Boolean(network.isTestnet);
      console.log(`Selecting default network: ${network.name}, isTestnet: ${isTestnetNetwork}`);
      setNetworkType(isTestnetNetwork ? 'testnet' : 'mainnet');
      setSelectedNetwork(network);
      
      // If wallet is connected, try to switch to this network
      if (provider && account) {
        switchNetwork(network.chainId).catch(console.error);
      }
    }
  };

  // Check contract permissions (owner, whitelist)
  const checkContractPermissions = async () => {
    if (!account || !provider || !selectedNetwork) {
      setIsOwner(false);
      setIsWhitelisted(false);
      return;
    }

    try {
      // Fetch contract address from Supabase
      const { data: contractData } = await supabase
        .from('contracts')
        .select('*')
        .eq('network_id', selectedNetwork.id)
        .single();

      if (!contractData?.address) {
        // Try the old chainId format as fallback
        const { data: fallbackContractData } = await supabase
          .from('contracts')
          .select('*')
          .eq('network_id', selectedNetwork.chainId.toString())
          .single();
          
        if (!fallbackContractData?.address) {
          setIsOwner(false);
          setIsWhitelisted(false);
          return;
        }
        
        // Use data from the fallback
        const contract = new ethers.Contract(
          fallbackContractData.address,
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
        
        return;
      }

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