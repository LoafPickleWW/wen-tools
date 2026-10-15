# Wen Tools PQ Coupon: Security Review

**Scope:**
- `contracts/PQCoupon.algo.ts` (TEALScript 0.107.2)
- Compiled output: `contracts/build/PQCoupon.approval.teal`, `PQCoupon.clear.teal`, `PQCoupon.arc4.json`, `PQCoupon.arc56.json`
- Client code that builds the contract's transactions: `src/utils/pqCoupon.ts`, `src/utils/pqPrinter.ts` (plus the guards in `src/pages/PQTxPrinter.tsx`)
- Test: `contracts/test/pq-coupon.testnet.ts` (read only; nothing was executed)

**Status:** this is an internal review, not an independent audit. No transactions were sent. The
only network calls were read-only algod `GET`s and one `/v2/teal/compile` call. They confirmed
that the bytecode deployed for testnet app **774340680** is byte-for-byte the compiled
`PQCoupon.approval.teal`. The clear program on chain is `0x0a` (version byte only). PQPRINT
(ASA 774340703) has no manager, freeze or clawback, its reserve is the app, and it has 6
decimals and a total of 2^64-1. The app account holds 200,000 µA against a 200,000 µA minimum
balance.

## Method

1. **Research.** I collected Algorand/AVM vulnerability classes and checklists, then read the
   go-algorand consensus code for native post-quantum accounts at `master` and at the
   `v5.0.3-stable` tag.
2. **Manual review** of the TypeScript source and, line by line, the compiled TEAL: routing
   switch, ABI decoding, every state access, every inner transaction, and box reads after
   `box_del`.
3. **Threat walk-through** of the five intended properties and the extra questions in the
   brief, with exploit attempts written as transaction groups.
4. **Client review** of group ordering, fee and reserve math, and error handling paths that
   could lose user funds.

### Sources

| Source | Used for |
|--------|----------|
| Trail of Bits, *Not So Smart Contracts: Algorand* (https://github.com/crytic/building-secure-contracts/tree/master/not-so-smart-contracts/algorand) | The 11 classic classes: rekeying, unchecked fees, closing account/asset, group size, time-based replay, access control on update/delete, asset ID check, DoS via opt-out, inner txn fee, clear-state check |
| Tealer detectors (https://github.com/crytic/tealer) | is-updatable/deletable, group-size-check, can-close-account/asset, missing-fee-check, rekey-to |
| Trail of Bits Algorand vulnerability scanner checklist (https://trailofbits.com/skills/algorand-vulnerability-scanner/) | Inner txn checklist: fee 0, RekeyTo not user-controlled, all fields set |
| Algorand smart contract guidelines (https://developer.algorand.org/docs/get-details/dapps/smart-contracts/guidelines) and costs/constraints (https://dev.algorand.co/concepts/smart-contracts/costs-constraints) | Validating type, receiver, amount and asset; box MBR = 2500 + 400 × (name + size) |
| Algorand Puya compiler disclosure, Oct 2025 (https://dev.algorand.co/bulletins/puya-issues-27-10-2025/) | ABI argument validation gaps in compiled TEAL (checked here for TEALScript) |
| go-algorand `data/basics/pq_address.go`, `data/basics/address.go` | PQ address = SHA-512/256("PQA" ‖ scheme ‖ salt ‖ pk); canonical salt; `IsPQCompliant` = not an Ed25519 point |
| go-algorand `data/transactions/pqsig.go`, `pqscheme.go`, `protocol/pq_scheme.go`, `protocol/hash.go` | PQSig envelope check (derived address must equal the authorizer); schemes `f1`/`f5`/`ed`; Falcon-1024 fee contribution 2e6 (2 min fees); HashIDs "PQA", "PQProgram" |
| go-algorand `data/transactions/signedtxn.go`, `logicsig.go`, `verify/txn.go` | Exactly one signature category per txn; `LogicSig.PQsig` (PQ-delegated lsig) verified over `PQDelegatedProgram{Addr, Program}`; fee contribution also applies to `Lsig.PQsig` |
| go-algorand `config/consensus.go` (v42) | `EnablePQSchemeFalcon1024 = true`; f5 and ed only in vFuture; `EnforceAuthAddrSenderDiff`; `PerByteTxnSurcharge` |
| go-algorand `ledger/eval/eval.go` (`transaction`, `applyTransaction`), `ledger/apply/apply.go` (`Rekey`) | Authorizer checked against AuthAddr **before** apply; `apply.Rekey` runs **before** `apply.ApplicationCall` |
| go-algorand `data/transactions/logic/eval.go` (`opItxnSubmit`, `authorizedSender`), `fields.go` | Inner txn authorization is checked per inner txn just before it runs; the AVM has no field for signature type or authorizer |
| go-algorand `daemon/algod/api/server/v2/handlers.go` (`enforcePQAuthorizerCompliance`, `skip-pq-address-check`) | The off-curve rule for PQ addresses is a REST admission policy, not consensus |
| go-algorand PR #6663 "avm: pq delegated lsig" (https://github.com/algorand/go-algorand/pull/6663) | Merged 17 Jul 2026; present in `v5.0.3-stable`; gated only by `EnablePQSchemeFalcon1024` |
| `contracts/WENPAD_SALE_AUDIT.md` | Report format; the lesson about reading after `box_del` in TEALScript |

## Threat model

| Actor | Can | Wants |
|-------|-----|-------|
| Classic (Ed25519 / multisig / lsig) account | Call any method, build any group | Earn PQPRINT without being a PQ account |
| PQ printer | Sign with its Falcon key, delegate an lsig, rekey, build groups, pick a beneficiary | Earn coupons more cheaply than one Falcon fee each; claim twice; drain the app |
| Third party | Pay into the app, fund accounts, act as a beneficiary (opt in or out) | Drain app ALGO, mint PQPRINT, block other people's claims |
| Creator | `bootstrap()` once | Admin powers over PQPRINT or the app |

## Trail of Bits Algorand classes

| Class | Applies? | Result |
|-------|----------|--------|
| Rekeying | Yes | No inner txn sets `RekeyTo`. `print`/`register` read `AcctAuthAddr`, but do not check the txn's own `RekeyTo` (**finding 1**). |
| Unchecked transaction fees | Yes (by design) | `print` requires `txn Fee >= 3 × MinTxnFee`. The fee is debited from the sender, so it cannot be pushed onto other group members. No LogicSigs. |
| Closing account | Partly | No inner txn sets `CloseRemainderTo`. `mbrPay.CloseRemainderTo` is not checked, which can only hurt the payer (**finding 8**). |
| Closing asset | Yes | The only axfer (`claim`) sets no `AssetCloseTo`. The amount is `count × 1e6`. |
| Group size check | No | The only group reference is relative (`GroupIndex - 1`) and type-checked as `pay`. One payment cannot serve two `register` calls, because the second call's `GroupIndex - 1` is the first app call. |
| Time-based replay | No | No periodic payments. |
| Access control on update/delete | Yes | The routing switch sends UpdateApplication, DeleteApplication, OptIn and CloseOut to `err` (TEAL lines 15-25). The app is immutable. |
| Asset ID check | Yes | `XferAsset` comes from global `c`, which only `bootstrap` sets, once. |
| DoS via asset opt-out | Yes | A beneficiary that is not opted in, or opts out, blocks that printer's claim (**finding 3**). Other printers are unaffected. |
| Inner transaction fee | Yes | All three inner txns set `Fee = 0`, so the outer caller pays through pooling. The app's ALGO is never spent on fees. |
| Clear-state check | N/A | No local state. OptIn is rejected. The clear program is a bare version byte (**finding 9**). |

## Summary of findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | **Low** | `AcctAuthAddr == 0` can be passed by a non-Falcon key: rekey takes effect *before* the approval program runs, so a print carrying `RekeyTo = Sender`, signed by the key the account is rekeyed to, passes | `PQCoupon.algo.ts:85,98-99`; TEAL 226-231, 291-297 |
| 2 | Informational | PQ-delegated LogicSigs (go-algorand 5.0.3) authorize prints without a fresh Falcon signature per transaction. The contract cannot tell them apart | `PQCoupon.algo.ts:13-15,96-105` |
| 3 | **Low** | The beneficiary is fixed at registration, and `claim` reverts unless it can receive PQPRINT. A beneficiary that never opts in (or the zero address, or one that opts out) locks the 31,700 µA deposit and every coupon. In the wen.tools client this also blocks the printer's close-out | `PQCoupon.algo.ts:80,92,118-125`; `pqPrinter.ts:372-385` |
| 4 | **Medium (client)** | `getPendingCoupons` returns `null` ("not registered") on *any* error. During close-out, a transient algod error makes the client close the printer account without claiming, which strands the deposit and all earned coupons | `pqCoupon.ts:42-55`; `pqPrinter.ts:366-374` |
| 5 | Informational | The contract accepts any salt, including salts whose address is an Ed25519 point. The off-curve rule is only a REST admission policy. This matters only against a quantum adversary | `PQCoupon.algo.ts:84` |
| 6 | Informational | Box MBR is hard-coded. The figure is correct today: 2500 + 400 × (33 + 40) = 31,700 | `PQCoupon.algo.ts:33,89` |
| 7 | Informational | The `byte[]` ABI length prefix is stripped without being validated (`extract 2 0`). Extra app args are ignored | TEAL 168-169 |
| 8 | Informational | `mbrPay`'s sender, `CloseRemainderTo` and `RekeyTo` are not checked. Only the payer can be affected, and the refund always goes to the printer | `PQCoupon.algo.ts:87-90` |
| 9 | Informational | The clear-state program is `#pragma version 10` with no body, so evaluation fails. This is harmless because there is no local state and OptIn is rejected | `PQCoupon.clear.teal` |
| 10 | Informational | Test gaps: the fee-offload rejection is not matched to its reason, and several edge paths are untested | `contracts/test/pq-coupon.testnet.ts:184-191` |

No Critical or High issues were found. All five intended properties hold, with the qualifications
in findings 1-3 and in the PQ-authorization section below.

## The PQ-authorization assumption

**Claim under test** (contract header, lines 11-15): *"If the sender equals that hash and is not
rekeyed, no Ed25519 key can exist for it, so every transaction it sends is Falcon-authorized."*

### How a transaction from address S can be authorized (go-algorand 5.0.3, consensus v42)

`verify/txn.go: checkTxnSigTypeCounts` requires exactly one signature category. The ledger
(`eval.go: transaction`) then requires `txn.Authorizer()` to equal the sender's stored AuthAddr,
or the sender itself when AuthAddr is zero. Suppose S = SHA-512/256("PQA" ‖ "f1" ‖ salt ‖ pk),
which `register` proves.

| Authorization path, with AuthAddr(S) = 0 | Possible for S? |
|------------------------------------------|-----------------|
| `pqsig` with scheme f1 | Yes. The derived address must equal S, so this needs the Falcon key (`pqsig.go: validateEnvelope`). This is the intended path. |
| `pqsig` with another scheme (f5 and ed are vFuture only) | No. The scheme tag is inside the hash, so this would need a SHA-512/256 collision. |
| `sig` (Ed25519) | Only if S is a valid Ed25519 point *and* someone knows its discrete log. For the canonical (off-curve) salt, S does not decode as a point. For an on-curve salt, the discrete log is classically infeasible but **quantum-feasible** (finding 5). |
| `msig` | No. The multisig address is a hash under the "MultisigAddr" domain, so this would need a collision. |
| `lsig` escrow (no delegation signature) | No. It would need SHA-512/256("Program" ‖ logic) = S, which is a collision. |
| `lsig` delegated by `sig` / `msig` / `lmsig` | Same as the Ed25519 and multisig rows. |
| **`lsig` delegated by `pqsig`** (PR #6663, live in v5.0.3, gated only by `EnablePQSchemeFalcon1024`) | **Yes.** It is a Falcon signature over "PQProgram" ‖ S ‖ program, made once. After that, any party holding the program can authorize S's transactions that the program accepts. Each such txn carries and re-verifies the same Falcon signature and pays the same 2-min-fee PQ surcharge (`signedtxn.go: signatureFeeContribution`) (finding 2). |
| Rekeyed (AuthAddr = X ≠ 0) | Only after a transaction that S has already authorized by one of the paths above. The contract's `AcctAuthAddr` check is meant to exclude this case, but see finding 1. |
| Inner transaction with sender S | Only if AuthAddr(S) is the calling app (`eval.go: authorizedSender`), so this is a subcase of the rekeyed row. |

**What the AVM exposes:** `txn Sender`, `txn RekeyTo`, `txn Fee`, `txn GroupIndex`, `gtxns *`,
`acct_params_get AcctAuthAddr` (the *current* AuthAddr, read after this transaction's own rekey
has been applied), and `global CallerApplicationID`. There is no field for the signature category
or for the transaction's authorizer (`logic/fields.go` up to v13 adds no PQ field), so a contract
cannot tell a top-level `pqsig` from a PQ-delegated lsig.

### Conclusion

- **"Only native f1 PQ accounts can earn":** holds. The SHA-512/256 preimage check with the
  `PQAf1` prefix ties S to a specific Falcon-1024 public key. Every authorization path for S
  roots in that key, except on-curve salts against a quantum adversary (finding 5). Classic
  accounts, multisig, escrow lsigs, app accounts, and Falcon-512 or `ed`-scheme PQ accounts
  cannot register.
- **"Every print is Falcon-authorized":** holds **transitively, not literally.** Every print is
  ultimately authorized by the Falcon key. However:
  - a print may carry a PQ-delegated lsig (one Falcon signature over a program, reused), or
  - it may be signed by an arbitrary key X after a Falcon-authorized rekey to X (finding 1).

  In both cases the printer's account still pays at least 3 × min fee per coupon. The rekey
  path also needs one additional Falcon-authorized transaction per non-Falcon print, so it is
  strictly more expensive. Neither path gives an economic advantage over honest printing.
- **"Each coupon costs at least a Falcon fee that cannot be offloaded":** holds. `print`
  checks its *own* `Fee` field, which is always debited from the sender (`eval.go: takeFee`).
  Fee pooling only lets *other* transactions under-pay at the print's expense, never the
  reverse. (A sponsor can still reimburse the printer in the same group with a payment. That
  is unavoidable and not a contract issue.)

## Findings

### 1. Low: the "not rekeyed" check can be passed by a print that rekeys to itself

**Location:** `contracts/PQCoupon.algo.ts:98-99` (`print`), `:85` (`register`); TEAL 291-297 and
226-231.

**Description.** In `ledger/eval/eval.go`, `applyTransaction` calls `takeFee`, then
`apply.Rekey(cow, &tx)`, then `apply.ApplicationCall(...)`. The authorizer is checked *before*
any of this, against the AuthAddr stored at that moment. Setting `RekeyTo = Sender` resets
AuthAddr to zero (`apply.go: Rekey`, special case). So a print transaction that:

- is sent while S is rekeyed to some key X,
- is signed by X, and
- carries `RekeyTo = S`

passes signature and authorizer checks as X, then has its AuthAddr cleared, and then the
approval program reads `AcctAuthAddr(S) == ZeroAddress` and counts the print. The comment on
line 98 ("Rekeying away from the Falcon key would let a classic key print") describes exactly
the case that is not fully blocked.

**Exploit scenario.**
1. A registered printer S sends a Falcon-signed `pay 0` with `RekeyTo = X`, where X is an
   Ed25519 key or an app.
2. X signs `print()` from S with `Fee = 3000` and `RekeyTo = S`.

The print is counted. With X = app A, the print can even be an inner transaction of A. After
each such print, S is no longer rekeyed, so the next non-Falcon print needs another
Falcon-authorized rekey.

**Impact.** The "each print is itself a Falcon-signed transaction" claim is false. There is no
economic gain:
- the attacker pays for the extra rekey transaction (3 min fees, because it is Falcon-signed);
- the print still pays 3 min fees;
- only one coupon is earned per Falcon-authorized rekey.

No funds or coupon accounting are at risk.

**Recommended fix.** In `print` (and `register` for consistency), add
`assert(this.txn.rekeyTo === globals.zeroAddress)`. Optionally also add
`assert(globals.callerApplicationID === 0)` to forbid inner-transaction prints outright. With
the `RekeyTo` check, an inner print is already impossible, because it would need S to be
rekeyed to the caller app. The app is immutable, so this needs a redeploy. Otherwise, document
it.

### 2. Informational: PQ-delegated LogicSigs can print without a per-transaction Falcon signature

**Location:** design assumption, `PQCoupon.algo.ts:13-15`, `96-105`.

**Description.** go-algorand 5.0.3 has `LogicSig.PQsig` (PR #6663). A Falcon signature over
`PQDelegatedProgram{Addr: S, Program}` (HashID "PQProgram") authorizes any transaction from S
that the program approves (`verify/txn.go`, lines 486-492 at v5.0.3). The contract cannot detect
this (see the AVM-exposure note above).

Each delegated-lsig transaction still:
- carries the Falcon public key and signature, which are re-verified;
- pays the Falcon-1024 fee contribution (`signedtxn.go: signatureFeeContribution` checks
  `Lsig.PQsig`);
- passes `Fee >= 3 × MinTxnFee`.

**Scenario.** A printer delegates `txn ApplicationID == <coupon app>` once. Afterwards a bot
holding the delegated lsig prints indefinitely from S, paying S's fees, and never touches the
Falcon secret key again. Anyone else who obtains the lsig can also burn S's balance on prints.
The coupons still go only to S's beneficiary.

**Recommendation.** Document that "Falcon-authorized" includes Falcon-delegated programs. If a
fresh Falcon signature per transaction is a hard requirement, it cannot be enforced on-chain
today. The only option is off-chain filtering by inspecting `pqsig` versus `lsig.pqsig` in
blocks.

### 3. Low: fixed beneficiary plus all-or-nothing claim lets the deposit and coupons be locked

**Location:** `PQCoupon.algo.ts:80, 92` (beneficiary stored, never changeable), `:118-125` (the
axfer reverts the whole claim); client `src/utils/pqPrinter.ts:372-385` (claim and close are
atomic).

**Description.** `claim()` sends `count × 1e6` PQPRINT to the stored beneficiary. If the
beneficiary is not opted in, the inner axfer fails and the whole call reverts. This happens if:
- it never opted in;
- it opted out (asset close-out) after registration;
- it is the zero address or another address nobody can sign for, such as an exchange deposit
  address or an app that cannot opt in.

There is no method to change the beneficiary, and `register` accepts any 32 bytes, including
`ZeroAddress`. With `count == 0` the axfer is skipped, so the printer can always recover the
deposit if it never printed.

**Exploit scenario.**
1. A printer registers with beneficiary B, which is a third party or a mistyped address.
2. It prints 10,000 times (≈30 ALGO of fees).
3. B refuses to opt in, or opts out to grief.
4. `claim` always fails, so the 31,700 µA deposit and 10,000 PQPRINT are locked until B
   cooperates, possibly forever.

In the wen.tools client, `closeOut` always bundles `claim` with the close-out payment whenever
the box exists. The atomic group fails, the client throws, and the UI offers no path to close
the printer account without claiming. The printer's remaining ALGO stays in the PQ account
until the user builds a manual close-out.

The UI does check opt-in before *registration* (`PQTxPrinter.tsx:307`), which prevents the
common case, but not a later opt-out.

**Recommended fix.** In the contract (redeploy), any of these:
- `claim(receiver: Address)` callable by the printer, defaulting to the beneficiary;
- `setBeneficiary(address)`, printer only;
- assert `beneficiary != zeroAddress` at `register`, and on `claim` skip the axfer (keeping
  `count`) or refund only the deposit if the beneficiary cannot receive (`asset_holding_get`).

In the client: if the claim fails because the beneficiary is not opted in, offer a close-out
without claim (forfeiting the deposit) or a prompt to opt in. Re-check opt-in before close-out.

### 4. Medium (client): a transient lookup error makes close-out skip the claim

**Location:** `src/utils/pqCoupon.ts:42-55` (`catch { return null; }`); `src/utils/pqPrinter.ts:366-374`.

**Description.** `getPendingCoupons` maps *every* error to `null`, including network failures,
timeouts, 429 and 5xx responses, and SDK decoding errors, not just HTTP 404 "box not found".
`closeOut` interprets `null` as "not registered". It then omits the claim and sends only the
close-out payment, which succeeds: the PQ account is closed to `refundTo`. The box (31,700 µA
deposit and all pending coupons) stays on the app, keyed to a now-empty account.

The UI then marks the session `closed: true` (`PQTxPrinter.tsx:360-361`). After that,
`handleDiscard` deletes the Falcon key without any warning, because the confirmation is skipped
for closed sessions. Once the key is gone, the deposit and coupons are unrecoverable.

At the start of `runPrinter`, the same mis-classification only causes a doomed `register`,
which the contract rejects, so it is harmless there.

**Exploit / failure scenario.**
1. A user prints 5,000 coupons.
2. The algonode box lookup returns a 503 at close-out time.
3. The account closes without claiming.
4. The user discards the session.
5. 5,000 PQPRINT and 0.0317 ALGO are permanently stranded.

**Recommended fix.**
- Return `null` only for a 404 (`e.status === 404` / `response.status`) and rethrow other
  errors.
- In `closeOut`, abort if the coupon status cannot be determined.
- Before clearing a closed session, check that the coupon box no longer exists.

### 5. Informational: non-canonical (on-curve) salts are accepted

**Location:** `PQCoupon.algo.ts:84`.

**Description.** `register` accepts any salt byte. Consensus accepts any salt too:
`pqsig.go: validateEnvelope` only compares the derived address. "Canonical" means the lowest
salt whose hash is *not* an Ed25519 point, and that rule (`IsPQCompliant`) is enforced only by
algod's REST handler (`handlers.go: enforcePQAuthorizerCompliance`), which can be bypassed with
`skip-pq-address-check`.

About half of the salts give addresses that decode as Ed25519 points. For those, an Ed25519
signature verified against S would be valid if someone knew the discrete log. That is
classically infeasible for a hash output, but it is exactly what a quantum adversary can
compute. Such an adversary could print for an on-curve PQ address with Ed25519 signatures,
still paying the 3× fee.

**Recommendation.** No practical classical risk. Checking curve membership in TEAL would need
255-bit field arithmetic, which is costly. Document that the property relies on canonical
(off-curve) salts, or have the client and indexer ignore non-canonical registrations.

### 6. Informational: hard-coded box MBR

**Location:** `PQCoupon.algo.ts:33, 89`; TEAL 248-254 and 463.

**Description.** The math is correct for current parameters:
- key = `"p"` (1 byte) + address (32 bytes) = 33 bytes;
- value = address (32 bytes) + uint64 (8 bytes) = 40 bytes;
- MBR = 2500 + 400 × 73 = **31,700 µA**. This matches the testnet result (the app's min
  balance returned to exactly 200,000 after the test claim).

If a future consensus version changed `BoxFlatMinBalance` or `BoxByteMinBalance`:
- an increase would make `register` fail (app below minimum balance) until someone over-funds
  the app;
- a decrease would leave surplus in the app.

Existing claims stay safe in both directions: the refund equals the deposit taken, and box
deletion frees at least as much MBR as the refund whenever MBR has gone up. No drain is possible.

**Recommendation.** Accept, or measure `minBalance` before and after `box_put` as WenPad does.

### 7. Informational: ARC-4 decoding is lenient

**Location:** TEAL 158-169, 491-498.

**Description.**
- `pqKey` is decoded with `extract 2 0`. The 2-byte ARC-4 length prefix is dropped without
  checking that it matches the actual length. This is the class of issue in the Oct 2025
  compiler disclosure.
- Extra `ApplicationArgs` are ignored.
- `address` arguments *are* length-checked (`len == 32`).

This is safe as used: the contract checks `len(pqKey) == 1794` on the real bytes, and hashes
those bytes. The register arguments total 4 + 1796 + 32 = 1832 bytes, within the 2048-byte
classic limit.

**Recommendation.** None needed. Note it for off-chain indexers that decode the arguments.

### 8. Informational: `mbrPay` only checks receiver and amount

**Location:** `PQCoupon.algo.ts:87-90`; TEAL 239-254.

**Description.** Not checked: `Sender`, `CloseRemainderTo`, `RekeyTo`, or that the type is not
something else. The type *is* checked as `pay` (TEAL 146-155).

- A third party may pay the deposit. The refund then goes to the printer (`txn Sender`), not to
  the payer.
- A `CloseRemainderTo` or `RekeyTo` on the deposit payment only affects whoever signed it. A
  PQ printer that rekeys in `mbrPay` fails its own `register` on the `AcctAuthAddr` check.

The app always receives exactly 31,700 µA.

**Recommendation.** None required. Optionally assert `mbrPay.sender == txn.sender` to match the
refund destination.

### 9. Informational: empty clear-state program

**Location:** `contracts/build/PQCoupon.clear.teal` (on chain: `Cg==`).

**Description.** A program with no opcodes ends with an empty stack, so evaluation fails.
ClearState still removes local state regardless, and this app has no local state and rejects
OptIn. There is no impact.

### 10. Informational: test coverage

**Location:** `contracts/test/pq-coupon.testnet.ts`.

**Coverage gaps:**
- The "offloaded fee" case (lines 184-191) passes no regex to `expectReject`, so it would also
  pass if the group were rejected for an unrelated reason. In that group, the 4,000 µA pooled
  fee does cover the protocol requirement (1 + 3 min fees), so the rejection should come from
  the contract assert. Match `/assert/` to make the test prove it.
- Not covered:
  - claim with the beneficiary not opted in (finding 3);
  - a print with `RekeyTo = Sender` while rekeyed (finding 1);
  - a print rekeying *away* (should fail);
  - claim with `count == 0`;
  - re-registering after a claim;
  - a third-party claim attempt;
  - update and delete attempts;
  - `pending()` for unregistered and registered printers.

## Verified properties (no finding)

- **Immutability.** The routing switch (`!ApplicationID × 6 + OnCompletion`) maps only
  create-NoOp and call-NoOp to code. OptIn, CloseOut, UpdateApplication and DeleteApplication
  hit `err`. There is no `RejectVersion`/`AppVersion` path, so v42 `AppSizeUpdates` is
  unreachable.
- **No admin over PQPRINT.** `bootstrap` is creator-only (`txn Sender == global CreatorAddress`)
  and runs once (`!app_global_get_ex c`). The inner `acfg` sets no manager, freeze or clawback;
  inner fields default to the zero address, as the on-chain ASA confirms.
- **Only `claim` moves PQPRINT.** The only axfer is in `claim`, to the beneficiary stored in the
  *caller's own* box, for `count × 1,000,000` units. `count` only increases by 1 per `print`.
- **No double claim.** `box_del` comes before both inner transactions; a second claim fails
  the `box_len` assert.
- **No claiming someone else's coupons.** Every box key is `"p" ‖ txn Sender`. `pending()` is
  read-only.
- **No read after `box_del`.** `beneficiary` and `count` are copied into frame slots before
  `box_del` (TEAL 375-401). After the delete, only `frame_dig` values and `txn Sender` are used.
  This is the bug class found in WenPad, and it is absent here.
- **App ALGO cannot be drained.**
  - The only payment is 31,700 µA to `txn Sender`, after deleting that sender's box. That
    frees exactly 31,700 µA of MBR that the sender deposited.
  - All inner fees are 0, so the outer caller pays.
  - The app holds exactly its minimum balance (200,000 µA) on testnet, and any surplus can only
    come from donations.
- **The app cannot get stuck.** Nothing shared can be griefed: bootstrap is creator-only, and
  boxes are per printer. A failing claim affects only that printer (finding 3).
- **Re-registration after a claim** creates a fresh box with `count = 0` and a fresh deposit,
  and is correct. `totalPrints` is lifetime and never decremented, which matches its comment.
- **Integer overflow.**
  - `count × 1e6` overflows only above 1.8 × 10^13 prints, which would cost more than 5 × 10^16
    µA in fees, more than the total ALGO supply.
  - The supply of 2^64-1 base units covers every possible claim.
  - `count + 1` and `totalPrints + 1` cannot overflow in practice.
- **Fee check.** `print` asserts its own `Fee >= 3 × MinTxnFee`; see the conclusion above.
  `register` and `claim` have no fee floor, which is fine.
- **Register binding.** `register` cannot be front-run or done on someone else's behalf: the
  box key is the transaction sender, and the address preimage must hash to that sender.
- **Deployed bytecode** matches `PQCoupon.approval.teal`, and the ARC-4/ARC-56 schema (2 global
  ints) matches.

## Client review notes (no further findings)

- **Register group** `[deposit pay, register]`: correct order for `GroupIndex - 1`. Both
  transactions are Falcon-signed at 3 × min fee, and the box reference is included.
- **Print transactions**: each pays its own 3 × min fee, the notes are short (no
  `PerByteTxnSurcharge`), and groups are at most 16.
- **Claim + close**: claim comes first, then the close payment with
  `CloseRemainderTo = refundTo`. The claim fee is 3 × min fee + 2 inner fees. With
  `count == 0` there is only one inner transaction, so the client overpays one min fee
  (trivial). The reserve math (`couponReserve`) keeps the claim fee back, and the close fee is
  covered by the released minimum balance.
- **Refund target**: the UI blocks a refund target equal to the printer, and requires opt-in
  before registering.

## Remediation (applied after this review)

The review above was performed against testnet app 774340680. The following changes were made
afterwards, the contract was recompiled, and it was redeployed to testnet as app **774341440**
(PQPRINT ASA **774341444**). `contracts/test/pq-coupon.testnet.ts` now passes 15 checks against it.

| # | Finding | Status | Change |
|---|---|---|---|
| 1 | Rekey-to-self passes the "not rekeyed" check | Fixed | `register` and `print` call `assertNotRekeyed()`, which also requires `txn RekeyTo == ZeroAddress`. Test: "rejects a print carrying a RekeyTo". |
| 2 | PQ-delegated LogicSigs can print | Accepted | Every such print is still authorized by a Falcon signature (over the program) and still pays the 3 × min fee checked by `print`. Documented, not preventable from the AVM. |
| 3 | Fixed beneficiary can lock deposit and coupons | Fixed | `register` requires a non-zero beneficiary already opted in to PQPRINT. `claim` no longer reverts if the beneficiary has since opted out: it forfeits the coupons (they stay with the app) and still deletes the box and refunds the deposit. Tests: "rejects the zero address as beneficiary", "rejects a beneficiary not opted in", "beneficiary opted out: claim forfeits coupons but still refunds the deposit and closes". |
| 4 | Transient lookup error skips the claim (client) | Fixed | `getPendingCoupons` returns null only on HTTP 404 and rethrows anything else, so close-out aborts instead of closing without a claim. Close-out also reports forfeited coupons as 0. |
| 5–9 | Informational | Accepted | No change. |
| 10 | Test coverage | Improved | Fee-offload rejection now asserts the failure reason; new cases above. |
