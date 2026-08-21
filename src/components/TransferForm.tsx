"use client";

import React, { useState, useEffect } from 'react';
import { useWeb3 } from '@/context/Web3Context';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'react-toastify';
import { ethers } from 'ethers';
import { supabase } from '@/utils/supabaseClient';
import {
  createTransaction,
  updateTransaction,
  getTransactionHistory,
} from '@/utils/workerClient';
import Link from 'next/link';
import { v4 as uuidv4 } from 'uuid';

type Recipient = {
  id?: string;
  address: string;
  amount: string;
  isValid?: boolean;
  error?: string;
};

type WalletGroup = {
  id: string;
  user_id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  wallets: UserWallet[];
};

export type WalletGroupMember = {
  id: string;
  group_id: string;
  wallet_id: string;
  wallet?: UserWallet;
};

type InputMode = 'individual' | 'bulk' | 'group';

// Define UserWallet type
type UserWallet = {
  id: string;
  address: string;
  name: string | null;
  user_id: string;
  last_connected?: string;
  created_at?: string;
};

const TransferForm = () => {
  const { user } = useAuth();
  const { account, signer, selectedNetwork, userNetworks, userContracts, getContractInstance } = useWeb3();
  const [recipients, setRecipients] = useState<Recipient[]>([{ address: '', amount: '' }]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [contractAddress, setContractAddress] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [inputMode, setInputMode] = useState<InputMode>('individual');
  const [bulkAddresses, setBulkAddresses] = useState('');
  const [bulkAmounts, setBulkAmounts] = useState('');
  const [bulkStep, setBulkStep] = useState<'addresses' | 'amounts' | 'review'>('addresses');
  const [validatedRecipients, setValidatedRecipients] = useState<Recipient[]>([]);
  const [hasValidationErrors, setHasValidationErrors] = useState(false);
  
  // New state for wallet groups
  const [walletGroups, setWalletGroups] = useState<WalletGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<WalletGroup | null>(null);
  const [selectedGroupWallets, setSelectedGroupWallets] = useState<string[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState<boolean>(false);
  
  // Flag to enable wallet groups feature
  const enableWalletGroups = true; // Turn on wallet groups feature
  
  // Set first available contract when contracts change or network changes
  useEffect(() => {
    if (selectedNetwork) {
      // Find contracts for the selected network
      const networkContracts = userContracts.filter(
        c => c.network_id === selectedNetwork.id
      );
      
      if (networkContracts.length > 0) {
        setSelectedContractId(networkContracts[0].id);
        setContractAddress(networkContracts[0].address);
        setIsLoading(false);
      } else {
        setSelectedContractId('');
        setContractAddress('');
        setIsLoading(false);
      }
    } else {
      setSelectedContractId('');
      setContractAddress('');
      setIsLoading(false);
    }
  }, [userContracts, selectedNetwork]);
  
  // Fetch wallet groups when user is available
  useEffect(() => {
    if (user) {
      fetchWalletGroups();
    }
  }, [user]);
  
  // Fetch wallet groups from Supabase
  const fetchWalletGroups = async () => {
    try {
      setIsLoadingGroups(true);
      
      // Check if user is signed in
      if (!user?.id) {
        console.log('User not signed in, cannot fetch wallet groups');
        setWalletGroups([]);
        setIsLoadingGroups(false);
        return;
      }
      
      // Fetch wallet groups for the current user only
      const { data, error } = await supabase
        .from('wallet_groups')
        .select('*')
        .eq('user_id', user.id)
        .order('name');
      
      if (error) {
        console.error('Error fetching wallet groups:', error);
        setWalletGroups([]);
        setIsLoadingGroups(false);
        return;
      }
      
      console.log(`Found ${data.length} wallet groups for user ${user.id}`);
      
      // Create a placeholder array with empty wallets
      const groups = data.map((group) => ({
        ...group,
        wallets: [] as UserWallet[]
      }));
      
      setWalletGroups(groups);
      
      // Fetch wallet members for each group
      for (const group of groups) {
        try {
          const { data: membersData, error: membersError } = await supabase
            .from('wallet_group_members')
            .select(`
              id,
              group_id,
              wallet_id,
              wallet:user_wallets (*)
            `)
            .eq('group_id', group.id);
          
          if (!membersError && membersData) {
            console.log(`Found ${membersData.length} wallets for group ${group.id}`);
            // Update group with its wallets
            const wallets = membersData.map(member => {
              // First convert to unknown, then to UserWallet to avoid type error
              const wallet = member.wallet as unknown as UserWallet;
              return wallet;
            });
            
            setWalletGroups(prev => 
              prev.map(g => 
                g.id === group.id ? { ...g, wallets } : g
              )
            );
          }
        } catch (err) {
          console.error(`Error fetching members for group ${group.id}:`, err);
        }
      }
      
      setIsLoadingGroups(false);
    } catch (error) {
      console.error('Error in fetchWalletGroups:', error);
      setWalletGroups([]);
      setIsLoadingGroups(false);
    }
  };
  
  // Handle group selection
  const handleGroupSelect = (groupId: string) => {
    console.log(`Selecting group with ID: ${groupId}`);
    setSelectedGroupId(groupId);
    const group = walletGroups.find(g => g.id === groupId) || null;
    setSelectedGroup(group);
    
    if (group && group.wallets.length > 0) {
      console.log(`Group "${group.name}" has ${group.wallets.length} wallets`);
      // Pre-populate selected wallets with all wallet IDs
      setSelectedGroupWallets(group.wallets.map(wallet => wallet.id));
    } else {
      console.log('Selected group has no wallets');
      setSelectedGroupWallets([]);
    }
  };
  
  // Update contract address when selected contract changes
  const handleContractChange = (contractId: string) => {
    setSelectedContractId(contractId);
    
    const selectedContract = userContracts.find(c => c.id === contractId);
    if (selectedContract) {
      setContractAddress(selectedContract.address);
    } else {
      setContractAddress('');
    }
  };

  // Switch between input modes
  const toggleInputMode = (mode: InputMode) => {
    if (mode === inputMode) return;
    
    setInputMode(mode);
    
    if (mode === 'individual') {
      // If there are validated recipients from bulk mode, use them
      if (validatedRecipients.length > 0) {
        setRecipients(validatedRecipients);
      } else {
        // Reset to a single empty recipient
        setRecipients([{ address: '', amount: '' }]);
      }
      setBulkStep('addresses');
      setBulkAddresses('');
      setBulkAmounts('');
    } else if (mode === 'bulk') {
      // Reset bulk input fields
      setBulkAddresses('');
      setBulkAmounts('');
      setBulkStep('addresses');
      setValidatedRecipients([]);
      setHasValidationErrors(false);
    }
  };

  // Add a new recipient field
  const addRecipient = () => {
    setRecipients([...recipients, { address: '', amount: '' }]);
  };

  // Remove a recipient field
  const removeRecipient = (index: number) => {
    if (recipients.length <= 1) return;
    const newRecipients = [...recipients];
    newRecipients.splice(index, 1);
    setRecipients(newRecipients);
  };

  // Update recipient data
  const updateRecipient = (index: number, field: 'address' | 'amount', value: string) => {
    const newRecipients = [...recipients];
    
    if (field === 'address') {
      newRecipients[index].address = value;
    } else if (field === 'amount') {
      newRecipients[index].amount = value;
    }
    
    setRecipients(newRecipients);
  };

  // Calculate total amount to transfer
  const calculateTotal = (recipientsToCalculate: Recipient[] = recipients): string => {
    try {
      // Use a try-catch to handle potential ethers import issues
      try {
        let total = ethers.BigNumber.from('0');
        
        for (const recipient of recipientsToCalculate) {
          if (recipient.amount && !isNaN(parseFloat(recipient.amount))) {
            const amountWei = ethers.utils.parseEther(recipient.amount);
            total = total.add(amountWei);
          }
        }
        
        return ethers.utils.formatEther(total);
      } catch (ethersError) {
        console.error("Error with ethers calculations:", ethersError);
        return '0';
      }
    } catch (error) {
      return '0';
    }
  };

  // Check if form is valid
  const isFormValid = (recipientsToValidate: Recipient[] = recipients): boolean => {
    // Check basic conditions for submission
    if (!account || !signer || !selectedNetwork || !contractAddress) {
      return false;
    }
    
    // Must have at least one recipient
    if (recipientsToValidate.length === 0) {
      return false;
    }
    
    // All recipients must have valid addresses and amounts
    for (const recipient of recipientsToValidate) {
      if (!recipient.address || !recipient.amount) {
        return false;
      }
      
      try {
        ethers.utils.getAddress(recipient.address); // Validates the address
        const amount = parseFloat(recipient.amount);
        if (isNaN(amount) || amount <= 0) {
          return false;
        }
      } catch {
        return false;
      }
    }
    
    return true;
  };

  // Process bulk addresses
  const processBulkAddresses = () => {
    if (!bulkAddresses.trim()) {
      toast.error('Please enter at least one address');
      return;
    }

    const addressLines = bulkAddresses
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (addressLines.length === 0) {
      toast.error('No valid addresses found');
      return;
    }

    // Create temporary recipients with just addresses
    const tempRecipients = addressLines.map(address => ({
      address,
      amount: '',
      isValid: false,
      error: ''
    }));

    // Validate addresses
    const validatedAddresses = tempRecipients.map(recipient => {
      try {
        const validated = {
          ...recipient,
          address: ethers.utils.getAddress(recipient.address),
          isValid: true,
          error: ''
        };
        return validated;
      } catch (error) {
        return {
          ...recipient,
          isValid: false,
          error: 'Invalid Ethereum address'
        };
      }
    });

    setValidatedRecipients(validatedAddresses);
    
    // Check if there are validation errors
    const hasErrors = validatedAddresses.some(r => !r.isValid);
    setHasValidationErrors(hasErrors);
    
    if (hasErrors) {
      toast.error('Some addresses are invalid. Please correct them before proceeding.');
    } else {
      // Proceed to amount step
      setBulkStep('amounts');
    }
  };

  // Process bulk amounts
  const processBulkAmounts = () => {
    if (!bulkAmounts.trim()) {
      toast.error('Please enter at least one amount');
      return;
    }

    const amountLines = bulkAmounts
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (amountLines.length === 0) {
      toast.error('No valid amounts found');
      return;
    }

    // Check if the number of amounts matches the number of addresses
    if (amountLines.length !== validatedRecipients.length) {
      toast.error(`Number of amounts (${amountLines.length}) doesn't match number of addresses (${validatedRecipients.length})`);
      return;
    }

    // Combine addresses and amounts
    const combinedRecipients = validatedRecipients.map((recipient, index) => {
      const amount = amountLines[index];
      let isValid = recipient.isValid;
      let error = recipient.error || '';

      // Validate amount
      try {
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          isValid = false;
          error = 'Invalid amount';
        }
        // Try to parse as Ether to ensure it's a valid decimal
        ethers.utils.parseEther(amount);
      } catch (error) {
        isValid = false;
        error = 'Invalid amount format';
      }

      return {
        ...recipient,
        amount,
        isValid,
        error
      };
    });

    setValidatedRecipients(combinedRecipients);
    
    // Check if there are validation errors
    const hasErrors = combinedRecipients.some(r => !r.isValid);
    setHasValidationErrors(hasErrors);
    
    if (hasErrors) {
      toast.error('Some entries are invalid. Please correct them before proceeding.');
    } else {
      // Proceed to review step
      setBulkStep('review');
    }
  };

  // Handle bulk transfer submission
  const handleBulkSubmit = () => {
    // Use the validated recipients for the transaction
    if (isFormValid(validatedRecipients)) {
      setRecipients(validatedRecipients);
      // Transition back to individual mode with the validated recipients
      setInputMode('individual');
      toast.success('Bulk entries validated. You can now send the transaction.');
    } else {
      toast.error('There was an error with your bulk entries. Please review and try again.');
    }
  };

  // Reset bulk form
  const resetBulkForm = () => {
    setBulkAddresses('');
    setBulkAmounts('');
    setBulkStep('addresses');
    setValidatedRecipients([]);
    setHasValidationErrors(false);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isFormValid()) {
      toast.error('Please fill all required fields correctly');
      return;
    }
    
    if (!selectedNetwork) {
      toast.error('Please select a network');
      return;
    }
    
    if (!selectedContractId) {
      toast.error('Please select a contract');
      return;
    }
    
    setIsProcessing(true);
    
    // Generate a unique transaction ID for tracking
    const txId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    try {
      // Prepare contract call data
      const contract = getContractInstance(contractAddress);
      if (!contract) {
        throw new Error('Failed to initialize contract');
      }
      
      // Prepare arrays for the contract call
      const addresses = recipients.map(r => ethers.utils.getAddress(r.address));
      const amounts = recipients.map(r => ethers.utils.parseEther(r.amount));
      
      // Calculate total value to send
      const totalValue = amounts.reduce((sum, val) => sum.add(val), ethers.BigNumber.from('0'));

      // Log pending transaction first — THE BUG FIX: the Worker forces user_id
      // from the JWT, so even if user.id is missing here, the transaction is
      // still correctly associated with the logged-in user (not the wallet).
      try {
        // Get the Supabase session's access_token
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        await createTransaction({
          wallet_address: account || '',
          network_id: selectedNetwork.id,
          contract_id: selectedContractId,
          tx_hash: '', // Will be filled after sending
          status: 'pending',
          amount: ethers.utils.formatEther(totalValue),
          recipients: JSON.stringify(addresses),
          timestamp: new Date().toISOString(),
        }, token);
        console.log('Pending transaction logged');
      } catch (dbError) {
        console.error('Failed to log pending transaction:', dbError);
        // Continue anyway since this is just logging
      }

      // Get gas estimate for the transaction
      let gasEstimate;
      try {
        gasEstimate = await contract.estimateGas.createMultipleChildContracts(
          addresses,
          amounts,
          { value: totalValue }
        );
      } catch (error: any) {
        console.error('Gas estimation failed:', error);
        toast.error(`Gas estimation failed: ${error.message || 'Unable to estimate gas'}`);
        setIsProcessing(false);
        return;
      }
      
      // Get gas price
      const gasPrice = await contract.provider.getGasPrice();
      
      // Calculate gas cost
      const gasCost = gasEstimate.mul(gasPrice);
      const gasCostEther = ethers.utils.formatEther(gasCost);
      
      // Execute the transaction with appropriate transaction overrides
      const txOptions = { 
        value: totalValue,
        gasLimit: gasEstimate.mul(12).div(10) // Add 20% buffer
      };
      
      // Send the transaction
      const tx = await contract.createMultipleChildContracts(
        addresses,
        amounts,
        txOptions
      );
      
      toast.info(`Transaction submitted: ${tx.hash}`);

      // Get session token for Worker calls
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      // Fetch the most recent pending transaction via the Worker
      // (Worker scopes by user_id from JWT, not wallet_address)
      const { data: recentTxs } = await getTransactionHistory(token);
      const recentTx = recentTxs && recentTxs.length > 0
        ? recentTxs.filter(t => t.status === 'pending').slice(0, 1)
        : [];

      // Update transaction with hash via the Worker
      if (recentTx && recentTx.length > 0) {
        await updateTransaction(recentTx[0].id, { tx_hash: tx.hash }, token);
        console.log('Transaction updated with hash');
      }

      // Wait for transaction to be mined
      try {
        const receipt = await tx.wait();

        // Extract child contract addresses if available in the receipt
        const childContracts: string[] = [];
        if (receipt && receipt.logs) {
          // Try to extract child contract addresses from logs
          receipt.logs.forEach(log => {
            if (log.address && log.address !== contractAddress) {
              if (!childContracts.includes(log.address)) {
                childContracts.push(log.address);
              }
            }
          });
        }

        // Add a slight delay to ensure the transaction is fully confirmed
        // This helps prevent the UI from showing "pending" status after blockchain confirmation
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Update the transaction to success via the Worker
        if (recentTx && recentTx.length > 0) {
          const { error } = await updateTransaction(recentTx[0].id, {
            status: 'success',
            gas_cost: gasCostEther,
            child_contracts: childContracts.length > 0 ? JSON.stringify(childContracts) : null,
          }, token);
  
          if (error) {
            console.error('Error updating transaction to success:', error);
          } else {
            console.log('Transaction updated to success');
          }
        }
        
        toast.success('Transfer completed successfully!');
      } catch (error: any) {
        console.error('Error waiting for transaction receipt:', error);
        
        // Update transaction to failed
        if (recentTx && recentTx.length > 0) {
          await supabase
            .from('transactions')
            .update({
              status: 'failed',
              error: error.message || 'Error waiting for receipt'
            })
            .eq('id', recentTx[0].id);
        }
          
        throw new Error('Transaction failed: ' + (error.message || 'Error waiting for receipt'));
      }
      
      // Reset form
      setRecipients([{ address: '', amount: '' }]);
      resetBulkForm();
    } catch (error: any) {
      console.error('Transfer error:', error);
      toast.error(`Transaction failed: ${error.message || 'Unknown error'}`);
      
      // Log failed transaction via Worker (user_id is forced from JWT)
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        // Fetch the user's most recent transaction via the Worker
        const { data: recentTxs } = await getTransactionHistory(token);
        const lastTx = recentTxs && recentTxs.length > 0 ? recentTxs[0] : null;
        const isSameTimestamp = lastTx &&
          new Date(lastTx.timestamp).getTime() > (Date.now() - 30000);
        const isAlreadyFailed = lastTx && lastTx.status === 'failed';

        if (!isSameTimestamp || !isAlreadyFailed) {
          // This is a new error, not related to our most recent transaction
          await createTransaction({
            wallet_address: account || '',
          network_id: selectedNetwork.id || '',
            contract_id: selectedContractId,
            tx_hash: '',
            status: 'failed',
            amount: calculateTotal(),
            recipients: JSON.stringify(recipients.map(r => r.address)),
            timestamp: new Date().toISOString(),
            error: error.message,
          }, token);
          console.log('Failed transaction logged');
        }
      } catch (dbError) {
        console.error('Error logging failed transaction:', dbError);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Add truncateEthAddress function
  const truncateEthAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Check for wallet connection and permissions
  if (!account) {
    return (
      <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200">
        <p className="text-yellow-700">Please connect your wallet to continue</p>
      </div>
    );
  }

  // No contracts available
  if (!isLoading && (!userContracts || userContracts.length === 0)) {
    return (
      <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200">
        <p className="text-yellow-700">
          You need to add contracts in the dashboard before making transfers.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-semibold mb-4">Multi-Transfer</h2>
      
      {isLoading ? (
        <div className="flex justify-center my-4">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : (
        <>
          <div className="mb-6 border-b pb-4">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Contract
              </label>
              <select
                value={selectedContractId}
                onChange={(e) => handleContractChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                disabled={!selectedNetwork || userContracts.filter(c => c.network_id === selectedNetwork.id).length === 0}
              >
                <option value="">Select a contract</option>
                {selectedNetwork && userContracts
                  .filter(c => c.network_id === selectedNetwork.id)
                  .map(contract => (
                    <option key={contract.id} value={contract.id}>
                      {contract.name}
                    </option>
                  ))
                }
              </select>
            </div>
            
            {contractAddress && (
              <>
                <p className="text-sm text-gray-600">
                  Contract: <span className="font-mono">{`${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}`}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Network: <span className="font-medium">{selectedNetwork?.name}</span>
                </p>
              </>
            )}
          </div>

          {/* Input Mode Toggle */}
          <div className="mb-6">
            <div className="flex space-x-2 mb-4">
              <button
                type="button"
                className={`px-4 py-2 rounded-md ${
                  inputMode === 'individual' ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}
                onClick={() => {
                  setInputMode('individual');
                  setRecipients([{ address: '', amount: '' }]);
                }}
              >
                Individual Recipients
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-md ${
                  inputMode === 'bulk' ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}
                onClick={() => {
                  setInputMode('bulk');
                  setRecipients([{ address: '', amount: '' }]);
                }}
              >
                Bulk Import
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-md ${
                  inputMode === 'group' ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}
                onClick={() => {
                  setInputMode('group');
                  setRecipients([{ address: '', amount: '' }]);
                  fetchWalletGroups();
                }}
              >
                Wallet Groups
              </button>
            </div>
          </div>
          
          {/* Individual Entry Form */}
          {inputMode === 'individual' && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-md font-medium">Recipients</h3>
                  <button
                    type="button"
                    onClick={addRecipient}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    + Add Recipient
                  </button>
                </div>
                
                {recipients.map((recipient, index) => (
                  <div key={index} className="flex space-x-2">
                    <div className="flex-grow">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Address
                      </label>
                      <input
                        type="text"
                        value={recipient.address}
                        onChange={(e) => updateRecipient(index, 'address', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="0x..."
                      />
                    </div>
                    <div className="w-1/3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Amount ({selectedNetwork?.currencySymbol})
                      </label>
                      <input
                        type="text"
                        value={recipient.amount}
                        onChange={(e) => updateRecipient(index, 'amount', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="0.0"
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      {recipients.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRecipient(index)}
                          className="text-red-500 hover:text-red-700 px-2 py-2"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 011-1h4a1 1 0 010 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-md font-medium">Total Amount:</span>
                  <span className="text-lg font-semibold">{calculateTotal()} {selectedNetwork?.currencySymbol}</span>
                </div>
                
                <button
                  type="submit"
                  disabled={!isFormValid() || isProcessing}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition duration-200 disabled:opacity-50"
                >
                  {isProcessing ? 'Processing...' : 'Send Transaction'}
                </button>
              </div>
            </form>
          )}
          
          {/* Bulk Entry Form */}
          {inputMode === 'bulk' && (
            <div className="space-y-6">
              {/* Step 1: Addresses */}
              {bulkStep === 'addresses' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-md font-medium mb-2">Step 1: Enter Addresses (one per line)</h3>
                    <textarea
                      value={bulkAddresses}
                      onChange={(e) => setBulkAddresses(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      rows={10}
                      placeholder="0x1234...&#10;0x5678...&#10;0x90ab..."
                    />
                  </div>
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={processBulkAddresses}
                      className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-6 rounded-md transition duration-200"
                    >
                      Next: Enter Amounts
                    </button>
                  </div>
                </div>
              )}
              
              {/* Step 2: Amounts */}
              {bulkStep === 'amounts' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-md font-medium mb-2">Step 2: Enter Amounts (one per line)</h3>
                    <p className="text-sm text-gray-600 mb-2">
                      Please enter {validatedRecipients.length} amounts, one for each address:
                    </p>
                    <textarea
                      value={bulkAmounts}
                      onChange={(e) => setBulkAmounts(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      rows={10}
                      placeholder="0.1&#10;0.5&#10;1.0"
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <button
                      type="button"
                      onClick={() => setBulkStep('addresses')}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-md transition duration-200"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={processBulkAmounts}
                      className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-6 rounded-md transition duration-200"
                    >
                      Next: Review
                    </button>
                  </div>
                </div>
              )}
              
              {/* Step 3: Review */}
              {bulkStep === 'review' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-md font-medium mb-2">Step 3: Review & Confirm</h3>
                    <div className="border border-gray-200 rounded-md overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              #
                            </th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Address
                            </th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Amount ({selectedNetwork?.currencySymbol})
                            </th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {validatedRecipients.map((recipient, index) => (
                            <tr key={index} className={recipient.isValid ? '' : 'bg-red-50'}>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                                {index + 1}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm font-mono">
                                {recipient.address.slice(0, 10)}...{recipient.address.slice(-8)}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm">
                                {recipient.amount}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm">
                                {recipient.isValid ? (
                                  <span className="text-green-600">✓ Valid</span>
                                ) : (
                                  <span className="text-red-600">✗ {recipient.error}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-md font-medium">Total Amount:</span>
                      <span className="text-lg font-semibold">{calculateTotal(validatedRecipients)} {selectedNetwork?.currencySymbol}</span>
                    </div>
                    
                    <div className="flex justify-between">
                      <button
                        type="button"
                        onClick={() => setBulkStep('amounts')}
                        className="bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-md transition duration-200"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={resetBulkForm}
                        className="bg-red-100 hover:bg-red-200 text-red-800 py-2 px-4 rounded-md transition duration-200 mx-2"
                      >
                        Start Over
                      </button>
                      <button
                        type="button"
                        onClick={handleBulkSubmit}
                        disabled={hasValidationErrors}
                        className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-6 rounded-md transition duration-200 disabled:opacity-50"
                      >
                        Confirm & Proceed
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Group Entry Form */}
          {inputMode === 'group' && enableWalletGroups && (
            <>
              {isLoadingGroups ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                  <p className="mt-2 text-gray-500">Loading wallet groups...</p>
                </div>
              ) : walletGroups.length === 0 ? (
                <div className="text-center p-6 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-4xl mb-2">📁</div>
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No wallet groups found</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    No wallet groups were found for your account.
                  </p>
                  <div className="mt-4 flex justify-center space-x-4">
                    <Link
                      href="/wallets"
                      className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Manage Wallet Groups
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        toast.info('Refreshing wallet groups...');
                        fetchWalletGroups();
                      }}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      🔄 Refresh Groups
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <label className="block text-sm font-medium text-gray-700">
                      Select Wallet Group
                    </label>
                    <button 
                      onClick={fetchWalletGroups}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Refresh
                    </button>
                  </div>
                  <select
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    value={selectedGroupId || ''}
                    onChange={(e) => {
                      const groupId = e.target.value;
                      setSelectedGroupId(groupId === '' ? null : groupId);
                      const group = walletGroups.find((g) => g.id === groupId);
                      setSelectedGroup(group || null);
                      setSelectedGroupWallets([]); // Reset selected wallets
                    }}
                  >
                    <option value="" disabled>
                      Select a group
                    </option>
                    {walletGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} ({group.wallets?.length || 0} wallets)
                      </option>
                    ))}
                  </select>

                  {selectedGroup && selectedGroup.wallets && selectedGroup.wallets.length > 0 && (
                    <>
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Select Wallets from Group
                          </label>
                          <div className="flex space-x-2">
                            <button
                              type="button"
                              onClick={() => setSelectedGroupWallets(selectedGroup.wallets.map(w => w.id))}
                              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedGroupWallets([])}
                              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            >
                              Clear All
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 border border-gray-200 rounded-md p-3 max-h-60 overflow-y-auto">
                          {selectedGroup.wallets.map((wallet) => (
                            <div key={wallet.id} className="flex items-center py-2 border-b border-gray-100 last:border-b-0">
                              <input
                                type="checkbox"
                                id={`wallet-${wallet.id}`}
                                checked={selectedGroupWallets.includes(wallet.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedGroupWallets([...selectedGroupWallets, wallet.id]);
                                  } else {
                                    setSelectedGroupWallets(selectedGroupWallets.filter(id => id !== wallet.id));
                                  }
                                }}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              />
                              <label htmlFor={`wallet-${wallet.id}`} className="ml-3 block">
                                <span className="text-sm font-medium text-gray-900">{wallet.name || 'Unnamed wallet'}</span>
                                <span className="block text-xs text-gray-500 font-mono">{truncateEthAddress(wallet.address)}</span>
                              </label>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-sm text-gray-500">Selected: {selectedGroupWallets.length} of {selectedGroup.wallets.length} wallets</p>
                      </div>

                      {selectedGroupWallets.length > 0 && (
                        <div className="mt-4">
                          <button
                            type="button"
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            onClick={() => {
                              // Get details of selected wallets
                              const selectedWallets = selectedGroup.wallets.filter(wallet => 
                                selectedGroupWallets.includes(wallet.id)
                              );
                              
                              // Add selected wallets to recipients with empty amounts
                              const newRecipients = selectedWallets.map(wallet => ({
                                id: uuidv4(),
                                address: wallet.address,
                                amount: '',
                              }));
                              
                              setRecipients([...recipients, ...newRecipients]);
                              
                              // Show success message
                              toast.success(`Added ${newRecipients.length} wallets to recipients list`);
                              
                              // Switch to individual mode to review recipients
                              setInputMode('individual');
                            }}
                          >
                            Add Selected Wallets to Recipients
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  
                  {selectedGroup && (!selectedGroup.wallets || selectedGroup.wallets.length === 0) && (
                    <div className="text-center p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-yellow-700 mb-2">This group has no wallets. Add wallets to this group to use it.</p>
                      <Link href="/wallets" className="text-blue-600 hover:text-blue-800 font-medium">
                        Manage Group Wallets →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default TransferForm; 