"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWeb3 } from '@/context/Web3Context';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { toast } from 'react-toastify';
import { NetworkInfo } from '@/types/NetworkTypes';
import TransferForm from '@/components/TransferForm';
import NetworkSelector from '@/components/NetworkSelector';
import Link from 'next/link';
import ChainlistSearch from '@/components/ChainlistSearch';

// Define UserContract type to match Web3Context
interface UserContract {
  id: string;
  user_id: string;
  network_id: string;
  name: string;
  address: string;
  created_at: string;
}

export default function Dashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const { 
    userNetworks, 
    userContracts, 
    addNetwork, 
    editNetwork, 
    deleteNetwork,
    addContract,
    editContract,
    deleteContract,
    connectWallet,
    account
  } = useWeb3();
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState('transfer');
  
  // Network form state
  const [networkForm, setNetworkForm] = useState<Omit<NetworkInfo, 'id'>>({
    name: '',
    chainId: 0,
    rpcUrl: '',
    currencySymbol: '',
    explorerUrl: '',
    isTestnet: false
  });
  
  // Contract form state
  const [contractForm, setContractForm] = useState<Omit<UserContract, 'id' | 'user_id' | 'created_at'>>({
    network_id: '',
    name: '',
    address: ''
  });
  
  const [isEditing, setIsEditing] = useState(false);
  const [currentItemId, setCurrentItemId] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'network' | 'contract'>('network');
  
  // State for Chainlist modal
  const [isChainlistModalOpen, setIsChainlistModalOpen] = useState(false);
  
  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/sign-in');
    }
  }, [user, authLoading, router]);
  
  // Handler for importing a network from Chainlist
  const handleChainlistNetworkSelect = (network: Omit<NetworkInfo, 'id'>) => {
    setNetworkForm(network);
    setIsChainlistModalOpen(false);
    setModalType('network');
    setIsEditing(false);
    setIsModalOpen(true);
  };
  
  // Handler for opening the Add/Edit modal
  const openModal = (type: 'network' | 'contract', action: 'add' | 'edit', itemId?: string) => {
    setModalType(type);
    setIsEditing(action === 'edit');
    
    if (action === 'edit' && itemId) {
      setCurrentItemId(itemId);
      
      // Populate form with existing data
      if (type === 'network') {
        const network = userNetworks.find(n => n.id === itemId);
        if (network) {
          setNetworkForm({
            name: network.name,
            chainId: network.chainId,
            rpcUrl: network.rpcUrl,
            currencySymbol: network.currencySymbol,
            explorerUrl: network.explorerUrl,
            isTestnet: network.isTestnet || false
          });
        }
      } else {
        const contract = userContracts.find(c => c.id === itemId);
        if (contract) {
          setContractForm({
            network_id: contract.network_id,
            name: contract.name,
            address: contract.address
          });
        }
      }
    } else {
      // Reset forms for add action
      if (type === 'network') {
        setNetworkForm({
          name: '',
          chainId: 0,
          rpcUrl: '',
          currencySymbol: '',
          explorerUrl: '',
          isTestnet: false
        });
      } else {
        setContractForm({
          network_id: userNetworks.length > 0 ? userNetworks[0].id || '' : '',
          name: '',
          address: ''
        });
      }
    }
    
    setIsModalOpen(true);
  };
  
  // Handler for network form submission
  const handleNetworkSubmit = async () => {
    try {
      // Validate form
      if (!networkForm.name || !networkForm.chainId || !networkForm.rpcUrl || 
          !networkForm.currencySymbol || !networkForm.explorerUrl) {
        toast.error('Please fill in all required fields');
        return;
      }
      
      if (isEditing) {
        await editNetwork(currentItemId, networkForm);
        toast.success('Network updated successfully');
      } else {
        await addNetwork(networkForm);
        toast.success('Network added successfully');
      }
      
      setIsModalOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save network');
    }
  };
  
  // Handler for contract form submission
  const handleContractSubmit = async () => {
    try {
      // Validate form
      if (!contractForm.network_id || !contractForm.name || !contractForm.address) {
        toast.error('Please fill in all required fields');
        return;
      }
      
      if (isEditing) {
        await editContract(currentItemId, contractForm);
        toast.success('Contract updated successfully');
      } else {
        await addContract(contractForm as any); // Type cast to any to avoid type errors
        toast.success('Contract added successfully');
      }
      
      setIsModalOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save contract');
    }
  };
  
  // Handler for deleting a network
  const handleDeleteNetwork = async (id: string) => {
    if (confirm('Are you sure you want to delete this network? This will also delete all associated contracts.')) {
      try {
        await deleteNetwork(id);
        toast.success('Network deleted successfully');
      } catch (error: any) {
        toast.error(error.message || 'Failed to delete network');
      }
    }
  };
  
  // Handler for deleting a contract
  const handleDeleteContract = async (id: string) => {
    if (confirm('Are you sure you want to delete this contract?')) {
      try {
        await deleteContract(id);
        toast.success('Contract deleted successfully');
      } catch (error: any) {
        toast.error(error.message || 'Failed to delete contract');
      }
    }
  };
  
  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex justify-center items-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  // Not authenticated
  if (!user) {
    return null; // useEffect will redirect
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {authLoading ? (
          <div className="flex justify-center my-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            {/* User welcome section */}
            <div className="bg-white p-6 rounded-lg shadow mb-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.email}</h1>
                  <p className="text-gray-600 mt-1">Manage your blockchain transfers and configurations</p>
                </div>
                <div className="flex space-x-3 mt-4 md:mt-0">
                  <Link 
                    href="/wallets"
                    className="px-4 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                  >
                    Manage Wallets
                  </Link>
                </div>
              </div>
            </div>
            
            <div className="bg-white shadow rounded-lg">
              {/* Tab navigation */}
              <div className="border-b border-gray-200">
                <nav className="flex -mb-px">
                  <button
                    onClick={() => setActiveTab('transfer')}
                    className={`px-6 py-3 border-b-2 font-medium text-sm ${
                      activeTab === 'transfer'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Make Transfer
                  </button>
                  <button
                    onClick={() => setActiveTab('networks')}
                    className={`px-6 py-3 border-b-2 font-medium text-sm ${
                      activeTab === 'networks'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    My Networks
                  </button>
                  <button
                    onClick={() => setActiveTab('contracts')}
                    className={`px-6 py-3 border-b-2 font-medium text-sm ${
                      activeTab === 'contracts'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    My Contracts
                  </button>
                </nav>
              </div>
              
              {/* Transfer Tab Content */}
              {activeTab === 'transfer' && (
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="md:col-span-1">
                      <NetworkSelector />
                    </div>
                    <div className="md:col-span-3">
                      <TransferForm />
                    </div>
                  </div>
                </div>
              )}
              
              {/* Networks Tab Content */}
              {activeTab === 'networks' && (
                <div className="p-4 md:p-6">
                  <div className="flex flex-col sm:flex-row justify-between mb-6 gap-4">
                    <h2 className="text-lg font-semibold text-gray-800">Your Networks</h2>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setIsChainlistModalOpen(true)}
                        className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                      >
                        Import from Chainlist
                      </button>
                      <button
                        onClick={() => openModal('network', 'add')}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        Add Network
                      </button>
                    </div>
                  </div>
                  
                  {userNetworks.length === 0 ? (
                    <div className="bg-gray-50 p-4 rounded-md text-center">
                      <p className="text-gray-600">You haven't added any networks yet. Start by adding your first network!</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-4 sm:-mx-0">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead>
                          <tr>
                            <th className="px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Chain ID</th>
                            <th className="px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Currency</th>
                            <th className="px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Type</th>
                            <th className="px-4 py-3 bg-gray-50 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {userNetworks.map((network) => (
                            <tr key={network.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 whitespace-nowrap text-sm">{network.name}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm">{network.chainId}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm hidden sm:table-cell">{network.currencySymbol}</td>
                              <td className="px-4 py-3 whitespace-nowrap hidden sm:table-cell">
                                <span className={`px-2 py-1 rounded-full text-xs ${network.isTestnet ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                  {network.isTestnet ? 'Testnet' : 'Mainnet'}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                                <button
                                  onClick={() => openModal('network', 'edit', network.id)}
                                  className="text-blue-600 hover:text-blue-800 mr-3"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteNetwork(network.id || '')}
                                  className="text-red-600 hover:text-red-800"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              
              {/* Contracts Tab Content */}
              {activeTab === 'contracts' && (
                <div className="p-4 md:p-6">
                  <div className="flex flex-col sm:flex-row justify-between mb-6 gap-4">
                    <h2 className="text-lg font-semibold text-gray-800">Your Contracts</h2>
                    <button
                      onClick={() => openModal('contract', 'add')}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm w-full sm:w-auto"
                      disabled={userNetworks.length === 0}
                    >
                      Add Contract
                    </button>
                  </div>
                  
                  {userNetworks.length === 0 ? (
                    <div className="bg-yellow-50 p-4 rounded-md text-center">
                      <p className="text-yellow-700">You need to add at least one network before adding contracts.</p>
                    </div>
                  ) : userContracts.length === 0 ? (
                    <div className="bg-gray-50 p-4 rounded-md text-center">
                      <p className="text-gray-600">You haven't added any contracts yet. Start by adding your first contract!</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-4 sm:-mx-0">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead>
                          <tr>
                            <th className="px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">Network</th>
                            <th className="px-4 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                            <th className="px-4 py-3 bg-gray-50 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {userContracts.map((contract) => {
                            const network = userNetworks.find(n => n.id === contract.network_id);
                            
                            return (
                              <tr key={contract.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 whitespace-nowrap text-sm">{contract.name}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm hidden sm:table-cell">{network?.name || 'Unknown'}</td>
                                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                                  {contract.address.substring(0, 6)}...{contract.address.substring(contract.address.length - 4)}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                                  <button
                                    onClick={() => openModal('contract', 'edit', contract.id)}
                                    className="text-blue-600 hover:text-blue-800 mr-3"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteContract(contract.id)}
                                    className="text-red-600 hover:text-red-800"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      
      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full">
            <div className="p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {isEditing 
                  ? `Edit ${modalType === 'network' ? 'Network' : 'Contract'}`
                  : `Add ${modalType === 'network' ? 'Network' : 'Contract'}`
                }
              </h3>
              
              {/* Network Form */}
              {modalType === 'network' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Network Name</label>
                    <input
                      type="text"
                      value={networkForm.name}
                      onChange={(e) => setNetworkForm({...networkForm, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ethereum Mainnet"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Chain ID</label>
                    <input
                      type="number"
                      value={networkForm.chainId}
                      onChange={(e) => setNetworkForm({...networkForm, chainId: parseInt(e.target.value) || 0})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">RPC URL</label>
                    <input
                      type="text"
                      value={networkForm.rpcUrl}
                      onChange={(e) => setNetworkForm({...networkForm, rpcUrl: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="https://mainnet.infura.io/v3/your-api-key"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Currency Symbol</label>
                    <input
                      type="text"
                      value={networkForm.currencySymbol}
                      onChange={(e) => setNetworkForm({...networkForm, currencySymbol: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="ETH"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Explorer URL</label>
                    <input
                      type="text"
                      value={networkForm.explorerUrl}
                      onChange={(e) => setNetworkForm({...networkForm, explorerUrl: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="https://etherscan.io"
                    />
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="isTestnet"
                      checked={networkForm.isTestnet}
                      onChange={(e) => setNetworkForm({...networkForm, isTestnet: e.target.checked})}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="isTestnet" className="ml-2 block text-sm text-gray-700">
                      This is a testnet
                    </label>
                  </div>
                </div>
              )}
              
              {/* Contract Form */}
              {modalType === 'contract' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Network</label>
                    <select
                      value={contractForm.network_id}
                      onChange={(e) => setContractForm({...contractForm, network_id: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Select a network</option>
                      {userNetworks.map((network) => (
                        <option key={network.id} value={network.id}>
                          {network.name} ({network.isTestnet ? 'Testnet' : 'Mainnet'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contract Name</label>
                    <input
                      type="text"
                      value={contractForm.name}
                      onChange={(e) => setContractForm({...contractForm, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="My Multi-Transfer Contract"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contract Address</label>
                    <input
                      type="text"
                      value={contractForm.address}
                      onChange={(e) => setContractForm({...contractForm, address: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="0x..."
                    />
                  </div>
                </div>
              )}
              
              <div className="mt-6 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  onClick={modalType === 'network' ? handleNetworkSubmit : handleContractSubmit}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {isEditing ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chainlist Search modal */}
      <ChainlistSearch 
        isOpen={isChainlistModalOpen}
        onClose={() => setIsChainlistModalOpen(false)}
        onSelect={handleChainlistNetworkSelect}
      />

      {/* Simple footer with copyright */}
      <footer className="bg-gray-800 text-white py-6 px-6 mt-12">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-gray-400">© {new Date().getFullYear()} Sybil Transfer. All rights reserved.</p>
          <p className="text-gray-500 text-sm mt-2">Created by Satwik Samanta</p>
        </div>
      </footer>
    </div>
  );
} 