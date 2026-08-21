"use client";

import React from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Render homepage for all users (both logged in and not logged in)
  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <Header />

      {/* Hero Section */}
      <section className="py-16 md:py-24 lg:py-32 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 sm:mb-8">
              Multi-Chain Transfer <span className="text-blue-600">Simplified</span>
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto mb-10 sm:mb-12 px-2">
              Deploy and manage smart contracts across multiple blockchain networks with ease.
              <br className="hidden md:block" />
              <span className="font-medium">Secure, efficient, and user-friendly.</span>
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
              {!user ? (
                <>
                  <Link 
                    href="/sign-up" 
                    className="w-full sm:w-auto px-8 sm:px-10 py-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-lg sm:text-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                  >
                    Get Started Free
                  </Link>
                </>
              ) : (
                <Link 
                  href="/dashboard" 
                  className="w-full sm:w-auto px-8 sm:px-10 py-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-lg sm:text-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                >
                  Go to Dashboard
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section className="py-16 md:py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-12 sm:mb-16">Key Features</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-8 sm:gap-10">
            <div className="bg-white p-8 rounded-xl shadow-md hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl sm:text-2xl font-semibold mb-4">Multi-Network Support</h3>
              <p className="text-gray-600">Deploy and manage contracts across multiple blockchain networks from a single dashboard.</p>
            </div>

            <div className="bg-white p-8 rounded-xl shadow-md hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl sm:text-2xl font-semibold mb-4">Enhanced Security</h3>
              <p className="text-gray-600">Whitelist functionality, ownership management, and secure transaction processing.</p>
            </div>

            <div className="bg-white p-8 rounded-xl shadow-md hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="text-xl sm:text-2xl font-semibold mb-4">Batch Transfers</h3>
              <p className="text-gray-600">Send funds to multiple recipients in a single transaction, saving time and gas fees.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gradient-to-r from-blue-800 to-blue-900 text-white py-10 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-blue-200">© {new Date().getFullYear()} Sybil Transfer. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
