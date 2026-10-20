# On-Chain Vote Tool (wen.tools/vote) — Spec v3

What's built, as of this spec:

| Piece | File |
|---|---|
| Contracts (Algorand TypeScript / puya-ts, AVM v13) | `contracts/VoteTool.algo.ts` |
| Build (compiles + records template hash and error maps) | `pnpm build:vote-contracts` → `contracts/build/vote/`, `src/utils/voteTemplates.ts` |
| Deploy | `contracts/deploy-vote-tool.ts` |
| Client library (builders + chain reads) | `src/utils/voteCore.ts`, `src/utils/voteTool.ts` |
| UI | `src/pages/VoteTool.tsx`, `src/components/VoteTool/*` at `/vote` and `/vote/:appId` (`?vote=<id>` redirects) |
| Unit tests (offline) | `tests/voteTool.test.ts` |
| End-to-end tests (testnet, real balances) | `contracts/test/vote-tool.testnet.ts` |

## Deployments

| Network | Factory | Registry | Admin |
|---|---|---|---|
| Mainnet | `3748290680` | `3748290764` | WENFZ…UEZ2U |
| Testnet | `774611327` | `774611330` | WENFZ…UEZ2U |

Both factories run the same program, which passed the full testnet suite, and the mainnet program was checked byte-for-byte against testnet before deploying. Each was created with 7 extra pages (16 KB) and 16 uint + 8 byte-slice global slots, so it can be upgraded in place.

It uses these go-algorand v5 features:
- **Cross-app box access:** `app_params_set` with `ForeignBoxReads` / `FamilyBoxAccess`, plus the `app_box_*` opcodes.
- **Larger apps.** The factory program is 4.1 KB.
- **Native Falcon-1024 accounts.** These vote like any other account.

## Vote modes

| Mode | Tokens move? | Weight | Anti double-vote |
|---|---|---|---|
| **Hard vote** (escrow) | Yes, sent to the vote app | deposit ÷ amount per vote (must be a whole number) | Tokens are locked in the contract |
| **Tokens held** | No, read from the wallet | balance ÷ amount per vote | Until the end, anyone can `recount` a voter down to their current balance |
| **NFT collection** | No, read from the wallet | 1 per held piece: asset created by any of up to 8 minting wallets, and (optional) unit name starts with a prefix, e.g. `WEN` | Each piece is recorded once (`n`+assetId). If it moves, anyone can `recountNft` it, and then the new holder can vote with it |

### Keeper: catching moved tokens and settling votes
`api/vote-keeper.ts` (logic in `src/utils/voteKeeper.ts`) uses the keeper account (`KEEPER_MNEMONIC`), which only pays fees.

- **After every ballot cast on the site**, the page pings the keeper. For read-only votes it re-reads every ballot's wallet and recounts the ones no longer backed. If someone moves tokens or an NFT to a second wallet and votes again, the original ballot is lowered as soon as the second vote lands. A pass with nothing stale sends no transactions.
- **After the end** (on the first page view, or from the cron), it runs finalize → payout, or fallback to refunds after the grace period → release every ballot and NFT record → `closeVote`. Voters don't have to come back to claim.
- **Cron backstop:** `vercel.json` runs a sweep daily, the Vercel Hobby limit. It covers votes cast without the site and votes nobody revisits. On a Pro plan, raise it to every 10 minutes.
- **Safety:** it only acts on votes the factory's registry points back at, caps fees per pass (0.2 ALGO, and the next pass continues), and throttles each vote to one pass per 15 s.
- **Remaining gap:** a move-and-revote in the last couple of blocks before `endRound` can land after the end, when recounts are closed.

In every mode, voting again changes your option and moves your whole weight.

### Where escrowed tokens go (hard vote only)
- **Return to voters** (default)
- **Send to an address / NFD**
- **Send to the winning option's recipient** (grants, charities, projects)

Two fallbacks in the "send to the winning option's recipient" mode:
- A tie, or no votes at all, means everyone is refunded.
- If the payout target can't receive the asset (not opted in), anyone can call `fallbackToRefunds` once `grace` rounds have passed after the end. `grace` defaults to 200,000 (~1 week).

Cancelling a vote always refunds everyone.

**Winner-takes-all to voters is deliberately not offered.** Paying winning voters out of the losers' stakes is pari-mutuel betting: you pay something to enter, the outcome is chance, and there's a prize. That brings gambling and CFTC event-contract risk. In the modes that are offered, voters never get back more than they put in. *(Product risk note, not legal advice.)*

## Contracts

```
VoteFactory     (creator = deployer; upgradeable by admin → changes the template for NEW votes only)
 ├─ VoteRegistry   inner-created  → FamilyBoxAccess + ForeignBoxReads
 ├─ VoterList #n   inner-created  → ForeignBoxReads
 └─ Vote #n        inner-created  → ForeignBoxReads
```

All children have the same creator (the factory address), so they form one box-access family.
- **Only the registry turns on `FamilyBoxAccess`.** Votes patch their live totals and final status straight into their registry entry (`app_box_replace`).
- **Votes and voter lists are read-only to everyone else.** A sibling app can never write into a vote's ballots or tallies. This matters because a creator can upgrade their own vote before it starts, and a rogue upgrade would still be a family member.
- **Cross-app read:** the voter gate does `app_box_len(gateApp, prefix ‖ voter)` on every ballot. The gate app can be a VoterList, or a previous vote (its `b`+address ballot boxes). Requirement: "voted in poll X".

### Upgrading the factory (instead of redeploying)
The factory is meant to live for a long time and be upgraded in place:

```bash
pnpm build:vote-contracts
npx tsx --env-file=contracts/.env contracts/deploy-vote-tool.ts testnet upgrade <factoryId>
```

- **Upgrades change the template for new votes only.** Existing votes keep the program they were created with. Every shipped template hash stays in `KNOWN_VOTE_TEMPLATES`, so old votes still verify in the UI.
- **Two things can't change on update:** global schema and program size. The factory is created with headroom for both: 16 uint + 8 byte-slice slots (5 used today), and the most extra program pages the network accepts (7 on v5, otherwise 3). New state goes in the reserved slots or in boxes.
- **`setAdmin(account)`** hands control to another account, such as a multisig.
- **`lockUpgrades()`** is one-way. It removes the admin, so no more upgrades or settings changes are possible. Votes, `closeVote` and every refund keep working.

### Costs a creator doesn't get back
Everything is refunded on close (the vote app deposit held by the factory, the vote account, boxes, opt-in) except the **registry entry (0.0477 ALGO)**. It stays as the vote's permanent listing, so ended votes and their results remain on the landing page without a database.

### Lifecycle
```
createVote (one signed group: fund → inner create → init writes boxes + registry entry → surplus back)
 → vote* / recount*  (start ≤ round ≤ end)
 → finalize          (anyone, after end; records winner)
 → payout            (anyone, payout modes)
 → release* / releaseNft*  (anyone; returns tokens in refund mode + every voter's box deposit)
 → close             (anyone; strays + all remaining ALGO → creator; deletes the app)
```

### Trust model
- **Rules lock when voting starts.** The vote's update handler only lets the creator upgrade before `startRound`.
- **The UI detects upgraded votes.** It hashes each vote's approval program and checks it against `KNOWN_VOTE_TEMPLATES`. A mismatch shows a "custom rules" warning.
- **The UI verifies the registry entry.** The vote's `factory` global must match, and the registry entry it claims must point back at the vote. Otherwise it shows a "look-alike" warning.
- **Voter deposits are exact.** Each ballot box deposit is charged as the measured change in the app's min balance, and the same amount is refunded on release. Any overpayment is returned in the same call.

### Box layout
| App | Key | Value |
|---|---|---|
| Registry | `v` + voteNo (u64) | 104 bytes: app, creator, mode, asset, start, end, status, winner, totalWeight, voters |
| Vote | `m` | (title, description) |
| Vote | `o` + i (u64) | (title, description, recipient) |
| Vote | `t` | 16 × u64 tallies |
| Vote | `b` + address | (option, amount, weight) |
| Vote | `n` + assetId | voter address (NFT mode) |
| Vote | `c` | (address[] creators, byte[] unitPrefix) (NFT mode) |
| VoterList | `b` + address | `1` |

## Testing

**Unit tests** (`pnpm test`, offline fake chain):
- They decode registry entries, vote state, ballots and NFT records.
- They check the template hash against the compiled program.
- They check funding estimates against ABI-encoded box sizes.
- They build every vote group: escrow, held, NFT split across calls, and batched releases.
- **Settlement plan:** in refund mode every escrowed token is returned, and every ballot/NFT deposit is refunded in every mode. Payout modes send the full pool to the right address.

**Testnet end-to-end** (`npx tsx --env-file=contracts/.env contracts/test/vote-tool.testnet.ts`, ~6 testnet ALGO from `VOTE_DEPLOYER_MNEMONIC`). It deploys a fresh factory with a 30-round grace and checks real balances:
1. Hard vote, refund. Exact token balances are restored, the ALGO deposit is refunded (only fees spent), a non-whole deposit is rejected, release before the end is rejected, and the registry is patched by the family write.
2. Cancel in payout mode refunds everyone, and a non-creator can't cancel.
3. Send to address: the treasury gets the full pool.
4. Winner recipient gets the pool, and a tie refunds both voters.
5. Payout target not opted in: payout fails, fallback before grace is rejected, and after grace everyone is refunded.
6. Tokens held: nothing moves, and a recount after moving tokens to a second wallet means they count once.
7. NFT: two pieces give two votes, a foreign piece is rejected, a counted piece can't be reused, and after `recountNft` the new holder votes.
8. Voter list: the cross-app read allows listed voters and rejects unlisted ones.
9. Upgrade before start works, and is rejected after start.

The script cleans up its wallets at the end.

**Not yet run:** the testnet suite needs a funded `VOTE_DEPLOYER_MNEMONIC`. The single-group create (box access for an app created in the same group, via empty access-list entries) is the main thing it confirms.

## Ideas to make it cooler
- **Live "I voted" share cards.** Use an OG image per vote (`/api/vote-og?app=…`) with the live pie chart, so links posted on X or Discord show the current standings.
- **Quadratic voting** as an extra weight option: weight = √(tokens). It reduces whale dominance, and it's a one-line change in `applyBallot` plus a mode flag.
- **Commit–reveal (secret ballot).** Voters post `hash(option ‖ salt)`, then reveal after the end. The results stay hidden while voting is live.
- **Delegation.** A `delegate(address)` box lets a holder hand their read-only weight to someone else. Recount still applies.
- **Chained governance demo.** A tiny "Treasury" contract that releases funds only when it reads `status = final` and `winner = 0` from a vote's boxes, with no oracle. This is the best showcase for `ForeignBoxReads`.
- **Embeddable widget** (`<iframe src="wen.tools/vote/123?embed=1">`) for project sites.
- **Post-quantum ballots badge.** Mark ballots cast from Falcon-1024 accounts. It ties in with the PQ tools already on the site.
