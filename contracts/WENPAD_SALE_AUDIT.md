# WenPad Random Sale — Security Review

**Scope:** `contracts/WenPadSale.algo.ts` (`WenPadSale`, `WenPadSaleFactory`), TEALScript 0.107.2.
**Method:** manual review of the source and the compiled TEAL, checked against the Trail of Bits
Algorand vulnerability classes, the October 2025 Algorand compiler disclosure (ABI validation),
and the ARC-59 router specification.

**Status:** this is an internal review, not an independent audit. The contracts have **not been
executed on-chain yet**. Do the testnet run in "Test plan" before mainnet, and get an external
audit before holding significant value.

## Threat model

| Actor | Can | Wants |
|-------|-----|-------|
| Buyer | Choose when to commit; control their own account (opt-ins, balance, closing it); call any public method | A rare item at the normal price; a free re-roll |
| Creator / admin | Admin methods; ASA manager roles (clawback, freeze) on their assets | Keep rare items; avoid delivering |
| Third party / keeper | Call reveal, cancelExpired, release (when allowed), withdrawProceeds, deleteItemPage | Drain app or distribution funds; block a sale |
| Block proposer | Withhold the block for the target round | Bias a draw |

**Critical invariant:** the sale app is the sole authority over the distribution wallet. Any
flaw in what it sends from that wallet can drain the creator's collection.

## Trail of Bits Algorand classes

| Class | Applies? | Result |
|-------|----------|--------|
| Rekeying | Yes. The design relies on it. | Only `doRelease` sets `rekeyTo`, and only to the distribution wallet itself. Incoming payments are checked for `rekeyTo == zero` (createSale, commit). register checks that the next transaction rekeys exactly to the app. |
| Unchecked transaction fees | Smart signatures only | No LogicSigs. All inner transactions set `fee: 0`, so a caller cannot burn app funds on fees. |
| Closing account | Yes | No inner transaction sets `closeRemainderTo`, except the sale app's own close-out to the admin on deletion (factory only, after release, no boxes). Incoming payments are checked for `closeRemainderTo == zero`. |
| Closing asset | Yes | No inner transaction sets `assetCloseTo`. Every distribution transfer is `assetAmount: 1`. |
| Group size check | Checked | Transaction arguments are positional (`groupIndex - 1`) and type-checked, so one payment cannot satisfy two calls. register uses `groupIndex + 1` explicitly. No absolute group indices are used. |
| Time-based replay | No | No periodic payments. Commits are one-shot boxes. |
| Access control on update/delete | Yes | Neither contract can be updated. The factory cannot be deleted. The sale app can only be deleted by its creator (the factory), through `deleteSale` (callable by anyone since v5), after release, with no pending commits and no boxes. Every payout destination is fixed, so a third-party close cannot redirect funds. |
| Asset ID check | Yes | Items come from the admin's list. At reveal, the app checks the distribution wallet holds the drawn asset and skips it if not. |
| DoS via asset opt-out | Yes | A buyer who opts out between commit and reveal just moves to the ARC-59 path. The distribution wallet cannot opt out: it is rekeyed, and the app never sends opt-outs. |
| Inner transaction fee | Yes | Every `send*` sets `fee: 0`. |
| Clear state | No | There is no local state, and the default clear program accepts. |

## Findings and fixes

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **High** | **Free re-roll by making reveal fail.** If the buyer can make `reveal` fail for draws they don't like, they wait for expiry and take the full refund. They can then retry until they draw something rare. Three ways to do it in the first draft: (a) closing their account so the small deposit refund payment fails (it would leave them below the 0.1 ALGO minimum balance); (b) lowering their ALGO balance so ARC-59's `receiverAlgoNeededForClaim` exceeds the deposit, which failed `assert(cost <= budget)`; (c) opting into only the rare assets with a deposit too small for the ARC-59 path. | **Fixed.** After a draw, no buyer-controlled state can fail the call. Refunds go directly only when the buyer is opted in to the drawn asset (so the account provably exists); otherwise they are sent into the ARC-59 inbox as `additionalReceiverFunds`. The ARC-59 cost the contract must cover is only the router MBR, which the buyer can lower but never raise, and there is a deposit floor (0.4 ALGO) above the worst case (about 0.33). |
| 2 | Medium | **ARC-59 return value not validated.** TEALScript strips the 4-byte ABI prefix without checking it or the length (confirmed in the compiled TEAL; this matches the Oct 2025 disclosure). | **Fixed.** The app asserts `len(lastLog) == 37` and the `0x151f7c75` prefix before decoding. The router app ID is fixed at factory creation. |
| 3 | Medium | **Hardcoded commit-box MBR.** A protocol change to box MBR would break every commit. | **Fixed.** Measured as the change in `minBalance` around box creation and stored in the commit. |
| 4 | Medium | **Refund to a closed account blocks the sale.** `cancelExpired` and "nothing deliverable" refunds below 0.1 ALGO to a closed buyer account would fail. Pending commits would then never clear, blocking `release`. | **Fixed.** `safeRefund` pays only if the receiver exists or the amount covers a new account's MBR; otherwise the amount goes to proceeds. |
| 5 | Low | **Payout account that cannot receive makes the sale undeletable.** `deleteApplication` paid proceeds to the payout account unconditionally. | **Fixed.** If the payout account cannot receive, proceeds are folded into the close-out to the admin. |
| 6 | Low | **Overpaid factory deposit stuck in the factory.** | **Fixed.** `createSale` charges the measured MBR increase plus seed, and refunds the rest. |
| 7 | Low | **Admin could cancel a rare pending draw** by releasing while it was pending (the buyer would be refunded, and the item kept). | **Fixed by design.** `release` requires `pending == 0`. The admin must pause first; anyone can reveal pending commits within seconds. |
| 8 | Low | **Keeper incentive too low.** An ARC-59 delivery is about 15 inner transactions, more than the original 0.01 ALGO bounty covered. | **Fixed.** `MIN_REVEAL_FEE = 0.02 ALGO`. The keeper endpoint also refuses when total fees exceed the bounty. |
| 9 | Info | **Dynamic ABI arguments.** TEALScript decodes `string` and `uint64[]` arguments by their actual byte length and ignores the length prefix. | **Safe as used.** Length checks run on real bytes, and stored strings are re-encoded with correct prefixes. |
| 10 | Info | **Wallet stuck if the admin key is lost.** | **Mitigated.** Every sale needs an end round, and anyone can release after it. `doRelease` can only rekey the wallet to itself. |
| 11 | **Critical** | **Read after box delete (found on testnet).** `const c = this.commits(id).value` does not copy the struct: TEALScript keeps the box key and reads each field from the box on demand. `reveal` and `cancelExpired` deleted the commit box and then read `c.buyer` etc., so both always failed with "no such box". Commits could never be resolved, `release` (which requires zero pending) could never run, and **the distribution wallet stayed rekeyed for good**. The factory's `deleteSale` had the same pattern. | **Fixed.** All fields are copied into locals before any `box_del`. The compiled TEAL was checked: no box access follows a delete anywhere. Testnet factory 773802844 has this bug and is retired. |

### Later changes (reviewed)

- **`addItems` takes packed bytes.** The asset IDs arrive in the same layout as an item page, so
  each page is written with a single `box_replace`. Cost dropped from about 53 opcodes per item
  to about one write per page: roughly 2,000 items per signature instead of about 190. The draw
  skips an asset ID of 0 without looking it up, because that lookup would fail and stall the reveal.
- **Roles.** The collection wallet sends `createSale` and may call `addItems` during setup; the
  admin must differ from it. After release, `deleteSale` may be called by anyone (v5; before
  that only the admin or the collection wallet), and deposits return to the collection wallet,
  which paid them.
- **Split payouts.** 1–5 entries, validated on-chain: non-zero addresses, shares > 0, summing to
  10,000 bps. They are written once by the factory through `setPayouts`, which only the creator
  (the factory) may call, and only if the box doesn't exist yet. `payProceeds`:
  - computes shares with `wideRatio`, so there's no overflow;
  - gives rounding dust to the first recipient;
  - uses the `canReceive` guard, so one closed recipient never blocks the others. Since v5 its
    share is recorded as owed to that recipient alone (see C2-M1 below) and is folded into the
    close-out on deletion if it still can't be paid.
  - Paying the factory address is possible, but would strand that share. The UI prevents it, and
    it is the creator's own choice.

- **Volume tracking.** The sale app passes the price each buyer actually paid to `logPurchase`,
  which adds it to `SaleRecord.volume` and the factory's global `total_volume`. The callback is
  authenticated with `sales[saleId].app == caller`, so only a genuine Shuffle can add volume.

**Testnet v3 (factory 773807620, splits + roles):** every step passed. That covers split
validation on-chain (90% total, a 0% share and 6 recipients are rejected), a 70/30 split paid
exactly by a third party, and the collection wallet closing its own Shuffle and getting its
deposits back. A buyer whose inbox already existed paid only 0.2 ALGO for ARC-59 delivery.
**Testnet v4 (factory 773809724, + volume):** the core suite passed, and volume was recorded
per Shuffle and in the factory total. The on-page verifier confirmed the deployed bytecode
matches the published source.

**Testnet v6 (factory 773855125, community-review fixes incl. ordered reveals):** every step
passed, including new tests for each fix: out-of-order reveal and cancel rejected, the keeper
resolving a two-commit queue in order and auto-closing the sold-out Shuffle (keeper net +0.022
ALGO), a default-frozen asset never delivered despite the buyer opting in, a commit with maxPrice
below the price rejected, an unreachable 50% share kept as owed across three withdrawals (the
other recipient paid exactly 50%), the metadata overpayment refunded, a third-party close, and the
real 1,000-round expiry cancel. (Factory 773852089, the same build without ordered reveals, is retired.)

**Mainnet: factory 3732791636** (Oct 2026). Same build as testnet 773855125 (4,592-byte factory,
2,941-byte sale program), pointing at ARC-59 router 2449590623; the page's verifier confirms the
on-chain bytecode matches the published source. Earlier mainnet factories 3732112982 and
3732147516 (older builds, no live Shuffles) are retired.

### Community review (Oct 2026) and v5 changes

An external community review (@Mufasa, Oct 6 2026) reported 13 items. Dispositions:

| ID | Finding | Disposition |
|----|---------|-------------|
| C-1 | Draw depends on reveal order (`seed % remaining` over a list other reveals change) | **Fixed in v5:** commits resolve strictly in commit order (`commitId == next_reveal` in `reveal` and `cancelExpired`), so every outcome depends on block seeds alone. The keeper resolves the queue in order and no longer refuses a reveal that costs a little more than its bounty, so one costly reveal can't stall it. |
| H-1 | Default-frozen assets let a buyer force a failed delivery and take the expiry refund | **Fixed in v5:** the draw drops default-frozen assets like unheld ones; the launch wizard excludes them. Freeze/clawback addresses are *not* dropped: only the creator holds those keys, which is creator trust (documented), not a buyer attack. |
| M-1 | A retained payout share is re-split across all recipients on each withdrawal | **Fixed in v5:** the `p` box stores 48-byte entries (address, bps, owed); an unpaid share is owed to that recipient only. |
| M-2 | No maximum price on commit; the manager could raise the price on an in-flight commit that overpaid | **Fixed in v5:** `commit(pay, maxPrice)` asserts `price <= maxPrice`; the client passes the price shown. |
| M-3 | Commits accepted while the wallet isn't controlled by the app | **Not an issue.** After the rekey only the sale app can sign for the wallet, so nothing later in the group (or ever) can rekey it away; `register` requires the rekey. |
| M-4 | Long runs of unheld items could exhaust the reveal budget | **Accepted.** Only the creator can load items and the wizard lists held assets only; worst case the creator breaks their own Shuffle and buyers get refunds. |
| M-5 | A protocol MBR increase could make the inbox cost exceed the deposit | **Fixed in v5:** the shortfall is covered from the price instead of failing. |
| L-1 | Manager can extend the end round indefinitely | **Accepted.** The manager is chosen by the creator (default: the first payout) and can release at any time anyway. |
| L-2 | Block seed is visible to the target round's proposer | **Accepted** (see residual risks). |
| L-3 | Reveal bounty close to pooled fees | **Accepted.** wen.tools runs its own keeper. |
| L-4 | `updateMetadata` kept overpayments | **Fixed in v5:** the overpayment and any MBR decrease are refunded. |
| I-1 | Creator index keyed by admin | **Already handled:** My shuffles matches the manager or the collection wallet. |
| I-2 | Trust assumptions | **Documented** in the page FAQ ("What do I have to trust?"). |

**Also in v5 (requested):** `deleteSale` is permissionless, and the keeper closes a released
Shuffle right after its last delivery, so creators don't have to collect by hand. Funds can only
go to the payout split (proceeds) and the collection wallet (deposits); the sale app still refuses
deletion unless it is released with nothing pending and no boxes left.

**Client-side bug found on testnet:** `finalizeGroup` produced groups with a stale group ID,
because `atc.simulate()` writes a group onto the same transaction objects. Every
multi-transaction action failed with "incomplete group". Fixed by clearing the group before
reassigning it.

**Lesson for TEALScript reviews:** treat `const x = box.value` (struct) as a *reference*. Check
every `box_del` in the compiled TEAL for later reads.

## Residual risks (accepted, documented)

- **Block-proposer bias.** The proposer of round `commit + 1` could withhold their block to
  re-roll a draw. They would forfeit the block, and they cannot choose the result. This is
  acceptable for NFT mints. It is not suitable for high-value raffles; the beacon would be.
- **Buyer option on expiry.** A buyer who already knows the outcome can wait out the 1,000-round
  window and cancel if nobody reveals. The reveal bounty makes revealing profitable for anyone,
  the keeper reveals within seconds, and the buyer's own page reveals too. This is only exploitable
  if every revealer is offline for about 45 minutes.
- **Creator ASA powers.** If the assets have a clawback or freeze address, the creator can claw
  back items from the distribution wallet during the sale (the draw then skips them) or from buyers
  afterwards. The launch UI warns creators. Buyers should prefer collections with neither set.
- **ARC-59 router trust.** The router is trusted to deliver correctly; it is the standard
  deployment the rest of wen.tools already uses.
- **Opcode budget.** Reveal may need extra budget from `opUp()` calls in the group. The frontend
  and keeper add these automatically after simulation.
- **Event spoofing.** Off-chain indexers must filter events by the factory app ID and its
  registered sale apps.

## Testnet results

Script: `contracts/test/wenpad-sale.testnet.ts`.

**Run 1** (factory 773802844, pre-fix). These checks passed:
- createSale rejects admin == distribution and a reveal fee below the minimum;
- the overpayment is refunded, with no ALGO stuck in the factory;
- the sale is indexed in the factory;
- 4 items loaded, including a duplicate;
- register without the rekey is rejected, and commit before live is rejected;
- the distribution wallet is rekeyed to the sale and the sale goes live;
- the factory index syncs to live;
- neither app can be updated or deleted directly;
- third parties cannot call admin methods or `syncSale`;
- the commit box MBR is measured at 34,900;
- reveal before the target round is rejected.

The run then stopped at the first real reveal on finding #11.

**Run 2** (factory 773804149): stopped at createSale.
- The `a<appId>` index box was keyed by the *new* app's ID. That ID is predicted at simulation
  time, but other app creations on the network change it before the transaction lands.
- **Fixed in the contract:** the box was removed. Sale apps now pass their `saleId` in callbacks,
  and the factory checks that `sales[saleId].app == caller`. Lookup by app ID reads the app's
  `sale_id` global and verifies it against the factory record.
- The remaining `saleId`-keyed boxes only race if two sales are created at the same moment, and
  the launcher retries in that case.
- This factory is retired.

**Run 3** (factory **773804369**, current): **all steps passed.** Results:
- **Direct delivery:** net buyer cost was exactly price + reveal fee + fees, with the deposit refunded.
- **Buyer closed their account between commit and reveal:** the reveal still succeeded via
  ARC-59. This is the regression test for finding #1.
- **ARC-59:** the real inbox cost was **0.3281 ALGO**, inside the 0.4 floor. The buyer then
  claimed from the inbox and got the leftover back.
- **Pause:** blocks commits; release with a pending commit is rejected; reveal works while paused.
- **Sell-out:** auto-releases, and the factory index syncs.
- **Proceeds:** a third party can trigger the payout.
- **deleteSale:** removes the index entries and refunds every factory deposit.
- **Permissionless release:** rejected before the end round, works after it.

Two more client-side issues were found and fixed in Run 3:
- **Reveal transactions need a short validity window.** The AVM only lets a transaction read block
  seeds in `(lastValid - 1002, firstValid)`, so the default 1000-round window left one readable
  round. Reveals now use a 10-round window, which keeps about 990 rounds readable.
- **Out of reference slots.** ARC-59 deliveries need more references than one app call carries;
  `finalizeGroup` now adds `opUp()` calls for reference limits as well as opcode budget.

**cancelExpired** was tested against a test-only build (factory 773805104) that is identical
except `REVEAL_WINDOW = 20`, generated in `contracts/test/short-window/`. All checks passed:
- cancel inside the window is rejected;
- after the window the buyer is refunded in full (0.4649 ALGO: price + reveal fee + both deposits);
- pending clears, so release works again;
- the sale closes cleanly.

The production window can't be shortened. It is what makes a cancel impossible while a reveal
is still possible; a shorter window would bring back the free re-roll.

**Not yet covered:**
- the 128-item page boundary;
- the "nothing deliverable" refund (the duplicate was skipped inside a successful draw instead);
- the keeper endpoint and the frontend wallet flows.

## Test plan (before mainnet)

On testnet, with a fresh admin, a fresh distribution wallet and two buyers:

1. createSale with an overpayment: confirm the refund, and confirm admin == distribution is rejected.
2. addItems across a page boundary (more than 128 items), including a duplicate and an asset the
   distribution wallet does not hold.
3. register + rekey in one group; confirm a register *without* the rekey fails.
4. Buyer opted in to all items: commit, reveal, confirm the direct delivery and the full deposit refund.
5. Buyer opted in to nothing: commit, reveal, confirm the ARC-59 inbox delivery, then claim and
   confirm the leftover deposit comes back.
6. Buyer closes their account after committing, then reveal: it must still succeed.
7. Reveal before the target round must fail. cancelExpired before the window ends must fail.
8. pause, release with pending commits must fail, reveal, then release succeeds and the auth
   address is back to the distribution wallet.
9. Permissionless release by a third party after the end round.
10. Sell-out triggers automatic release.
11. withdrawProceeds, deleteItemPage, deleteSale: confirm all MBR is refunded and the factory
    boxes are removed.
12. Attempt update and delete on both apps from every role: all must fail.

## Sources

- Trail of Bits, Not So Smart Contracts (Algorand): https://github.com/crytic/building-secure-contracts/tree/master/not-so-smart-contracts/algorand
- Algorand Foundation, Disclosure of Vulnerabilities in Puya (ABI validation across compilers, Oct 2025): https://dev.algorand.co/bulletins/puya-issues-27-10-2025/
- ARC-59 ASA Inbox Router: https://dev.algorand.co/arc-standards/arc-0059/
