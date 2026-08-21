"use client";

import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import { useWeb3 } from '@/context/Web3Context';
import { supabase } from '@/utils/supabaseClient';
import { Transaction } from '@/utils/supabaseClient';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { ethers } from 'ethers';

type EnhancedTransaction = Transaction & {
  networkName?: string;
  contractName?: string;
  currencySymbol?: string;
  totalTransfer?: string;
};

export default function TransactionsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { account, selectedNetwork, userNetworks, userContracts, getProvider } = useWeb3();
  const [transactions, setTransactions] = useState<EnhancedTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/sign-in');
    }
  }, [user, authLoading, router]);

  // Check transaction status on blockchain and update database if confirmed
  const checkTransactionStatus = async (tx: EnhancedTransaction) => {
    if (!tx.tx_hash || tx.status !== 'pending') return false;
    
    try {
      // Find the network for this transaction
      const network = userNetworks.find(n => n.id === tx.network_id);
      if (!network) return false;
      
      // Get provider for the network
      const provider = getProvider(network.rpcUrl);
      if (!provider) return false;
      
      console.log(`Checking on-chain status for tx: ${tx.tx_hash}`);
      
      // Get transaction receipt
      const receipt = await provider.getTransactionReceipt(tx.tx_hash);
      
      // If receipt exists and has at least 1 confirmation, update the status
      if (receipt && receipt.confirmations > 0) {
        console.log(`Transaction ${tx.tx_hash} is confirmed on-chain`);
        
        // Extract child contract addresses if available
        const childContracts: string[] = [];
        if (receipt.logs) {
          receipt.logs.forEach((log: ethers.providers.Log) => {
            if (log.address && log.address !== userContracts.find(c => c.id === tx.contract_id)?.address) {
              if (!childContracts.includes(log.address)) {
                childContracts.push(log.address);
              }
            }
          });
        }
        
        // Update the transaction in the database
        const { error } = await supabase
          .from('transactions')
          .update({
            status: receipt.status === 1 ? 'success' : 'failed',
            child_contracts: childContracts.length > 0 ? JSON.stringify(childContracts) : null,
            error: receipt.status === 1 ? null : 'Transaction reverted on-chain'
          })
          .eq('id', tx.id);
          
        if (error) {
          console.error('Error updating transaction:', error);
          return false;
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error checking transaction ${tx.tx_hash}:`, error);
      return false;
    }
  };

  // Poll for pending transaction updates
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    const checkPendingTransactions = async () => {
      if (!user || !account) return;
      
      // Check if we have any pending transactions
      const pendingTx = transactions.filter(tx => tx.status === 'pending');
      
      if (pendingTx.length > 0) {
        console.log(`Checking status of ${pendingTx.length} pending transactions`);
        
        let updated = false;
        
        // Check each pending transaction
        for (const tx of pendingTx) {
          if (await checkTransactionStatus(tx)) {
            updated = true;
          }
        }
        
        // If any transaction was updated, refresh the list
        if (updated) {
          setRefreshKey(prev => prev + 1);
        }
      }
    };

    // Start polling every 30 seconds if we're logged in and have an account
    if (user && account) {
      checkPendingTransactions(); // Check immediately on mount
      intervalId = setInterval(checkPendingTransactions, 30000);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [user, account, transactions, userNetworks, userContracts]);

  // Fetch transactions on account or network change or refresh
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!account || !user) {
        setTransactions([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        // Create base query - always fetch all transactions for the user
        let query = supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('timestamp', { ascending: false });

        // Only filter by network if one is specifically selected
        if (selectedNetwork) {
          query = query.eq('network_id', selectedNetwork.id);
        }

        const { data, error } = await query;

        if (error) {
          console.error('Error fetching transactions:', error);
          toast.error('Failed to load transaction history');
          setIsLoading(false);
          return;
        }

        // Log for debugging
        console.log(`Fetched ${data?.length || 0} transactions for user ${user.id}`);
        
        if (data && data.length > 0) {
          console.log('First transaction sample:', data[0]);
        }

        // Process JSONB data from database
        const processedData = (data || []).map(tx => {
          // Parse recipients if it's a JSON string
          let recipients = tx.recipients;
          if (typeof recipients === 'string') {
            try {
              recipients = JSON.parse(recipients);
            } catch (e) {
              recipients = [];
            }
          }
          
          // Parse child_contracts if it's a JSON string
          let childContracts = tx.child_contracts;
          if (typeof childContracts === 'string') {
            try {
              childContracts = JSON.parse(childContracts);
            } catch (e) {
              childContracts = [];
            }
          }
          
          return {
            ...tx,
            recipients,
            child_contracts: childContracts
          };
        });

        // Enhance transactions with network and contract information
        const enhancedTransactions = processedData.map(tx => {
          // Find network info
          const network = userNetworks.find(n => n.id === tx.network_id);
          
          // Find contract info
          const contract = userContracts.find(c => c.id === tx.contract_id);
          
          return {
            ...tx,
            networkName: network?.name,
            currencySymbol: network?.currencySymbol,
            contractName: contract?.name,
          };
        });

        setTransactions(enhancedTransactions);
      } catch (error) {
        console.error('Failed to fetch transactions:', error);
        toast.error('Error loading transaction history');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    };

    fetchTransactions();
  }, [account, selectedNetwork, user, userNetworks, userContracts, refreshKey]);

  // Manually check and refresh transaction statuses
  const refreshTransactions = async () => {
    setIsRefreshing(true);
    
    // Find pending transactions
    const pendingTx = transactions.filter(tx => tx.status === 'pending');
    
    if (pendingTx.length > 0) {
      let updated = false;
      
      // Show toast that we're checking transactions
      toast.info(`Checking ${pendingTx.length} pending transaction(s)...`);
      
      // Check each pending transaction
      for (const tx of pendingTx) {
        if (await checkTransactionStatus(tx)) {
          updated = true;
        }
      }
      
      // If transactions were updated, show a success message
      if (updated) {
        toast.success('Transaction status(es) updated!');
      } else {
        toast.info('No changes to transaction statuses.');
      }
    }
    
    // Always refresh the transaction list
    setRefreshKey(prev => prev + 1);
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Format transaction hash for display
  const formatTxHash = (hash: string) => {
    if (!hash) return 'N/A';
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  };

  // Format address for display
  const formatAddress = (address: string) => {
    if (!address) return 'N/A';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Get explorer URL for a transaction
  const getExplorerUrl = (tx: EnhancedTransaction): string => {
    if (!tx.tx_hash) return '#';
    
    const network = userNetworks.find(n => n.id === tx.network_id);
    if (!network) return '#';
    
    // Safely check if explorer URL exists and add a trailing slash if needed
    const explorerUrl = network.explorerUrl || '';
    if (!explorerUrl) return '#';
    
    const baseUrl = explorerUrl.endsWith('/') ? explorerUrl : `${explorerUrl}/`;
    return `${baseUrl}tx/${tx.tx_hash}`;
  };

  // Get explorer URL for an address
  const getAddressExplorerUrl = (address: string, networkId: string) => {
    if (!address) return '#';
    
    const network = userNetworks.find(n => n.id === networkId);
    if (!network) return '#';
    
    // Safely check if explorer URL exists and add a trailing slash if needed
    const explorerUrl = network.explorerUrl || '';
    if (!explorerUrl) return '#';
    
    const baseUrl = explorerUrl.endsWith('/') ? explorerUrl : `${explorerUrl}/`;
    return `${baseUrl}address/${address}`;
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-600 bg-green-50';
      case 'pending':
        return 'text-yellow-600 bg-yellow-50';
      case 'failed':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  // Toggle transaction details
  const toggleTxDetails = (txId: string) => {
    setExpandedTx(expandedTx === txId ? null : txId);
  };

  // Compute total transfer amount (amount + gas cost)
  const calculateTotalAmount = (tx: EnhancedTransaction): string => {
    if (!tx.amount) return '0';
    
    const amount = parseFloat(tx.amount) || 0;
    const gasCost = tx.gas_cost ? (parseFloat(tx.gas_cost) || 0) : 0;
    
    return (amount + gasCost).toFixed(6);
  };

  // Format gas cost with proper decimals
  const formatGasCost = (gasCost?: string): string => {
    if (!gasCost) return '0';
    return parseFloat(gasCost).toFixed(6);
  };

  // Get navigation link for transfer page
  const getTransferLink = (): JSX.Element => {
    return (
      <Link href="/" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
        Go to Transfer
      </Link>
    );
  };

  // Delete a single transaction
  const deleteTransaction = async (txId: string) => {
    setDeletingId(txId);
    
    try {
      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', txId)
        .eq('user_id', user?.id);
        
      if (error) {
        console.error('Error deleting transaction:', error);
        toast.error('Failed to delete transaction');
        return;
      }
      
      // Filter out the deleted transaction from the state
      setTransactions(transactions.filter(tx => tx.id !== txId));
      toast.success('Transaction deleted successfully');
    } catch (error) {
      console.error('Error deleting transaction:', error);
      toast.error('Failed to delete transaction');
    } finally {
      setDeletingId(null);
    }
  };
  
  // Clear all transactions for the current user
  const clearAllTransactions = async () => {
    if (!window.confirm('Are you sure you want to clear all transactions? This cannot be undone.')) {
      return;
    }
    
    setIsDeleting(true);
    
    try {
      // Only filter by network if one is specifically selected
      let query = supabase
        .from('transactions')
        .delete()
        .eq('user_id', user?.id);
        
      if (selectedNetwork) {
        query = query.eq('network_id', selectedNetwork.id);
      }
      
      const { error } = await query;
        
      if (error) {
        console.error('Error clearing transactions:', error);
        toast.error('Failed to clear transactions');
        return;
      }
      
      // If a network is selected, only remove transactions for that network
      if (selectedNetwork) {
        setTransactions(transactions.filter(tx => tx.network_id !== selectedNetwork.id));
      } else {
        setTransactions([]);
      }
      
      toast.success('Transactions cleared successfully');
    } catch (error) {
      console.error('Error clearing transactions:', error);
      toast.error('Failed to clear transactions');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <Header />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Transaction History</h1>
        
        <div className="bg-white shadow-lg rounded-lg overflow-hidden border border-gray-200">
          <div className="px-4 sm:px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-blue-50">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-indigo-700">Your Transactions</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={refreshTransactions}
                  disabled={isRefreshing}
                  className="px-3 py-1 text-sm rounded-full bg-indigo-100 text-indigo-800 hover:bg-indigo-200 transition-colors disabled:opacity-50 flex items-center"
                >
                  {isRefreshing ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-indigo-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Checking...
                    </>
                  ) : (
                    'Refresh Status'
                  )}
                </button>
                {transactions.length > 0 && (
                  <button 
                    onClick={clearAllTransactions}
                    disabled={isDeleting}
                    className="px-3 py-1 text-sm rounded-full bg-red-100 text-red-800 hover:bg-red-200 transition-colors disabled:opacity-50 flex items-center"
                  >
                    {isDeleting ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-red-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Clearing...
                      </>
                    ) : (
                      'Clear All'
                    )}
                  </button>
                )}
                {selectedNetwork && (
                  <span className="px-3 py-1 text-sm rounded-full bg-blue-100 text-blue-800">
                    Network: {selectedNetwork.name}
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2 italic">
              Note: To reduce storage usage, transactions are automatically deleted after 7 days.
            </p>
          </div>
          
          {!account ? (
            <div className="p-10 text-center">
              <div className="mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-700 mb-2">Connect Your Wallet</h3>
              <p className="text-gray-500 max-w-md mx-auto">Connect your wallet to view your transaction history and track all your transfers.</p>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center items-center p-16">
              <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500"></div>
              <span className="ml-4 text-gray-600">Loading your transactions...</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-700 mb-2">No Transactions Found</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                You haven't made any transactions yet. Start by making a transfer from the transfer page.
              </p>
              <div className="mt-6">
                {getTransferLink()}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      TX Hash
                    </th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                      Network
                    </th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                      Amounts
                    </th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.map((tx) => (
                    <React.Fragment key={tx.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600">
                          {formatDate(tx.timestamp)}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600">
                          {tx.tx_hash ? (
                            <a 
                              href={getExplorerUrl(tx)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              {formatTxHash(tx.tx_hash)}
                            </a>
                          ) : (
                            <span>N/A</span>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 hidden md:table-cell">
                          {tx.networkName || 'Unknown'}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm hidden sm:table-cell">
                          <div className="space-y-1">
                            <p className="text-gray-800">
                              <span className="font-medium">Transfer:</span> {tx.amount} {tx.currencySymbol || ''}
                            </p>
                            <p className="text-gray-600 text-xs">
                              <span className="font-medium">Gas Cost:</span> {formatGasCost(tx.gas_cost)} {tx.currencySymbol || ''}
                            </p>
                            <p className="text-gray-800 text-sm font-semibold">
                              <span className="font-medium">Total:</span> {calculateTotalAmount(tx)} {tx.currencySymbol || ''}
                            </p>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(tx.status)}`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600">
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              onClick={() => toggleTxDetails(tx.id)}
                              className="inline-flex items-center justify-center px-3 py-1 border border-transparent rounded-md text-xs sm:text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                            >
                              {expandedTx === tx.id ? (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                                  </svg>
                                  Hide
                                </>
                              ) : (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                  Details
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => deleteTransaction(tx.id)}
                              disabled={deletingId === tx.id}
                              className="inline-flex items-center justify-center px-3 py-1 border border-transparent rounded-md text-xs sm:text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                            >
                              {deletingId === tx.id ? (
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  Delete
                                </>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedTx === tx.id && (
                        <tr className="bg-indigo-50">
                          <td colSpan={6} className="px-3 sm:px-6 py-4">
                            <div className="bg-white p-3 sm:p-4 rounded-lg border border-indigo-100 shadow-sm">
                              <div className="mb-3 pb-2 border-b border-gray-200">
                                <h4 className="text-lg font-medium text-indigo-700">Transaction Details</h4>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 text-sm">
                                <div className="space-y-3">
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <h5 className="font-medium text-gray-800 mb-2">Contract Information</h5>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Name:</span>
                                      <span>{tx.contractName || 'Unknown'}</span>
                                    </p>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Address:</span>
                                      {tx.contract_id && (
                                        <a 
                                          href={getAddressExplorerUrl(userContracts.find(c => c.id === tx.contract_id)?.address || '', tx.network_id)} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:text-blue-800 truncate"
                                        >
                                          {formatAddress(userContracts.find(c => c.id === tx.contract_id)?.address || '')}
                                        </a>
                                      )}
                                    </p>
                                  </div>
                                  
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <h5 className="font-medium text-gray-800 mb-2">Network Information</h5>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Network:</span>
                                      <span>{tx.networkName || 'Unknown'}</span>
                                    </p>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Currency:</span>
                                      <span>{tx.currencySymbol || ''}</span>
                                    </p>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Wallet:</span>
                                      <a 
                                        href={getAddressExplorerUrl(tx.wallet_address, tx.network_id)} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800 truncate"
                                      >
                                        {formatAddress(tx.wallet_address)}
                                      </a>
                                    </p>
                                  </div>
                                </div>
                                
                                <div className="space-y-3">
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <h5 className="font-medium text-gray-800 mb-2">Financial Details</h5>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Transfer Amount:</span>
                                      <span>{tx.amount} {tx.currencySymbol || ''}</span>
                                    </p>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Gas Cost:</span>
                                      <span>{formatGasCost(tx.gas_cost)} {tx.currencySymbol || ''}</span>
                                    </p>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1 font-medium">
                                      <span>Total:</span>
                                      <span>{calculateTotalAmount(tx)} {tx.currencySymbol || ''}</span>
                                    </p>
                                  </div>
                                  
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <h5 className="font-medium text-gray-800 mb-2">Transaction Information</h5>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Recipients:</span>
                                      <span>{Array.isArray(tx.recipients) ? tx.recipients.length : 0}</span>
                                    </p>
                                    <p className="text-gray-700 flex flex-col sm:flex-row sm:justify-between gap-1">
                                      <span className="font-medium">Status:</span>
                                      <span className={`px-2 py-0.5 text-xs rounded-full ${getStatusColor(tx.status)}`}>
                                        {tx.status}
                                      </span>
                                    </p>
                                    {tx.status === 'failed' && tx.error && (
                                      <p className="text-red-600 mt-2 text-xs break-words">
                                        <span className="font-medium">Error:</span>{' '}
                                        {tx.error}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Recipients and Child Contracts Section */}
                              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                                {/* Recipients List */}
                                {Array.isArray(tx.recipients) && tx.recipients.length > 0 && (
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <h5 className="font-medium text-gray-800 mb-2">Recipients List</h5>
                                    <div className="max-h-36 overflow-y-auto pr-2">
                                      <ul className="space-y-1 divide-y divide-gray-200">
                                        {tx.recipients.map((recipient, index) => (
                                          <li key={index} className="py-1 flex justify-between items-center">
                                            <span className="text-gray-600 text-xs">{index + 1}.</span>
                                            <a 
                                              href={getAddressExplorerUrl(recipient, tx.network_id)} 
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                              className="text-blue-600 hover:text-blue-800 font-mono text-xs truncate max-w-[80%]"
                                            >
                                              {recipient}
                                            </a>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                )}

                                {/* Child Contracts Section */}
                                {tx.status === 'success' && (
                                  <div className="bg-gray-50 p-3 rounded-lg">
                                    <h5 className="font-medium text-gray-800 mb-2">Child Contracts</h5>
                                    {Array.isArray(tx.child_contracts) && tx.child_contracts.length > 0 ? (
                                      <div className="max-h-36 overflow-y-auto pr-2">
                                        <ul className="space-y-1 divide-y divide-gray-200">
                                          {tx.child_contracts.map((contract, index) => (
                                            <li key={index} className="py-1 flex justify-between items-center">
                                              <span className="text-gray-600 text-xs">{index + 1}.</span>
                                              <a 
                                                href={getAddressExplorerUrl(contract, tx.network_id)} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:text-blue-800 font-mono text-xs truncate max-w-[80%]"
                                              >
                                                {contract}
                                              </a>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : (
                                      <p className="text-gray-600 text-sm">
                                        Child contracts were created and self-destructed during this transaction
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              {tx.tx_hash && (
                                <div className="mt-4 text-right">
                                  <a 
                                    href={getExplorerUrl(tx)}
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                      <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                      <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                                    </svg>
                                    View on Explorer
                                  </a>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      
      {/* Simple footer with copyright */}
      <footer className="bg-gray-800 text-white py-6 px-6 mt-12">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-gray-400">© {new Date().getFullYear()} Sybil Transfer. All rights reserved.</p>
          <p className="text-gray-500 text-sm mt-2">Created by Satwik Samanta</p>
        </div>
      </footer>
    </main>
  );
} 