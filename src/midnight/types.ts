/**
 * Minimal DApp Connector API v4 types (CAIP-372), mirrored from
 * @midnight-ntwrk/dapp-connector-api so the site doesn't pull the package in
 * just for types. Only the methods this site calls are listed.
 */
export type TokenType = string;

export type MidnightKind = "shielded" | "unshielded";

export interface DesiredOutput {
  kind: MidnightKind;
  type: TokenType;
  value: bigint;
  recipient: string;
}

export type ConnectionStatus =
  | { status: "connected"; networkId: string }
  | { status: "disconnected" };

export interface MidnightConfiguration {
  indexerUri: string;
  indexerWsUri: string;
  substrateNodeUri: string;
  networkId: string;
}

export interface MidnightConnectedAPI {
  getShieldedBalances(): Promise<Record<TokenType, bigint>>;
  getUnshieldedBalances(): Promise<Record<TokenType, bigint>>;
  getDustBalance(): Promise<{ cap: bigint; balance: bigint }>;
  getShieldedAddresses(): Promise<{ shieldedAddress: string }>;
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  makeTransfer(
    desiredOutputs: DesiredOutput[],
    options?: { payFees?: boolean },
  ): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<void>;
  getConfiguration(): Promise<MidnightConfiguration>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  hintUsage?(methodNames: string[]): Promise<void>;
}

export interface MidnightInitialAPI {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  connect(networkId: string): Promise<MidnightConnectedAPI>;
}

/** A wallet found under window.midnight, plus the key it was injected with. */
export interface MidnightWalletInfo {
  key: string;
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  /** Only connector v4 is supported */
  compatible: boolean;
  initial: MidnightInitialAPI;
}

export const MIDNIGHT_NETWORKS = [
  { id: "mainnet", label: "Mainnet", short: "Main" },
  { id: "preview", label: "Preview", short: "Prev" },
  { id: "preprod", label: "Preprod", short: "Pre" },
] as const;

/** NIGHT, the native unshielded token, is the all-zero token type. */
export const NIGHT_TOKEN_TYPE = "0".repeat(64);
export const NIGHT_DECIMALS = 6;
