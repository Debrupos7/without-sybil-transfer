import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabaseClient';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NetworkInfo } from '@/types/NetworkTypes';

// Default networks configuration
const defaultNetworks: {
  mainnet: Record<string, NetworkInfo>;
  testnet: Record<string, NetworkInfo>;
} = {
  mainnet: {
    ethereum: {
      id: 'ethereum',
      name: 'Ethereum Mainnet',
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
      currencySymbol: 'ETH',
      explorerUrl: 'https://etherscan.io',
      isTestnet: false
    },
    polygon: {
      id: 'polygon',
      name: 'Polygon',
      chainId: 137,
      rpcUrl: 'https://polygon-rpc.com',
      currencySymbol: 'MATIC',
      explorerUrl: 'https://polygonscan.com',
      isTestnet: false
    },
    bsc: {
      id: 'bsc',
      name: 'BNB Smart Chain',
      chainId: 56,
      rpcUrl: 'https://bsc-dataseed.binance.org',
      currencySymbol: 'BNB',
      explorerUrl: 'https://bscscan.com',
      isTestnet: false
    }
  },
  testnet: {
    goerli: {
      id: 'goerli',
      name: 'Goerli Testnet',
      chainId: 5,
      rpcUrl: 'https://eth-goerli.public.blastapi.io',
      currencySymbol: 'ETH',
      explorerUrl: 'https://goerli.etherscan.io',
      isTestnet: true
    },
    sepolia: {
      id: 'sepolia',
      name: 'Sepolia Testnet',
      chainId: 11155111,
      rpcUrl: 'https://rpc.sepolia.org',
      currencySymbol: 'ETH',
      explorerUrl: 'https://sepolia.etherscan.io',
      isTestnet: true
    },
    mumbai: {
      id: 'mumbai',
      name: 'Polygon Mumbai',
      chainId: 80001,
      rpcUrl: 'https://rpc-mumbai.maticvigil.com',
      currencySymbol: 'MATIC',
      explorerUrl: 'https://mumbai.polygonscan.com',
      isTestnet: true
    }
  }
};

export async function GET(req: NextRequest) {
  try {
    // Create a Supabase client for the server
    const cookieStore = cookies();
    const serverSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      }
    );

    // Get the current session
    const { data: { session } } = await serverSupabase.auth.getSession();
    
    // Get default networks (these are available to all users)
    const { data: defaultNetworksData, error: defaultError } = await supabase
      .from('default_networks')
      .select('*');
      
    if (defaultError) {
      console.error('Error fetching default networks:', defaultError);
      return NextResponse.json({ error: 'Failed to fetch networks' }, { status: 500 });
    }
    
    // Organize default networks by type (mainnet/testnet)
    const organizedNetworks: {
      mainnet: Record<string, NetworkInfo>;
      testnet: Record<string, NetworkInfo>;
    } = {
      mainnet: {},
      testnet: {}
    };
    
    defaultNetworksData.forEach((network: any) => {
      const networkInfo: NetworkInfo = {
        id: network.id,
        name: network.name,
        chainId: network.chain_id,
        rpcUrl: network.rpc_url,
        currencySymbol: network.currency_symbol,
        explorerUrl: network.explorer_url,
        isTestnet: network.is_testnet
      };
      
      const key = network.name.toLowerCase().replace(/\s+/g, '_');
      
      if (network.is_testnet) {
        organizedNetworks.testnet[key] = networkInfo;
      } else {
        organizedNetworks.mainnet[key] = networkInfo;
      }
    });
    
    // If user is authenticated, also fetch their custom networks
    if (session) {
      const { data: userNetworks, error: userError } = await supabase
        .from('user_networks')
        .select('*')
        .eq('user_id', session.user.id);
        
      if (userError) {
        console.error('Error fetching user networks:', userError);
      } else if (userNetworks && userNetworks.length > 0) {
        // Add user networks to the organized networks
        userNetworks.forEach((network: any) => {
          const networkInfo: NetworkInfo = {
            id: network.id,
            name: network.name,
            chainId: network.chain_id,
            rpcUrl: network.rpc_url,
            currencySymbol: network.currency_symbol,
            explorerUrl: network.explorer_url,
            isTestnet: network.is_testnet
          };
          
          const key = `user_${network.id}`;
          
          if (network.is_testnet) {
            organizedNetworks.testnet[key] = networkInfo;
          } else {
            organizedNetworks.mainnet[key] = networkInfo;
          }
        });
      }
    }
    
    return NextResponse.json(organizedNetworks);
  } catch (error) {
    console.error('Server error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 