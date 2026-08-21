import { ethers } from 'ethers';

declare module 'ethers' {
  import { BytesLike } from '@ethersproject/bytes';
  import { Deferrable } from '@ethersproject/properties';
  
  export class BigNumber {
    static from(value: any): BigNumber;
    add(other: BigNumberish): BigNumber;
    sub(other: BigNumberish): BigNumber;
    mul(other: BigNumberish): BigNumber;
    div(other: BigNumberish): BigNumber;
    toString(): string;
    toNumber(): number;
  }
  
  export type BigNumberish = BigNumber | string | number | bigint;
  
  export namespace ethers {
    export const BigNumber: typeof BigNumber;
    
    export namespace utils {
      export function getAddress(address: string): string;
      export function parseEther(value: string): BigNumber;
      export function formatEther(value: BigNumberish): string;
    }
    
    export namespace providers {
      export class Web3Provider {
        constructor(provider: any, network?: any);
        getSigner(): Signer;
        getBalance(addressOrName: string): Promise<BigNumber>;
      }
      
      export class Provider {
        // Base methods
      }
    }
    
    export class Contract {
      constructor(address: string, abi: any, signerOrProvider: Signer | providers.Provider);
      connect(signerOrProvider: Signer | providers.Provider): Contract;
      deployed(): Promise<Contract>;
      
      // Filters and events
      filters: any;
      queryFilter(filter: any, fromBlockOrBlockHash?: any, toBlock?: any): Promise<Array<any>>;
      
      // Properties
      address: string;
      interface: any;
      
      // Dynamic methods from ABI
      [key: string]: any;
      owner(): Promise<string>;
      isWhitelisted(address: string): Promise<boolean>;
      setWhitelistStatus(user: string, status: boolean): Promise<any>;
      transferOwnership(newOwner: string): Promise<any>;
      createMultipleChildContracts(recipients: string[], amounts: BigNumber[], options?: {value: BigNumber}): Promise<any>;
      
      // MainContract methods
      batchWhitelist(users: string[]): Promise<ethers.ContractTransaction>;
      createMultipleChildContracts(
        recipients: string[],
        amounts: ethers.BigNumber[],
        overrides?: { value: ethers.BigNumber }
      ): Promise<ethers.ContractTransaction>;
      
      // Event filters
      filters: {
        WhitelistStatusChanged(user?: string, status?: boolean): ethers.EventFilter;
        OwnershipTransferred(previousOwner?: string, newOwner?: string): ethers.EventFilter;
        ChildContractCreated(childAddress?: string, recipient?: string, amount?: ethers.BigNumber): ethers.EventFilter;
      };
      
      // Query events
      queryFilter(filter: ethers.EventFilter): Promise<Array<ethers.Event>>;
    }
    
    export class ContractFactory {
      constructor(abi: any, bytecode: BytesLike, signer?: Signer);
      deploy(...args: Array<any>): Promise<Contract>;
    }
    
    export class Signer {
      getAddress(): Promise<string>;
      signMessage(message: BytesLike): Promise<string>;
      connect(provider: providers.Provider): Signer;
    }
  }
  
  export default ethers;
} 