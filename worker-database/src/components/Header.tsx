"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useWeb3 } from '@/context/Web3Context';
import WalletConnect from './WalletConnect';
import { useRouter } from 'next/navigation';

const Header = () => {
  const { user, signOut } = useAuth();
  const { isOwner, selectedNetwork, account, networkType, disconnectWallet } = useWeb3();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      disconnectWallet();
      await signOut();
      router.push('/');
      console.log("Logout completed");
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <header className="bg-gradient-to-r from-blue-600 to-blue-800 shadow-lg text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center">
            <Link href={user ? "/dashboard" : "/"} className="flex items-center">
              <span className="text-xl font-bold text-white">Sybil</span>
              <span className="text-xl font-semibold ml-1 text-blue-100">Transfer</span>
            </Link>
          </div>
          
          <div className="flex items-center">
            {/* Network indicator for connected users */}
            {account && selectedNetwork && (
              <div className="hidden md:flex items-center mr-4 bg-blue-700 rounded-full px-3 py-1">
                <div className={`w-2 h-2 rounded-full mr-2 ${networkType === 'mainnet' ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                <span className="text-sm font-medium text-white">
                  {selectedNetwork.name}
                </span>
              </div>
            )}
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex space-x-6 mr-6">
              {user ? (
                <>
                  <Link 
                    href="/dashboard" 
                    className="text-blue-100 hover:text-white transition-colors font-medium"
                  >
                    Dashboard
                  </Link>
                  <Link 
                    href="/wallets" 
                    className="text-blue-100 hover:text-white transition-colors font-medium"
                  >
                    Wallets
                  </Link>
                  <Link 
                    href="/transactions" 
                    className="text-blue-100 hover:text-white transition-colors font-medium"
                  >
                    History
                  </Link>
                  <Link 
                    href="/contracts" 
                    className="text-blue-100 hover:text-white transition-colors font-medium"
                  >
                    Contracts
                  </Link>
                 
                    <Link 
                      href="/admin" 
                      className="text-blue-100 hover:text-white transition-colors font-medium"
                    >
                      Admin
                    </Link>
                
                </>
              ) : null}
            </nav> 
            
            {/* Desktop Auth Buttons */}
            <div className="hidden md:flex items-center space-x-4">
              {user ? (
                <>
                  <div className="ml-4">
                    <WalletConnect />
                  </div>
                  <button 
                    onClick={handleSignOut}
                    className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600 transition-colors"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <div className="flex space-x-2">
                  <Link 
                    href="/sign-in" 
                    className="px-4 py-2 border border-blue-300 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Sign In
                  </Link>
                  <Link 
                    href="/sign-up" 
                    className="px-4 py-2 bg-white text-blue-600 rounded hover:bg-blue-50 transition-colors"
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button
              type="button"
              className="inline-flex md:hidden items-center justify-center p-2 rounded-md text-white hover:text-blue-200 focus:outline-none"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <span className="sr-only">Open main menu</span>
              {!mobileMenuOpen ? (
                <svg 
                  className="block h-6 w-6" 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor" 
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              ) : (
                <svg 
                  className="block h-6 w-6" 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor" 
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu, show/hide based on menu state */}
      {mobileMenuOpen && (
        <div className="md:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 bg-blue-700">
            {user ? (
              <>
                <Link 
                  href="/dashboard" 
                  className="block px-3 py-2 rounded-md text-base font-medium text-white hover:bg-blue-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <Link 
                  href="/wallets" 
                  className="block px-3 py-2 rounded-md text-base font-medium text-white hover:bg-blue-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Wallets
                </Link>
                <Link 
                  href="/transactions" 
                  className="block px-3 py-2 rounded-md text-base font-medium text-white hover:bg-blue-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  History
                </Link>
                <Link 
                  href="/contracts" 
                  className="block px-3 py-2 rounded-md text-base font-medium text-white hover:bg-blue-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Contracts
                </Link>
               
                  <Link 
                    href="/admin" 
                    className="block px-3 py-2 rounded-md text-base font-medium text-white hover:bg-blue-600"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Admin
                  </Link>
              
                <div className="flex flex-col pt-4 pb-3 border-t border-blue-600">
                  <div className="flex items-center px-3">
                    {account && selectedNetwork && (
                      <div className="flex items-center mr-4 bg-blue-800 rounded-full px-3 py-1 mb-2">
                        <div className={`w-2 h-2 rounded-full mr-2 ${networkType === 'mainnet' ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                        <span className="text-sm font-medium text-white">
                          {selectedNetwork.name}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 px-3 space-y-1">
                    <div className="mb-2">
                      <WalletConnect />
                    </div>
                    <button 
                      onClick={() => {
                        handleSignOut();
                        setMobileMenuOpen(false);
                      }}
                      className="w-full text-left block px-3 py-2 rounded-md text-base font-medium text-white bg-red-500 hover:bg-red-600"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col pt-4 pb-3 border-t border-blue-600">
                  <div className="mt-3 px-2 space-y-1">
                    <Link 
                      href="/sign-in" 
                      className="block px-3 py-2 rounded-md text-base font-medium text-white bg-blue-600 hover:bg-blue-700 mb-2"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Sign In
                    </Link>
                    <Link 
                      href="/sign-up" 
                      className="block px-3 py-2 rounded-md text-base font-medium text-blue-600 bg-white hover:bg-blue-50"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Sign Up
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Header; 