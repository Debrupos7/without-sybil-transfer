"use client";

import React from 'react';
import { useWeb3 } from '@/context/Web3Context';
import { toast } from 'react-toastify';

const NetworkSelector = () => {
  const { 
    networkType, 
    setNetworkType, 
    selectedNetwork, 
    selectNetwork, 
    availableNetworks,
    userNetworks,
    switchNetwork
  } = useWeb3();

  // Handle network type change (mainnet/testnet)
  const handleNetworkTypeChange = (type: 'mainnet' | 'testnet') => {
    setNetworkType(type);
    
    // Filter user networks by type
    const filteredUserNetworks = userNetworks.filter(n => 
      (type === 'mainnet' && !n.isTestnet) || 
      (type === 'testnet' && n.isTestnet)
    );
    
    // Select first network of the new type
    if (filteredUserNetworks.length > 0 && filteredUserNetworks[0].id) {
      selectNetwork(filteredUserNetworks[0].id);
    } else {
      // If no user networks, check default networks
      const networks = availableNetworks[type];
      if (networks && Object.keys(networks).length > 0) {
        selectNetwork(Object.keys(networks)[0]);
      }
    }
  };

  // Handle network selection
  const handleNetworkSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const networkKey = e.target.value;
    
    // Find if this is a user network first
    const userNetwork = userNetworks.find(n => n.id === networkKey);
    
    // Update network type based on the selected network type (not the current filter)
    if (userNetwork) {
      // Ensure isTestnet is treated as a boolean
      const isTestnetNetwork = Boolean(userNetwork.isTestnet);
      console.log('Selected network isTestnet:', isTestnetNetwork);
      setNetworkType(isTestnetNetwork ? 'testnet' : 'mainnet');
    } else {
      // Check in default networks
      for (const [type, networks] of Object.entries(availableNetworks)) {
        if (networks[networkKey]) {
          setNetworkType(type as 'mainnet' | 'testnet');
          break;
        }
      }
    }
    
    // Finally select the network
    selectNetwork(networkKey);
    
    // Attempt to switch the connected wallet to this network
    try {
      // Find network in user networks or default networks
      const network = userNetwork || 
        availableNetworks.mainnet[networkKey] || 
        availableNetworks.testnet[networkKey];
      
      if (network) {
        await switchNetwork(network.chainId);
        toast.success(`Switched to ${network.name}`);
      }
    } catch (error: any) {
      toast.error(`Failed to switch network: ${error.message || 'Unknown error'}`);
      console.error(error);
    }
  };

  // Filter user networks based on current network type
  const filteredUserNetworks = userNetworks.filter(n => {
    // Make sure isTestnet is treated as a boolean
    const isTestnetNetwork = Boolean(n.isTestnet);
    return (networkType === 'mainnet' && !isTestnetNetwork) || 
           (networkType === 'testnet' && isTestnetNetwork);
  });
  
  // Debug output
  console.log('NetworkType:', networkType);
  console.log('User Networks:', userNetworks.map(n => ({ 
    id: n.id, 
    name: n.name, 
    isTestnet: n.isTestnet 
  })));
  console.log('Filtered Networks:', filteredUserNetworks.map(n => ({ 
    id: n.id, 
    name: n.name, 
    isTestnet: n.isTestnet 
  })));

  return (
    <div className="flex flex-col space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <h3 className="text-lg font-medium text-gray-900">Network Selection</h3>
      
      {/* Network Type Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => handleNetworkTypeChange('mainnet')}
          className={`py-2 px-4 font-medium ${
            networkType === 'mainnet'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Mainnet
        </button>
        <button
          onClick={() => handleNetworkTypeChange('testnet')}
          className={`py-2 px-4 font-medium ${
            networkType === 'testnet'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Testnet
        </button>
      </div>
      
      {/* Network Dropdown */}
      <div>
        <label htmlFor="network-select" className="block text-sm font-medium text-gray-700 mb-1">
          Select Network
        </label>
        <select
          id="network-select"
          value={selectedNetwork?.id || ''}
          onChange={handleNetworkSelect}
          className="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        >
          {/* User's custom networks */}
          {filteredUserNetworks.length > 0 && (
            <optgroup label="Your Networks">
              {filteredUserNetworks.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.name} ({network.currencySymbol})
                </option>
              ))}
            </optgroup>
          )}
          
          {/* Default networks */}
          {Object.keys(availableNetworks[networkType]).length > 0 && (
            <optgroup label="Default Networks">
              {Object.entries(availableNetworks[networkType]).map(([key, network]) => (
                <option key={key} value={key}>
                  {network.name} ({network.currencySymbol})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Currently Selected Network Info */}
      {selectedNetwork && (
        <div className="mt-2 bg-white p-3 rounded-md border border-gray-200">
          <p className="text-sm text-gray-600">
            <span className="font-medium">Selected:</span> {selectedNetwork.name}
          </p>
          <p className="text-sm text-gray-600">
            <span className="font-medium">Chain ID:</span> {selectedNetwork.chainId}
          </p>
          <p className="text-sm text-gray-600">
            <span className="font-medium">Currency:</span> {selectedNetwork.currencySymbol}
          </p>
        </div>
      )}
    </div>
  );
};

export default NetworkSelector; 