'use client';

import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import { useWeb3 } from '@/context/Web3Context';
import { useAuth } from '@/context/AuthContext';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import Link from 'next/link';
import MainContractABI from '@/utils/MainContractABI.json';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { account, signer, selectedNetwork, userNetworks, userContracts, getContractInstance, setSelectedNetwork } = useWeb3();
  const [contractAddress, setContractAddress] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isContractOwner, setIsContractOwner] = useState(false);
  const [whitelistedAddresses, setWhitelistedAddresses] = useState<string[]>([]);
  const [newOwnerAddress, setNewOwnerAddress] = useState('');
  const [newWhitelistAddress, setNewWhitelistAddress] = useState('');
  const [batchWhitelistAddresses, setBatchWhitelistAddresses] = useState('');
  const [isWhitelisting, setIsWhitelisting] = useState(false);
  const [isBatchWhitelisting, setIsBatchWhitelisting] = useState(false);
  const [isTransferringOwnership, setIsTransferringOwnership] = useState(false);
  const [activeTab, setActiveTab] = useState('whitelist');
  const [selectedContract, setSelectedContract] = useState<string>('');

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/sign-in');
    }
  }, [user, authLoading, router]);

  // Load available contracts when network changes
  useEffect(() => {
    if (selectedNetwork && selectedContract) {
      fetchContractData(selectedContract);
    } else {
      setIsLoading(false);
    }
  }, [selectedNetwork, selectedContract]);

  // Handle contract selection
  const handleContractChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedContract(e.target.value);
    if (e.target.value) {
      checkContractOwnership(e.target.value);
    }
  };

  // Check if the connected wallet is the owner of the selected contract
  const checkContractOwnership = async (contractAddress: string) => {
    if (!signer || !contractAddress) {
      setIsLoading(false);
      setIsContractOwner(false);
      return;
    }

    setIsLoading(true);
    
    try {
      const contract = getContractInstance(contractAddress);
      if (!contract) {
        throw new Error('Failed to initialize contract');
      }

      // Check if current account is owner
      const ownerAddress = await contract.owner();
      const isOwner = account && ownerAddress.toLowerCase() === account.toLowerCase();
      
      if (!isOwner) {
        console.log('Not the owner. Contract owner:', ownerAddress, 'Current account:', account);
      } else {
        console.log('Wallet is the owner of this contract');
      }
      
      // Set the contract address for other operations
      setContractAddress(contractAddress);
      
      // If wallet is the owner, fetch whitelisted addresses
      if (isOwner) {
        await fetchWhitelistedAddresses(contractAddress);
      }
      
      setIsContractOwner(Boolean(isOwner));
      
      return isOwner;
    } catch (error) {
      console.error('Error checking contract ownership:', error);
      setIsContractOwner(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch contract data - modified to use our ownership check
  const fetchContractData = async (contractAddress: string) => {
    if (!selectedNetwork || !contractAddress) {
      setWhitelistedAddresses([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      // Directly check ownership and fetch whitelisted addresses
      await checkContractOwnership(contractAddress);
    } catch (error) {
      console.error('Error fetching contract data:', error);
      setWhitelistedAddresses([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch whitelisted addresses from contract events
  const fetchWhitelistedAddresses = async (address: string) => {
    if (!signer || !selectedNetwork) return;

    try {
      const contract = getContractInstance(address);
      if (!contract) return;

      // Get whitelisted addresses from events
      const filter = contract.filters.WhitelistStatusChanged();
      const events = await contract.queryFilter(filter);
      
      // Process events to get current whitelist status
      const addressStatuses: Record<string, boolean> = {};
      
      for (const event of events) {
        if (event.args && event.args.user && event.args.status !== undefined) {
          addressStatuses[event.args.user.toLowerCase()] = event.args.status;
        }
      }
      
      // Filter only addresses that are currently whitelisted
      const whitelisted = Object.entries(addressStatuses)
        .filter(([_, status]) => status)
        .map(([address]) => address);
      
      setWhitelistedAddresses(whitelisted);
    } catch (error) {
      console.error('Error fetching whitelisted addresses:', error);
    }
  };

  // Add a new address to the whitelist
  const addToWhitelist = async () => {
    if (!signer || !contractAddress || !newWhitelistAddress) {
      toast.error('Please fill all required fields');
      return;
    }

    // Validate Ethereum address
    try {
      ethers.utils.getAddress(newWhitelistAddress);
    } catch (error) {
      toast.error('Invalid Ethereum address');
      return;
    }

    setIsWhitelisting(true);

    try {
      const contract = getContractInstance(contractAddress);
      if (!contract) {
        throw new Error('Failed to initialize contract');
      }

      const tx = await contract.setWhitelistStatus(newWhitelistAddress, true);
      toast.info(`Transaction submitted: ${tx.hash}`);
      
      // Wait for transaction to be mined
      await tx.wait();
      
      // Update the whitelist
      setWhitelistedAddresses([...whitelistedAddresses, newWhitelistAddress.toLowerCase()]);
      setNewWhitelistAddress('');
      
      toast.success('Address added to whitelist');
    } catch (error: any) {
      console.error('Error adding to whitelist:', error);
      toast.error(`Failed to add to whitelist: ${error.message || 'Unknown error'}`);
    } finally {
      setIsWhitelisting(false);
    }
  };

  // Batch whitelist addresses
  const batchWhitelist = async () => {
    if (!signer || !contractAddress || !batchWhitelistAddresses) {
      toast.error('Please enter addresses to whitelist');
      return;
    }

    setIsBatchWhitelisting(true);

    try {
      // Parse addresses from separate lines
      const addressLines = batchWhitelistAddresses.trim().split(/\n+/).map(a => a.trim()).filter(a => a);
      const validAddresses = [];
      const invalidAddresses = [];
      
      for (const addr of addressLines) {
        try {
          validAddresses.push(ethers.utils.getAddress(addr));
        } catch (error) {
          invalidAddresses.push(addr);
          toast.warning(`Invalid address format: ${addr}`);
        }
      }
      
      if (validAddresses.length === 0) {
        toast.error('No valid addresses provided');
        return;
      }
      
      if (invalidAddresses.length > 0) {
        const confirmContinue = window.confirm(`${invalidAddresses.length} invalid addresses were found. Do you want to continue with the ${validAddresses.length} valid addresses?`);
        if (!confirmContinue) {
          setIsBatchWhitelisting(false);
          return;
        }
      }
      
      const contract = getContractInstance(contractAddress);
      if (!contract) {
        throw new Error('Failed to initialize contract');
      }
      
      // Show progress information
      toast.info(`Whitelisting ${validAddresses.length} addresses...`);
      
      // Whitelist each address
      let successCount = 0;
      for (const addr of validAddresses) {
        try {
          const tx = await contract.setWhitelistStatus(addr, true);
          await tx.wait();
          successCount++;
          // Only show toast for every 5th address to avoid too many notifications
          if (successCount % 5 === 0 || successCount === validAddresses.length) {
            toast.info(`Progress: ${successCount}/${validAddresses.length} addresses processed`);
          }
        } catch (error) {
          console.error(`Failed to whitelist ${addr}:`, error);
          // Continue with other addresses
        }
      }
      
      // Update the whitelist
      const lowerAddresses = validAddresses.map(a => a.toLowerCase());
      setWhitelistedAddresses([...whitelistedAddresses, ...lowerAddresses]);
      setBatchWhitelistAddresses('');
      
      toast.success(`Batch whitelist complete: ${successCount}/${validAddresses.length} addresses processed successfully`);
    } catch (error: any) {
      console.error('Error in batch whitelist:', error);
      toast.error(`Batch whitelist failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsBatchWhitelisting(false);
    }
  };

  // Remove address from whitelist
  const removeFromWhitelist = async (address: string) => {
    if (!signer || !contractAddress) {
      toast.error('Wallet not connected or contract not selected');
      return;
    }

    try {
      const contract = getContractInstance(contractAddress);
      if (!contract) {
        throw new Error('Failed to initialize contract');
      }

      const tx = await contract.setWhitelistStatus(address, false);
      toast.info(`Transaction submitted: ${tx.hash}`);
      
      // Wait for transaction to be mined
      await tx.wait();
      
      // Update the whitelist
      setWhitelistedAddresses(whitelistedAddresses.filter(a => a !== address.toLowerCase()));
      
      toast.success('Address removed from whitelist');
    } catch (error: any) {
      console.error('Error removing from whitelist:', error);
      toast.error(`Failed to remove from whitelist: ${error.message || 'Unknown error'}`);
    }
  };

  // Transfer ownership of the contract
  const transferOwnership = async () => {
    if (!signer || !contractAddress || !newOwnerAddress) {
      toast.error('Please fill all required fields');
      return;
    }

    // Validate Ethereum address
    try {
      ethers.utils.getAddress(newOwnerAddress);
    } catch (error) {
      toast.error('Invalid Ethereum address');
      return;
    }

    setIsTransferringOwnership(true);

    try {
      const contract = getContractInstance(contractAddress);
      if (!contract) {
        throw new Error('Failed to initialize contract');
      }

      // Call transferOwnership function
      const tx = await contract.transferOwnership(newOwnerAddress);
      toast.info(`Transaction submitted: ${tx.hash}`);
      
      // Wait for transaction to be mined
      await tx.wait();
        
      setNewOwnerAddress('');
      
      toast.success('Ownership transferred successfully');
    } catch (error: any) {
      console.error('Error transferring ownership:', error);
      toast.error(`Failed to transfer ownership: ${error.message || 'Unknown error'}`);
    } finally {
      setIsTransferringOwnership(false);
    }
  };

  // Format address for display
  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Filter contracts for the selected network
  const filteredContracts = userContracts.filter(
    contract => contract.network_id === selectedNetwork?.id
  );

  // Handle network selection
  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const networkId = e.target.value;
    const network = userNetworks.find(n => n.id === networkId);
    if (network) {
      console.log(`Admin page: selecting network ${network.name}, isTestnet: ${Boolean(network.isTestnet)}`);
      setSelectedNetwork(network);
      setSelectedContract(''); // Reset contract selection when network changes
      setContractAddress('');
      setWhitelistedAddresses([]);
    }
  };

  // Debug output for networks
  console.log('Admin page - available networks:', userNetworks.map(n => ({
    id: n.id,
    name: n.name,
    chainId: n.chainId,
    isTestnet: n.isTestnet
  })));

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <Header />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-8 border-b border-gray-200 pb-4">Admin Panel</h1>
        
        {!account ? (
          <div className="bg-white shadow-lg rounded-lg p-8 text-center border border-gray-100">
            <h2 className="text-2xl font-semibold mb-6 text-indigo-700">Admin Dashboard</h2>
            <div className="bg-blue-50 p-5 rounded-lg mb-6">
              <p className="text-blue-700 mb-3 font-medium">Connect your wallet to access admin features</p>
              <p className="text-sm text-blue-600">You need to be the contract owner to make changes</p>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white shadow-lg rounded-lg overflow-hidden mb-8 border border-gray-100">
              <div className="px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-blue-50">
                <h2 className="text-2xl font-semibold text-indigo-800">Admin Dashboard</h2>
              </div>
              
              <div className="p-6">
                <div className="mb-8">
                  <h3 className="text-xl font-medium mb-4 text-indigo-700 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M5.555 17.776l8-16 .894.448-8 16-.894-.448z" />
                    </svg>
                    Network Selection
                  </h3>
                  
                  <div className="bg-gray-50 p-5 rounded-lg mb-4 border border-gray-200 shadow-sm">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select a network
                    </label>
                    
                    <select
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm transition-colors"
                      value={selectedNetwork?.id || ''}
                      onChange={handleNetworkChange}
                    >
                      <option value="">-- Select Network --</option>
                      {userNetworks.map((network) => (
                        <option key={network.id} value={network.id}>
                          {network.name}
                        </option>
                      ))}
                    </select>
                    
                    {userNetworks.length === 0 && (
                      <p className="mt-3 text-sm text-gray-600 bg-yellow-50 p-3 rounded-md border border-yellow-200">
                        No networks found. Please add a network in the Dashboard.
                      </p>
                    )}
                  </div>
                </div>
                
                {selectedNetwork && (
                  <div className="mb-8">
                    <h3 className="text-xl font-medium mb-4 text-indigo-700 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 1h6v4H7V5zm8 8v-2h-2v2h2zm-3 0v-2h-2v2h2zm-3 0v-2H7v2h2zm7-5H5v6h12v-6z" clipRule="evenodd" />
                      </svg>
                      Contract Selection
                    </h3>
                    
                    <div className="bg-gray-50 p-5 rounded-lg mb-4 border border-gray-200 shadow-sm">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select a contract for <span className="font-semibold text-indigo-600">{selectedNetwork.name}</span>
                      </label>
                      
                      <select
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm transition-colors"
                        value={selectedContract}
                        onChange={handleContractChange}
                      >
                        <option value="">-- Select Contract --</option>
                        {filteredContracts.map((contract) => (
                          <option key={contract.id} value={contract.address}>
                            {contract.name} ({formatAddress(contract.address)})
                          </option>
                        ))}
                      </select>
                      
                      {filteredContracts.length === 0 && (
                        <p className="mt-3 text-sm text-gray-600 bg-yellow-50 p-3 rounded-md border border-yellow-200">
                          No contracts found for {selectedNetwork.name}. Please add a contract first.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                
                {selectedContract && (
                  <>
                    {isLoading ? (
                      <div className="flex justify-center p-10">
                        <div className="flex flex-col items-center">
                          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500 mb-3"></div>
                          <p className="text-gray-600">Loading contract information...</p>
                        </div>
                      </div>
                    ) : !isContractOwner ? (
                      <div className="bg-yellow-50 p-5 rounded-lg mb-6 border border-yellow-200">
                        <h3 className="text-lg font-medium text-yellow-800 mb-2 flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          Access Restricted
                        </h3>
                        <p className="text-yellow-700 mb-2">
                          You are not the owner of this contract. Admin actions are restricted.
                        </p>
                        <p className="text-sm text-yellow-600">
                          Only the contract owner can perform administrative actions like managing the whitelist and transferring ownership.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <div className="bg-white p-6 rounded-lg shadow-md mb-8 border border-gray-200">
                          <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
                              <path d="M3 8a2 2 0 012-2h2.5a1 1 0 010 2H5v10a1 1 0 01-1 1H3a1 1 0 01-1-1V8z" />
                            </svg>
                            Contract Information
                          </h2>
                          <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100 mb-3">
                            <p className="text-gray-700 mb-2">
                              <span className="font-medium text-indigo-700">Address:</span>{' '}
                              <a
                                href={`${selectedNetwork?.explorerUrl}/address/${contractAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-600 hover:underline font-mono bg-white px-2 py-1 rounded border border-indigo-100"
                              >
                                {contractAddress}
                              </a>
                            </p>
                            <p className="text-gray-700">
                              <span className="font-medium text-indigo-700">Network:</span>{' '}
                              <span className="bg-white px-2 py-1 rounded border border-indigo-100">
                                {selectedNetwork?.name}
                              </span>
                            </p>
                          </div>
                          <p className="text-sm text-gray-600">
                            You have full administrative access to this contract.
                          </p>
                        </div>
                        
                        <div className="mb-8">
                          <div className="flex border-b border-gray-200 mb-6">
                            <button
                              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'ownership' ? 'text-indigo-600 border-indigo-500 bg-indigo-50' : 'text-gray-500 hover:text-gray-700 border-transparent'}`}
                              onClick={() => setActiveTab('ownership')}
                            >
                              <div className="flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v-1l1-1 1-1-.257-.257A6 6 0 1118 8zm-6-4a1 1 0 100 2h2a1 1 0 100-2h-2z" clipRule="evenodd" />
                                </svg>
                                Ownership Transfer
                              </div>
                            </button>
                            <button
                              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'whitelist' ? 'text-indigo-600 border-indigo-500 bg-indigo-50' : 'text-gray-500 hover:text-gray-700 border-transparent'}`}
                              onClick={() => setActiveTab('whitelist')}
                            >
                              <div className="flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                                </svg>
                                Whitelist Management
                              </div>
                            </button>
                          </div>
                          
                          {activeTab === 'ownership' && (
                            <div className="mt-4 bg-white p-6 rounded-lg shadow-md border border-gray-200">
                              <h3 className="text-xl font-medium mb-4 text-indigo-700 flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
                                </svg>
                                Transfer Ownership
                              </h3>
                              <div className="bg-indigo-50 p-5 rounded-lg border border-indigo-100">
                                <div className="grid grid-cols-1 gap-4">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      New Owner Address
                                    </label>
                                    <input
                                      type="text"
                                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                      placeholder="0x..."
                                      value={newOwnerAddress}
                                      onChange={(e) => setNewOwnerAddress(e.target.value)}
                                    />
                                  </div>
                                  <button
                                    onClick={transferOwnership}
                                    disabled={isTransferringOwnership || !newOwnerAddress}
                                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                                  >
                                    {isTransferringOwnership ? (
                                      <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing...
                                      </>
                                    ) : (
                                      <>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                          <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8z" />
                                          <path d="M12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" />
                                        </svg>
                                        Transfer Ownership
                                      </>
                                    )}
                                  </button>
                                </div>
                                <div className="mt-4 bg-yellow-50 p-3 rounded-md border border-yellow-200">
                                  <p className="text-sm text-yellow-700 flex items-start">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 flex-shrink-0 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    <span>Warning: After transferring ownership, you will no longer have admin privileges for this contract.</span>
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {activeTab === 'whitelist' && (
                            <div className="mt-4 space-y-6">
                              <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                                <h3 className="text-xl font-medium mb-4 text-indigo-700 flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
                                  </svg>
                                  Add Address to Whitelist
                                </h3>
                                <div className="bg-indigo-50 p-5 rounded-lg border border-indigo-100">
                                  <div className="grid grid-cols-1 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Ethereum Address
                                      </label>
                                      <input
                                        type="text"
                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                        placeholder="0x..."
                                        value={newWhitelistAddress}
                                        onChange={(e) => setNewWhitelistAddress(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      onClick={addToWhitelist}
                                      disabled={isWhitelisting || !newWhitelistAddress}
                                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                                    >
                                      {isWhitelisting ? (
                                        <>
                                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                          </svg>
                                          Processing...
                                        </>
                                      ) : (
                                        <>
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                                          </svg>
                                          Add to Whitelist
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                                <h3 className="text-xl font-medium mb-4 text-indigo-700 flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                                  </svg>
                                  Batch Whitelist
                                </h3>
                                <div className="bg-indigo-50 p-5 rounded-lg border border-indigo-100">
                                  <div className="grid grid-cols-1 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Multiple Addresses (one per line)
                                      </label>
                                      <textarea
                                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                        rows={5}
                                        placeholder="0x1234...\n0x5678...\n0xabcd..."
                                        value={batchWhitelistAddresses}
                                        onChange={(e) => setBatchWhitelistAddresses(e.target.value)}
                                      />
                                      <p className="mt-2 text-xs text-gray-500">
                                        For better results, add each address on a new line. This makes it easier to process and track valid addresses.
                                      </p>
                                    </div>
                                    <button
                                      onClick={batchWhitelist}
                                      disabled={isBatchWhitelisting || !batchWhitelistAddresses}
                                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                                    >
                                      {isBatchWhitelisting ? (
                                        <>
                                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                          </svg>
                                          Processing Batch...
                                        </>
                                      ) : (
                                        <>
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                          </svg>
                                          Process Batch Whitelist
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                                <h3 className="text-xl font-medium mb-4 text-indigo-700 flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                                  </svg>
                                  Whitelisted Addresses
                                </h3>
                                <div className="bg-indigo-50 p-5 rounded-lg border border-indigo-100">
                                  {whitelistedAddresses.length === 0 ? (
                                    <div className="text-center py-6">
                                      <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                      </svg>
                                      <p className="mt-2 text-gray-600">No addresses whitelisted yet</p>
                                      <p className="text-sm text-gray-500 mt-1">Use the forms above to add addresses to the whitelist</p>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="mb-2 flex justify-between items-center">
                                        <h4 className="font-medium text-gray-700">Total: {whitelistedAddresses.length} addresses</h4>
                                        <span className="text-xs text-gray-500">Click on an address to view on explorer</span>
                                      </div>
                                      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                        <ul className="divide-y divide-gray-200">
                                          {whitelistedAddresses.map((address) => (
                                            <li key={address} className="p-3 flex justify-between items-center hover:bg-gray-50">
                                              <a 
                                                href={`${selectedNetwork?.explorerUrl}/address/${address}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm font-mono text-indigo-600 hover:underline flex-1 truncate"
                                              >
                                                {address}
                                              </a>
                                              <button
                                                onClick={() => removeFromWhitelist(address)}
                                                className="ml-2 text-sm text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-3 py-1 rounded-md transition-colors flex items-center"
                                              >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                </svg>
                                                Remove
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
} 