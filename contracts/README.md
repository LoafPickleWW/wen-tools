# Agent Marketplace — Smart Contracts

TEALScript smart contracts for the on-chain agent registry.

## Prerequisites

Node.js v18+ and `npm`.

## Build

```bash
npx tealscript contracts/AgentContracts.algo.ts contracts/build/ --skip-algod
```

This outputs compiled TEAL and ABI specifications (ARC4/ARC32/ARC56) to `contracts/build/`.

## Deploy

Ensure you have a funded wallet phrase set in `contracts/.env` under `DEPLOYER_MNEMONIC`.

```bash
npx tsx --env-file=contracts/.env contracts/deploy.ts
```

This will automatically deploy the factory contract to both Testnet and Mainnet and update the root `.env` file with the newly registered Application IDs.

## Architecture

```
Factory Contract (deployed once)
├── Box: wallet_A → child_app_123
├── Box: wallet_B → child_app_456
└── Box: wallet_C → child_app_789

Child Contract #123 (wallet_A's agent)
├── name: "My AI Agent"
├── description: "..."
├── endpoint_url: "https://..."
├── price_algo: 10000 (microAlgos)
├── category: "ai-agent"
├── wallet_address: "wallet_A"
└── active: 1

...
```

## Security

The `AgentFactory` enforces that any wallet registering an agent must attach a PayTxn covering the Minimum Balance Requirement (MBR) for the Box + Child App global state (425,500 microAlgos total). Deleting the listing issues an inner transaction to delete the child app, and refunds the MBR to the wallet.
