/** Shared types for the Agent Marketplace */

export interface AgentListing {
  /** On-chain child application ID */
  appId: number;
  /** Human-readable agent name */
  name: string;
  /** Description of what the agent does */
  description: string;
  /** The agent's callable endpoint URL */
  endpointUrl: string;
  /** Price per call in ALGO (human-readable, not microAlgos) */
  pricePerCallAlgo: number;
  /** Free-text category */
  category: string;
  /** Owner wallet address */
  walletAddress: string;
  /** Whether the listing is active */
  active: boolean;
  /** Whether the endpoint advertises x402 compatibility */
  x402Compatible: boolean;
  /** Optional on-chain info URL */
  infoUrl?: string;
}

export interface CreateListingParams {
  name: string;
  description: string;
  endpointUrl: string;
  /** Price in ALGO (will be converted to microAlgos for on-chain storage) */
  priceAlgo: number;
  category: string;
  /** Optional on-chain info URL */
  infoUrl?: string;
}
