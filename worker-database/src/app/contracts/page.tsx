"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import Header from '@/components/Header';

const ContractsPage = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const [mainContractCode, setMainContractCode] = useState<string>('');
  const [childContractCode, setChildContractCode] = useState<string>('');

  useEffect(() => {
    // Fetch contract code on component mount
    const fetchContracts = async () => {
      try {
        console.log('Fetching MainContract.sol...');
        // Fetch MainContract.sol
        const mainRes = await fetch('/api/contracts/MainContract');
        if (!mainRes.ok) {
          console.error('MainContract fetch failed:', mainRes.status, mainRes.statusText);
          toast.error(`Failed to load MainContract: ${mainRes.statusText}`);
          return;
        }
        const mainData = await mainRes.text();
        console.log('MainContract loaded, length:', mainData.length);
        setMainContractCode(mainData);

        console.log('Fetching ChildContract.sol...');
        // Fetch ChildContract.sol
        const childRes = await fetch('/api/contracts/ChildContract');
        if (!childRes.ok) {
          console.error('ChildContract fetch failed:', childRes.status, childRes.statusText);
          toast.error(`Failed to load ChildContract: ${childRes.statusText}`);
          return;
        }
        const childData = await childRes.text();
        console.log('ChildContract loaded, length:', childData.length);
        setChildContractCode(childData);
      } catch (error) {
        console.error('Error fetching contract code:', error);
        toast.error('Failed to load contract files');
      }
    };
    
    fetchContracts();
  }, []);

  // Copy function
  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    toast.success(`${type} copied to clipboard!`);
    setTimeout(() => setCopied(null), 2000);
  };

  // Download function
  const downloadFile = (content: string, filename: string) => {
    const element = document.createElement('a');
    const file = new Blob([content], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success(`${filename} downloaded successfully!`);
  };

  // Open in Remix function
  const openInRemix = (content: string) => {
    const encodedContent = encodeURIComponent(content);
    const remixUrl = `https://remix.ethereum.org/?#code=${encodedContent}`;
    window.open(remixUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          <div className="p-4 sm:p-6 bg-gradient-to-r from-blue-600 to-blue-800 text-white">
            <h1 className="text-2xl sm:text-3xl font-bold">Contract Source Code</h1>
            <p className="mt-2 text-blue-100 text-sm sm:text-base">
              Deploy these optimized contracts to use with the Sybil Transfer System. 
              These contracts enable secure multi-transfer functionality with gas optimization.
            </p>
          </div>
          
          <div className="p-4 sm:p-6">
            <div className="mb-8 sm:mb-10">
              <h2 className="text-xl font-semibold mb-4">Deployment Instructions</h2>
              <ol className="list-decimal pl-4 sm:pl-6 space-y-3 text-gray-700 text-sm sm:text-base">
                <li>First, download these contract files or copy their content.</li>
                <li>Use the "Open in Remix" button to quickly load the code in Remix IDE.</li>
                <li>In Remix, compile both contracts together with these settings:
                  <ul className="list-disc pl-4 sm:pl-6 mt-2">
                    <li>Compiler version: <span className="font-mono bg-gray-100 px-1 rounded text-xs sm:text-sm">0.8.23</span> or later</li>
                    <li>Enable optimization: <span className="text-green-600 font-semibold">Yes</span></li> 
                    <li>Optimization runs: <span className="font-mono bg-gray-100 px-1 rounded text-xs sm:text-sm">200</span></li>
                  </ul>
                </li>
                <li>Deploy only the MainContract (it references the ChildContract).</li>
                <li>After deployment, copy the MainContract address to use in the Sybil Transfer System.</li>
              </ol>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 sm:mb-10">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
                  <h2 className="text-xl font-semibold">MainContract.sol</h2>
                  <div className="flex flex-wrap gap-2">
                    <button 
                      onClick={() => copyToClipboard(mainContractCode, 'MainContract.sol')}
                      className="px-3 py-1 bg-blue-600 text-white text-xs sm:text-sm rounded hover:bg-blue-700 transition flex items-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>{copied === 'MainContract.sol' ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button 
                      onClick={() => downloadFile(mainContractCode, 'MainContract.sol')}
                      className="px-3 py-1 bg-green-600 text-white text-xs sm:text-sm rounded hover:bg-green-700 transition flex items-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Download</span>
                    </button>
                    <button 
                      onClick={() => openInRemix(mainContractCode)}
                      className="px-3 py-1 bg-purple-600 text-white text-xs sm:text-sm rounded hover:bg-purple-700 transition flex items-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      <span>Open in Remix</span>
                    </button>
                  </div>
                </div>
                
                <div className="bg-gray-900 rounded-lg overflow-hidden h-72 sm:h-96">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
                    <span className="text-gray-200 font-mono text-xs sm:text-sm">MainContract.sol</span>
                    <span className="text-xs text-gray-400 hidden sm:inline">Multi-Transfer Contract</span>
                  </div>
                  {mainContractCode ? (
                    <pre className="p-2 sm:p-4 overflow-y-auto text-xs sm:text-sm text-gray-300 font-mono h-full">
                      {mainContractCode}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
                  <h2 className="text-xl font-semibold">ChildContract.sol</h2>
                  <div className="flex flex-wrap gap-2">
                    <button 
                      onClick={() => copyToClipboard(childContractCode, 'ChildContract.sol')}
                      className="px-3 py-1 bg-blue-600 text-white text-xs sm:text-sm rounded hover:bg-blue-700 transition flex items-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>{copied === 'ChildContract.sol' ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button 
                      onClick={() => downloadFile(childContractCode, 'ChildContract.sol')}
                      className="px-3 py-1 bg-green-600 text-white text-xs sm:text-sm rounded hover:bg-green-700 transition flex items-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Download</span>
                    </button>
                  </div>
                </div>
                
                <div className="bg-gray-900 rounded-lg overflow-hidden h-72 sm:h-96">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
                    <span className="text-gray-200 font-mono text-xs sm:text-sm">ChildContract.sol</span>
                    <span className="text-xs text-gray-400 hidden sm:inline">Self-Destructing Contract</span>
                  </div>
                  {childContractCode ? (
                    <pre className="p-2 sm:p-4 overflow-y-auto text-xs sm:text-sm text-gray-300 font-mono h-full">
                      {childContractCode}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 sm:p-4 mb-6 sm:mb-8 text-sm sm:text-base">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-800">Important Notes</h3>
                  <div className="mt-2 text-xs sm:text-sm text-yellow-700">
                    <p>After deploying the MainContract, you will need to:</p>
                    <ol className="list-decimal pl-4 sm:pl-6 mt-2">
                      <li>Add the contract address to your Sybil account under your networks page</li>
                      <li>Whitelist your address or other addresses that need to use the transfer system</li>
                      <li>Only the contract owner can whitelist addresses</li>
                      <li>The contract uses the efficient "create, transfer, and self-destruct" pattern to optimize gas usage</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link 
                href="/dashboard"
                className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-transparent text-sm sm:text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                Return to Dashboard
              </Link>
              <Link 
                href="https://remix.ethereum.org/" 
                target="_blank"
                className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-gray-300 text-sm sm:text-base font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                Open Remix IDE
              </Link>
            </div>
          </div>
        </div>
      </main>
      
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

export default ContractsPage; 