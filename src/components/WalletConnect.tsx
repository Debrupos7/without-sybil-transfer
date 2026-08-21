"use client";

import React, { useState } from 'react';
import { useWeb3 } from '@/context/Web3Context';
import { toast } from 'react-toastify';

const WalletConnect = () => {
  const { account, connectWallet, disconnectWallet } = useWeb3();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connectWallet();
      toast.success('Wallet connected successfully!');
    } catch (error: any) {
      toast.error(`Failed to connect wallet: ${error.message || 'Unknown error'}`);
      console.error(error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnectWallet();
    toast.info('Wallet disconnected');
  };

  // Format the address display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="flex items-center">
      {account ? (
        <div className="flex items-center space-x-2">
          <span className="hidden md:inline-block bg-blue-700 text-white px-3 py-1 rounded-full text-sm font-medium">
            {formatAddress(account)}
          </span>
          <button
            onClick={handleDisconnect}
            className="bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 text-sm rounded-md transition duration-200"
            title="Disconnect wallet"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={isConnecting}
          className="bg-blue-500 hover:bg-blue-400 text-white px-4 py-2 text-sm rounded-md transition duration-200 disabled:opacity-50 whitespace-nowrap"
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
    </div>
  );
};

export default WalletConnect; 