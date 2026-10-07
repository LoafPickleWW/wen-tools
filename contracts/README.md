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


---

# Shuffle (wen.tools random-mint sales) — Smart Contracts

`WenPadSale.algo.ts` contains two contracts that let creators run a random-mint sale without
WenPad ever holding a key. The security review is in [WENPAD_SALE_AUDIT.md](WENPAD_SALE_AUDIT.md).

- **`WenPadSaleFactory`**: deployed once per network. It creates every sale app and acts as the
  public index of all WenPad sales.
- **`WenPadSale`**: one per sale, created only by the factory. The creator's **distribution
  wallet** is rekeyed to this app's address, and the app transfers NFTs out of it to buyers.

Frontend: `/wen-pad/sales` (`src/pages/WenPadSales.tsx`). Shared client logic is in
`src/utils/wenpadSaleCore.ts`. Keeper endpoint: `api/wenpad-reveal.ts`.

## Build & deploy

```bash
npx tealscript contracts/WenPadSale.algo.ts contracts/build/ --skip-algod
npx tsx --env-file=contracts/.env contracts/deploy-wenpad-sale.ts            # testnet
npx tsx --env-file=contracts/.env contracts/deploy-wenpad-sale.ts mainnet    # mainnet
```

The deploy script signs with `WENPAD_DEPLOYER_MNEMONIC` from `contracts/.env`, which is separate
from the agent marketplace's `DEPLOYER_MNEMONIC`. Hardcode the printed factory app ID in
`src/utils/wenpadSale.ts` and `api/wenpad-reveal.ts`; the `VITE_`/`WENPAD_` env vars still
override it if set. For the
keeper, set the following in Vercel:
- `KEEPER_MNEMONIC`: a hot wallet funded with a few ALGO for fees. It earns the reveal fees.
- `WENPAD_SALE_FACTORY_APP_ID_MAINNET` and `WENPAD_SALE_FACTORY_APP_ID_TESTNET`.

## Sale lifecycle

**Roles**
- **Distribution (collection) wallet:** the creator's connected wallet. It holds the NFTs, signs
  the whole setup, gets rekeyed while the sale is live, and gets its deposits back at the end.
- **Admin (manager):** a different wallet that controls the sale while it is live. A separate
  wallet is needed because the collection wallet can't sign once rekeyed.
- **Payouts:** 1–5 addresses with shares in basis points summing to 10,000. They are fixed at
  creation. `createSale` takes them packed as 40-byte entries (32-byte address + uint64 bps);
  the sale app's `p` box stores 48 bytes per entry, adding a uint64 amount owed to that recipient.

| Step | Who signs | Call |
|------|-----------|------|
| 1 | Collection wallet | `factory.createSale(mbrPay, admin, payouts, price, startRound, endRound, revealFee, deliveryBudget, name, unitName, standard, metadataUrl)` |
| 2 | Collection wallet (or admin) | `sale.addItems(mbrPay, packedAssetIds)`: packed big-endian uint64s, up to 250 per call, 8 calls per group |
| 3 | Collection wallet | one group: `[sale.register(), pay 0 to self with rekeyTo = sale address]` |
| 4 | Buyer | one group: `[pay total, sale.commit(pay, maxPrice)]` (see line items below); fails if the price went above `maxPrice` |
| 5 | Anyone (keeper, buyer) | `sale.reveal(commitId)` once `targetRound` has passed (about 2 rounds), strictly in commit order (`next_reveal`) |
| 6 | Admin anytime / anyone after end or sell-out | `sale.release()` rekeys the collection wallet back to itself |
| 7 | Anyone | `sale.withdrawProceeds()` splits proceeds between the payouts (rounding dust goes to the first) |
| 8 | Anyone (the keeper does it after a sell-out) | `sale.deleteItemPage(page)`, then `factory.deleteSale(saleId)`. Proceeds go to the payouts, deposits to the collection wallet. |

If a payout recipient can't receive its share (closed account, share below the 0.1 ALGO minimum),
the share is recorded as owed to that recipient instead of blocking the others. A later withdrawal
pays it to that recipient only; on deletion, anything still unpayable goes to the collection wallet.

## What the buyer pays

| Line item | Amount | Goes to |
|-----------|--------|---------|
| Mint price | `price` | Creator (held until reveal, then added to proceeds) |
| Reveal fee | `revealFee` (at least 0.02 ALGO) | Whoever calls `reveal` |
| Storage deposit | commit box MBR (34,900 µALGO today, measured on-chain) | Refunded to the buyer |
| Delivery deposit | `deliveryBudget` (at least 0.4 ALGO) | Refunded to the buyer (see below) |

At reveal, the refundable deposit (storage + delivery) goes back to the buyer one of two ways:
- **Buyer opted in to the drawn asset:** it is refunded directly, together with the NFT.
- **Buyer not opted in:** the NFT goes through the ARC-59 router. The deposit pays the inbox MBR
  (router opt-in, inbox account, inbox opt-in, worst case about 0.33 ALGO). Everything left over
  is sent with the NFT as `additionalReceiverFunds`, and the buyer gets it back when they claim.
  The inbox MBR itself is a one-time cost that stays in the inbox.

## Notes

- **Admin ≠ collection wallet** (enforced).
- **Randomness:** `sha256(blockSeed[commitRound + 1] ‖ buyer ‖ commitId ‖ appId)`.
- **Fees:** all inner transactions use `fee: 0`. Callers pay through fee pooling. The frontend
  uses simulate to fill in resource references and exact fees, and adds `opUp()` calls if the
  group needs more opcode budget.
- **Release** requires zero pending commits, so the admin should `pause()` first.
- **Expired commits:** a commit not revealed within 1,000 rounds can be refunded with
  `cancelExpired`.

## What the sale app can do with the distribution wallet

1. Send a 1-unit asset transfer of a listed item, either to the buyer or to the ARC-59 router for
   that buyer.
2. Send a 0-ALGO payment to itself with `rekeyTo` set to itself (release).

Nothing else. The sale app cannot be updated, and it can only be deleted by the factory after
release. The factory itself is immutable.

## Index layout (factory boxes)

| Box key | Value |
|---------|-------|
| `s` + saleId | `SaleRecord` `(uint64 app, address admin, address distribution, address payout, uint64 price, uint64 start, uint64 end, uint64 totalItems, uint64 sold, uint64 status, uint64 createdRound, uint64 volume)`. `volume` is the total µALGO paid, at each buyer's price. |
| `m` + saleId | `SaleMetadata` `(string name, string unitName, string standard, string metadataUrl)` |
| `c` + admin + saleId | appId (list a creator's sales by box-name prefix) |

To find a sale from its app ID, read the app's `sale_id` and `factory` globals, then check that
`s` + saleId points back at that app. There is deliberately no box keyed by app ID: the new app's
ID isn't known until `createSale` lands, so a box reference to it would race with other app
creations on the network.

ARC-28 events on the factory: `SaleCreated`, `SaleSynced`, `Purchase`, `MetadataUpdated`,
`SaleDeleted`; `Purchase` includes the price paid. Factory globals: `total_sales`, `total_volume` (µALGO, all-time). Read methods: `getSale`, `getSaleMetadata`. Indexers must
check that events come from the factory app ID; anyone can deploy a contract that emits the
same event signatures.

Status values: `0` setup, `1` live, `2` paused, `3` released.
