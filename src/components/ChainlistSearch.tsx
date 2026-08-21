"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import { 
  ChainlistNetwork,
  fetchChainlistNetworks,
  searchNetworks,
  getBestRpcUrl,
  getExplorerUrl,
  isTestnet
} from '@/utils/chainlistService';
import { NetworkInfo } from '@/types/NetworkTypes';

interface ChainlistSearchProps {
  onSelect: (networkInfo: Omit<NetworkInfo, 'id'>) => void;
  onClose: () => void;
  isOpen: boolean;
}

export default function ChainlistSearch({ onSelect, onClose, isOpen }: ChainlistSearchProps) {
  const [networks, setNetworks] = useState<ChainlistNetwork[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load networks when component mounts
  useEffect(() => {
    if (isOpen && networks.length === 0) {
      loadNetworks();
    }
  }, [isOpen, networks.length]);

  // Fetch networks from Chainlist
  const loadNetworks = async () => {
    try {
      setIsLoading(true);
      const chainlistNetworks = await fetchChainlistNetworks();
      setNetworks(chainlistNetworks);
    } catch (error: any) {
      console.error('Error fetching chainlist networks:', error);
      toast.error('Failed to load networks from Chainlist');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter networks based on search query
  const filteredNetworks = useMemo(() => {
    return searchNetworks(networks, searchQuery);
  }, [networks, searchQuery]);

  // Handle network selection
  const handleSelectNetwork = (network: ChainlistNetwork) => {
    const networkInfo: Omit<NetworkInfo, 'id'> = {
      name: network.name,
      chainId: network.chainId,
      rpcUrl: getBestRpcUrl(network),
      currencySymbol: network.nativeCurrency?.symbol || '',
      explorerUrl: getExplorerUrl(network),
      isTestnet: isTestnet(network)
    };
    
    onSelect(networkInfo);
    toast.info('Network imported from Chainlist. You can still modify details before saving.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">
              Import Network from Chainlist
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="mt-4">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search networks by name, chain, or ID..."
                className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
            </div>
          ) : networks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                Loading networks from Chainlist...
              </p>
            </div>
          ) : filteredNetworks.length === 0 && searchQuery ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                No networks found matching "{searchQuery}"
              </p>
            </div>
          ) : filteredNetworks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                Start typing to search for networks
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredNetworks.map((network, index) => (
                <div 
                  key={`${network.chainId}-${index}`}
                  className="border border-gray-200 rounded-md p-4 hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleSelectNetwork(network)}
                >
                  <div className="flex justify-between">
                    <h4 className="font-medium text-gray-900">{network.name}</h4>
                    <span className="text-sm font-mono text-gray-500">Chain ID: {network.chainId}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {network.chain || 'Unknown Chain'}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      {network.nativeCurrency?.symbol || 'Unknown Token'}
                    </span>
                    {network.name.toLowerCase().includes('testnet') && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Testnet
                      </span>
                    )}
                  </div>
                  {network.rpc && network.rpc.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-500 truncate">
                        RPC: {typeof network.rpc[0] === 'object' ? network.rpc[0].url : network.rpc[0]}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="p-4 border-t">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 