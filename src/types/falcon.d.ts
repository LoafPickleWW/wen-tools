declare module "falcon-signatures" {
  export default class Falcon {
    constructor();
    keypair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }>;
    static bytesToHex(bytes: Uint8Array): string;
    static hexToBytes(hex: string): Uint8Array;
  }
}

declare module "falcon-algo-sdk" {
  export interface NetworkConfig {
    algodUrl: string;
    algodPort: string;
    algodToken: string;
    indexerUrl: string;
    indexerPort: string;
    indexerToken: string;
  }

  export const Networks: {
    MAINNET: NetworkConfig;
    TESTNET: NetworkConfig;
    BETANET: NetworkConfig;
  };

  export default class FalconAlgoSDK {
    constructor(network: NetworkConfig);
    createFalconAccount(): Promise<any>;
    createPayment(params: any, accountInfo: any): Promise<{ blob: Uint8Array }>;
  }
}
