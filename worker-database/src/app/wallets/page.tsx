"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useWeb3 } from '@/context/Web3Context';
import { toast } from 'react-toastify';
import { supabase } from '@/utils/supabaseClient';
import Header from '@/components/Header';
import Link from 'next/link';

// Types for our components
type Wallet = {
  id: string;
  address: string;
  name: string | null;
  last_connected: string;
};

type WalletGroup = {
  id: string;
  name: string;
  created_at: string;
  wallets?: Wallet[];
};

const WalletsPage = () => {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { account, connectWallet } = useWeb3();

  // State for wallets and wallet groups
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletGroups, setWalletGroups] = useState<WalletGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // State for modals and forms
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [walletForm, setWalletForm] = useState({ name: '', address: '' });
  const [groupForm, setGroupForm] = useState({ name: '', selectedWallets: [] as string[] });
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Load wallet and group data
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/sign-in');
      return;
    }

    if (user) {
      fetchWallets();
      // Try to create tables and then fetch wallet groups
      createWalletGroupTables().then(success => {
        if (success) {
          fetchWalletGroups();
        } else {
          console.log('Could not set up wallet group tables, continuing without wallet groups');
          setWalletGroups([]);
        }
      });
    }
  }, [user, authLoading, router]);

  // Fetch wallets from Supabase
  const fetchWallets = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Log wallet count for debugging
      console.log(`Fetched ${data?.length || 0} wallets for user ${user?.id}`);
      
      setWallets(data || []);
    } catch (error: any) {
      console.error('Error fetching wallets:', error);
      toast.error(`Failed to load wallets: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch wallet groups from Supabase
  const fetchWalletGroups = async () => {
    try {
      setIsLoading(true);
      
      // Skip checking if table exists and just try to fetch directly
      // If the table doesn't exist, the error will be caught
      const { data: groups, error: groupsError } = await supabase
        .from('wallet_groups')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (groupsError) {
        // If table doesn't exist or no permissions, just set empty array
        if (groupsError.code === '42P01') {
          console.log('wallet_groups table does not exist yet');
          setWalletGroups([]);
          setIsLoading(false);
          return;
        }
        
        console.error('Error fetching wallet groups:', groupsError);
        setWalletGroups([]);
        setIsLoading(false);
        return;
      }

      // For each group, get its members
      if (!groups || groups.length === 0) {
        setWalletGroups([]);
        setIsLoading(false);
        return;
      }

      const groupsWithWallets = await Promise.all(groups.map(async (group) => {
        try {
          const { data: members, error: membersError } = await supabase
            .from('wallet_group_members')
            .select(`
              wallet_id,
              user_wallets (
                id,
                address,
                name,
                last_connected
              )
            `)
            .eq('group_id', group.id);

          if (membersError) {
            // If members table doesn't exist, return group with empty wallets
            if (membersError.code === '42P01') {
              console.log('wallet_group_members table does not exist yet');
              return {
                ...group,
                wallets: []
              };
            }
            
            console.error('Error fetching wallet group members:', membersError);
            return {
              ...group,
              wallets: []
            };
          }

          return {
            ...group,
            wallets: members?.map(m => m.user_wallets) || []
          };
        } catch (err) {
          console.error('Error processing group:', err);
          return {
            ...group,
            wallets: []
          };
        }
      }));

      setWalletGroups(groupsWithWallets);
    } catch (error: any) {
      console.error('Error fetching wallet groups:', error);
      // Don't show error toast as it's confusing to users
      setWalletGroups([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Add or update a wallet
  const handleWalletSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Validate the Ethereum address
      if (!walletForm.address.match(/^0x[a-fA-F0-9]{40}$/)) {
        toast.error('Please enter a valid Ethereum address');
        return;
      }

      // Normalize the address to lowercase
      const normalizedAddress = walletForm.address.toLowerCase();

      if (editingWalletId) {
        // Update existing wallet
        console.log('Updating wallet:', editingWalletId);
        const { error } = await supabase
          .from('user_wallets')
          .update({ 
            name: walletForm.name || null,
            address: normalizedAddress
          })
          .eq('id', editingWalletId);

        if (error) throw error;
        toast.success('Wallet updated successfully');
      } else {
        // Check if wallet with this address already exists
        console.log('Checking for existing wallet with address:', normalizedAddress);
        const { data: existingWallet, error: checkError } = await supabase
          .from('user_wallets')
          .select('id')
          .eq('user_id', user?.id)
          .eq('address', normalizedAddress)
          .single();
          
        if (checkError && checkError.code !== 'PGRST116') {
          // Real error, not just "no rows returned"
          console.error('Error checking for existing wallet:', checkError);
          throw checkError;
        }
        
        if (existingWallet) {
          console.log('Wallet already exists:', existingWallet.id);
          toast.error('A wallet with this address already exists');
          return;
        }
          
        // Add new wallet (insert instead of upsert)
        console.log('Adding new wallet for user:', user?.id);
        const { data, error } = await supabase
          .from('user_wallets')
          .insert({
            user_id: user?.id,
            address: normalizedAddress,
            name: walletForm.name || null,
            last_connected: new Date().toISOString()
          })
          .select();

        if (error) {
          console.error('Error inserting wallet:', error);
          throw error;
        }
        
        console.log('Wallet added successfully:', data?.[0]?.id);
        toast.success('Wallet added successfully');
      }

      // Reset form and close modal
      setWalletForm({ name: '', address: '' });
      setEditingWalletId(null);
      setIsWalletModalOpen(false);
      fetchWallets();
    } catch (error: any) {
      console.error('Error saving wallet:', error);
      toast.error(`Failed to save wallet: ${error.message}`);
    }
  };

  // Add or update a wallet group
  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (groupForm.selectedWallets.length === 0) {
      toast.error('Please select at least one wallet for the group');
      return;
    }

    try {
      // Skip checking if the table exists since we've already initialized it
      // Just proceed with creating/updating the group directly
      let groupId = editingGroupId;

      if (editingGroupId) {
        // Update existing group
        console.log('Updating wallet group:', editingGroupId);
        const { error } = await supabase
          .from('wallet_groups')
          .update({ name: groupForm.name })
          .eq('id', editingGroupId);

        if (error) {
          console.error('Error updating wallet group:', error);
          
          // Check if the error is because the table doesn't exist
          if (error.code === '42P01') {
            toast.error('Wallet groups table does not exist. Try initializing the feature first.');
            return;
          }
          
          throw new Error(error.message || 'Failed to update wallet group');
        }
      } else {
        // Create new group
        console.log('Creating new wallet group:', { 
          user_id: user?.id, 
          name: groupForm.name 
        });
        
        const { data, error } = await supabase
          .from('wallet_groups')
          .insert({
            user_id: user?.id,
            name: groupForm.name
          })
          .select('id')
          .single();

        if (error) {
          console.error('Error creating wallet group:', error);
          
          // Check if the error is because the table doesn't exist
          if (error.code === '42P01') {
            toast.error('Wallet groups table does not exist. Try initializing the feature first.');
            return;
          }
          
          throw new Error(error.message || 'Failed to create wallet group');
        }
        
        if (!data || !data.id) {
          throw new Error('Failed to get ID of the newly created wallet group');
        }
        
        groupId = data.id;
        console.log('New wallet group created with ID:', groupId);
      }

      // If editing, remove all existing members first
      if (editingGroupId) {
        const { error } = await supabase
          .from('wallet_group_members')
          .delete()
          .eq('group_id', editingGroupId);

        if (error) {
          console.error('Error deleting existing group members:', error);
          throw new Error(error.message || 'Failed to update group members');
        }
      }

      // Add all selected wallets as members
      const members = groupForm.selectedWallets.map(walletId => ({
        group_id: groupId,
        wallet_id: walletId
      }));

      console.log('Adding wallet group members:', members);
      
      const { error } = await supabase
        .from('wallet_group_members')
        .insert(members);

      if (error) {
        console.error('Error adding wallet group members:', error);
        throw new Error(error.message || 'Failed to add wallets to group');
      }

      toast.success(`Wallet group ${editingGroupId ? 'updated' : 'created'} successfully`);

      // Reset form and close modal
      setGroupForm({ name: '', selectedWallets: [] });
      setEditingGroupId(null);
      setIsGroupModalOpen(false);
      fetchWalletGroups();
    } catch (error: any) {
      console.error('Error saving wallet group:', error);
      toast.error(`Failed to save wallet group: ${error.message || 'Unknown error occurred'}`);
    }
  };

  // Delete a wallet
  const handleDeleteWallet = async (id: string) => {
    if (confirm('Are you sure you want to delete this wallet?')) {
      try {
        const { error } = await supabase
          .from('user_wallets')
          .delete()
          .eq('id', id);

        if (error) throw error;
        toast.success('Wallet deleted successfully');
        fetchWallets();
        fetchWalletGroups(); // Refresh groups as well since they might contain this wallet
      } catch (error: any) {
        console.error('Error deleting wallet:', error);
        toast.error(`Failed to delete wallet: ${error.message}`);
      }
    }
  };

  // Delete a wallet group
  const handleDeleteGroup = async (id: string) => {
    if (confirm('Are you sure you want to delete this wallet group?')) {
      try {
        // First delete all members (cascade should handle this but just to be safe)
        const { error: membersError } = await supabase
          .from('wallet_group_members')
          .delete()
          .eq('group_id', id);

        if (membersError) throw membersError;

        // Then delete the group
        const { error } = await supabase
          .from('wallet_groups')
          .delete()
          .eq('id', id);

        if (error) throw error;
        toast.success('Wallet group deleted successfully');
        fetchWalletGroups();
      } catch (error: any) {
        console.error('Error deleting wallet group:', error);
        toast.error(`Failed to delete wallet group: ${error.message}`);
      }
    }
  };

  // Edit a wallet (open modal with wallet data)
  const handleEditWallet = (wallet: Wallet) => {
    setWalletForm({
      name: wallet.name || '',
      address: wallet.address
    });
    setEditingWalletId(wallet.id);
    setIsWalletModalOpen(true);
  };

  // Edit a wallet group (open modal with group data)
  const handleEditGroup = (group: WalletGroup) => {
    setGroupForm({
      name: group.name,
      selectedWallets: group.wallets?.map(w => w.id) || []
    });
    setEditingGroupId(group.id);
    setIsGroupModalOpen(true);
  };

  // Connect current wallet
  const handleConnectWallet = async () => {
    try {
      if (!account) {
        await connectWallet();
      } else {
        setWalletForm({ ...walletForm, address: account });
      }
    } catch (error: any) {
      console.error('Error connecting wallet:', error);
      toast.error(`Failed to connect wallet: ${error.message}`);
    }
  };

  // Format wallet address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Wallet groups section in the UI
  const renderWalletGroups = () => {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-700">Wallet Groups</h2>
          <button
            onClick={() => {
              setGroupForm({ name: '', selectedWallets: [] });
              setEditingGroupId(null);
              setIsGroupModalOpen(true);
            }}
            disabled={wallets.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition duration-200 disabled:opacity-50"
          >
            Create Group
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-8">Loading wallet groups...</div>
        ) : walletGroups.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-md p-8 text-center">
            <p className="text-gray-600 mb-4">You haven't created any wallet groups yet.</p>
            <button
              onClick={() => {
                setGroupForm({ name: '', selectedWallets: [] });
                setIsGroupModalOpen(true);
              }}
              disabled={wallets.length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition duration-200 disabled:opacity-50"
            >
              Create Your First Group
            </button>
            {wallets.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">You need to add wallets before creating groups.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {walletGroups.map((group) => (
              <div key={group.id} className="bg-white border border-gray-200 rounded-md overflow-hidden">
                <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
                  <h3 className="text-lg font-medium text-gray-900">{group.name}</h3>
                  <div>
                    <button
                      onClick={() => handleEditGroup(group)}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="px-6 py-4">
                  <div className="flex flex-wrap gap-2">
                    {group.wallets?.map((wallet) => (
                      <div key={wallet.id} className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm">
                        {wallet.name ? `${wallet.name} (${formatAddress(wallet.address)})` : formatAddress(wallet.address)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Add this function to create the necessary tables if they don't exist
  const createWalletGroupTables = async () => {
    try {
      console.log('Creating wallet group tables...');
      
      // Try to create wallet_groups table first by attempting an operation
      const createGroupsTable = async () => {
        console.log('Attempting to create wallet_groups table...');
        
        try {
          // First check if wallet_groups exists using a special query
          const { data: groupsExist, error: groupsCheckError } = await supabase
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_schema', 'public')
            .eq('table_name', 'wallet_groups')
            .single();
            
          if (groupsCheckError || !groupsExist) {
            console.log('wallet_groups table does not exist, attempting to create it');
            
            // Try to insert to create the table with minimal fields
            const { error: createError } = await supabase.rpc('create_wallet_groups_table');
            
            if (createError) {
              // If RPC fails, try direct insert to see if table already exists
              console.log('RPC failed, trying direct insert to see if table exists');
              const { error: insertError } = await supabase
                .from('wallet_groups')
                .insert({
                  user_id: user?.id,
                  name: 'Test Group'
                });
                
              if (insertError) {
                if (insertError.code === '42P01') {
                  console.error('Cannot create wallet_groups table, insufficient permissions');
                  return false;
                } else {
                  console.error('Error accessing wallet_groups table:', insertError);
                }
              } else {
                // Table exists and we created a test group
                console.log('Successfully created test group in wallet_groups');
                
                // Delete the test group
                await supabase
                  .from('wallet_groups')
                  .delete()
                  .eq('name', 'Test Group');
              }
            } else {
              console.log('Successfully created wallet_groups table via RPC');
            }
          } else {
            console.log('wallet_groups table already exists');
          }
          
          return true;
        } catch (err) {
          console.error('Error creating wallet_groups table:', err);
          return false;
        }
      };
      
      const createMembersTable = async () => {
        console.log('Attempting to create wallet_group_members table...');
        
        try {
          // First check if wallet_group_members exists
          const { data: membersExist, error: membersCheckError } = await supabase
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_schema', 'public')
            .eq('table_name', 'wallet_group_members')
            .single();
            
          if (membersCheckError || !membersExist) {
            console.log('wallet_group_members table does not exist, attempting to create it');
            
            // Try to create via RPC
            const { error: createError } = await supabase.rpc('create_wallet_group_members_table');
            
            if (createError) {
              // Try to see if table exists with a select
              console.log('RPC failed, trying direct select to see if table exists');
              const { error: selectError } = await supabase
                .from('wallet_group_members')
                .select('id')
                .limit(1);
                
              if (selectError && selectError.code === '42P01') {
                console.error('Cannot create wallet_group_members table, insufficient permissions');
                return false;
              }
            } else {
              console.log('Successfully created wallet_group_members table via RPC');
            }
          } else {
            console.log('wallet_group_members table already exists');
          }
          
          return true;
        } catch (err) {
          console.error('Error creating wallet_group_members table:', err);
          return false;
        }
      };
      
      // Try to create both tables
      const groupsSuccess = await createGroupsTable();
      if (!groupsSuccess) {
        return false;
      }
      
      const membersSuccess = await createMembersTable();
      if (!membersSuccess) {
      }
      
      // Fetch wallet groups after setup
      fetchWalletGroups();
      
      return true;
    } catch (error) {
      console.error('Error setting up wallet group tables:', error);
      return false;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Wallet Management</h1>
          <p className="text-gray-600">Manage your wallet addresses and organize them into groups for easier transfers.</p>
        </div>

        {/* Tabs Navigation */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <Link
                href="/dashboard"
                className="py-4 px-1 text-gray-500 hover:text-gray-700 text-sm font-medium"
              >
                Dashboard
              </Link>
              <Link
                href="/wallets"
                className="border-b-2 border-blue-500 py-4 px-1 text-blue-600 text-sm font-medium"
                aria-current="page"
              >
                Wallets
              </Link>
              <Link
                href="/transactions"
                className="py-4 px-1 text-gray-500 hover:text-gray-700 text-sm font-medium"
              >
                Transactions
              </Link>
            </nav>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Panel - Wallets */}
          <div className="lg:col-span-2">
            <div className="bg-white shadow-sm rounded-lg overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-700">My Wallets</h2>
                <button
                  onClick={() => {
                    setWalletForm({ name: '', address: account || '' });
                    setEditingWalletId(null);
                    setIsWalletModalOpen(true);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition duration-200"
                >
                  Add Wallet
                </button>
              </div>

              {isLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                  <p className="mt-2 text-gray-600">Loading wallets...</p>
                </div>
              ) : wallets.length === 0 ? (
                <div className="bg-gray-50 p-8 text-center">
                  <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <p className="text-gray-600 mb-4">You haven't added any wallets yet.</p>
                  <button
                    onClick={() => {
                      setWalletForm({ name: '', address: account || '' });
                      setIsWalletModalOpen(true);
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition duration-200"
                  >
                    Add Your First Wallet
                  </button>
                </div>
              ) : (
                <div>
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Name
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Address
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Last Connected
                        </th>
                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {wallets.map((wallet) => (
                        <tr key={wallet.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {wallet.name || 'Unnamed Wallet'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500 font-mono">
                              {formatAddress(wallet.address)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {new Date(wallet.last_connected).toLocaleString()}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                            <button
                              onClick={() => handleEditWallet(wallet)}
                              className="text-blue-600 hover:text-blue-800 mr-4"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteWallet(wallet.id)}
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
          </div>

          {/* Right Panel - Wallet Groups */}
          <div className="lg:col-span-1">
            <div className="bg-white shadow-sm rounded-lg overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-700">Wallet Groups</h2>
                <button
                  onClick={() => {
                    setGroupForm({ name: '', selectedWallets: [] });
                    setEditingGroupId(null);
                    setIsGroupModalOpen(true);
                  }}
                  disabled={wallets.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition duration-200 disabled:opacity-50"
                >
                  Create Group
                </button>
              </div>

              {isLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                  <p className="mt-2 text-gray-600">Loading wallet groups...</p>
                </div>
              ) : walletGroups.length === 0 ? (
                <div className="bg-gray-50 p-8 text-center">
                  <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-600 mb-4">You haven't created any wallet groups yet.</p>
                  <button
                    onClick={() => {
                      setGroupForm({ name: '', selectedWallets: [] });
                      setIsGroupModalOpen(true);
                    }}
                    disabled={wallets.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition duration-200 disabled:opacity-50"
                  >
                    Create Your First Group
                  </button>
                  {wallets.length === 0 && (
                    <p className="text-sm text-gray-500 mt-2">You need to add wallets before creating groups.</p>
                  )}
                </div>
              ) : (
                <div className="p-4 space-y-4">
                  {walletGroups.map((group) => (
                    <div key={group.id} className="bg-white border border-gray-200 rounded-md overflow-hidden shadow-sm">
                      <div className="bg-gray-50 px-4 py-3 flex justify-between items-center">
                        <h3 className="text-md font-medium text-gray-900">{group.name}</h3>
                        <div>
                          <button
                            onClick={() => handleEditGroup(group)}
                            className="text-blue-600 hover:text-blue-800 mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteGroup(group.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {group.wallets?.map((wallet) => (
                            <div key={wallet.id} className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs">
                              {wallet.name ? `${wallet.name} (${formatAddress(wallet.address)})` : formatAddress(wallet.address)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Quick Help Card */}
            <div className="bg-white shadow-sm rounded-lg p-6 mt-4">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Using Wallet Groups</h3>
              <p className="text-gray-600 mb-4">
                Wallet groups make it easy to send to multiple wallets at once. Create groups of commonly used wallets for efficient transfers.
              </p>
              <Link href="/dashboard" className="text-blue-600 hover:text-blue-800 font-medium">
                Go to Transfer Page →
              </Link>
            </div>
          </div>
        </div>

        {/* Add/Edit Wallet Modal */}
        {isWalletModalOpen && (
          <div className="fixed inset-0 overflow-y-auto z-50">
            <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center">
              <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={() => setIsWalletModalOpen(false)}></div>
              <div className="relative inline-block bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all max-w-lg w-full">
                <div className="px-6 py-5 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">
                    {editingWalletId ? 'Edit Wallet' : 'Add Wallet'}
                  </h3>
                </div>
                <form onSubmit={handleWalletSubmit}>
                  <div className="px-6 py-4">
                    <div className="mb-4">
                      <label htmlFor="wallet-name" className="block text-sm font-medium text-gray-700 mb-1">
                        Wallet Name (Optional)
                      </label>
                      <input
                        id="wallet-name"
                        type="text"
                        value={walletForm.name}
                        onChange={(e) => setWalletForm({ ...walletForm, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="My Main Wallet"
                      />
                    </div>
                    <div className="mb-4">
                      <label htmlFor="wallet-address" className="block text-sm font-medium text-gray-700 mb-1">
                        Wallet Address
                      </label>
                      <div className="flex">
                        <input
                          id="wallet-address"
                          type="text"
                          value={walletForm.address}
                          onChange={(e) => setWalletForm({ ...walletForm, address: e.target.value })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder="0x..."
                        />
                        <button
                          type="button"
                          onClick={handleConnectWallet}
                          className="bg-gray-200 hover:bg-gray-300 px-3 py-2 rounded-r-md"
                        >
                          {account ? 'Use Current' : 'Connect'}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-4 bg-gray-50 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsWalletModalOpen(false)}
                      className="bg-white border border-gray-300 rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 mr-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                    >
                      {editingWalletId ? 'Save Changes' : 'Add Wallet'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Create/Edit Group Modal */}
        {isGroupModalOpen && (
          <div className="fixed inset-0 overflow-y-auto z-50">
            <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center">
              <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={() => setIsGroupModalOpen(false)}></div>
              <div className="relative inline-block bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all max-w-lg w-full">
                <div className="px-6 py-5 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">
                    {editingGroupId ? 'Edit Wallet Group' : 'Create Wallet Group'}
                  </h3>
                </div>
                <form onSubmit={handleGroupSubmit}>
                  <div className="px-6 py-4">
                    <div className="mb-4">
                      <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 mb-1">
                        Group Name
                      </label>
                      <input
                        id="group-name"
                        type="text"
                        value={groupForm.name}
                        onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="My Favorite Wallets"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Select Wallets
                      </label>
                      <div className="border border-gray-300 rounded-md p-2 max-h-60 overflow-y-auto">
                        {wallets.length === 0 ? (
                          <p className="text-sm text-gray-500 p-2">No wallets available. Please add wallets first.</p>
                        ) : (
                          <div className="space-y-2">
                            {wallets.map((wallet) => (
                              <div key={wallet.id} className="flex items-center">
                                <input
                                  type="checkbox"
                                  id={`wallet-${wallet.id}`}
                                  checked={groupForm.selectedWallets.includes(wallet.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setGroupForm({
                                        ...groupForm,
                                        selectedWallets: [...groupForm.selectedWallets, wallet.id]
                                      });
                                    } else {
                                      setGroupForm({
                                        ...groupForm,
                                        selectedWallets: groupForm.selectedWallets.filter(id => id !== wallet.id)
                                      });
                                    }
                                  }}
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                                <label htmlFor={`wallet-${wallet.id}`} className="ml-2 block text-sm text-gray-900">
                                  {wallet.name || 'Unnamed Wallet'} ({formatAddress(wallet.address)})
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">Selected: {groupForm.selectedWallets.length} wallets</p>
                    </div>
                  </div>
                  <div className="px-6 py-4 bg-gray-50 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsGroupModalOpen(false)}
                      className="bg-white border border-gray-300 rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 mr-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!groupForm.name || groupForm.selectedWallets.length === 0}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                    >
                      {editingGroupId ? 'Save Changes' : 'Create Group'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Simple footer with copyright */}
      <footer className="bg-gray-800 text-white py-6 px-6 mt-12">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-gray-400">© {new Date().getFullYear()} Sybil Transfer. All rights reserved.</p>
          <p className="text-gray-500 text-sm mt-2">Created by Satwik Samanta</p>
        </div>
      </footer>
    </div>
  );
};

export default WalletsPage; 