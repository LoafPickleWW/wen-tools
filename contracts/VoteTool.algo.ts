/**
 * On-chain Vote Tool (vote.wen.tools) — Algorand TypeScript (puya-ts), AVM v13.
 *
 *   npx puya-ts contracts/VoteTool.algo.ts --out-dir contracts/build/vote
 *
 * VoteFactory (deployed once, creator = deployer)
 *   ├─ VoteRegistry  (inner-created → creator = factory address)
 *   ├─ VoterList #n  (inner-created → creator = factory address)
 *   └─ Vote #n       (inner-created → creator = factory address)
 *
 * Every child shares the factory address as creator, so they form one box-access "family".
 * Only the registry turns on FamilyBoxAccess: votes write their live totals and final status
 * straight into the registry's boxes. Votes and voter lists only turn on ForeignBoxReads
 * (read-only), so a sibling app can never write into a vote's ballots or tallies.
 *
 * Vote modes
 *   ESCROW (0) "hard vote": voters send the asset to the vote app. It is returned or paid out at
 *              the end, depending on the return mode.
 *   HELD   (1) weight = balance ÷ amountPerVote, read from the voter's wallet. Nothing moves.
 *   NFT    (2) each held piece of a collection (creator in the list, optional unit-name prefix) is one vote,
 *              read from the voter's wallet. Each piece can only be counted once.
 *
 * Read-only modes are protected with recounts. Until the vote ends, anyone can lower a ballot to the
 * voter's current balance (HELD) or remove an NFT the voter no longer holds (NFT), so moving
 * tokens to a second wallet and voting again doesn't pay off.
 */
import {
  Account,
  Application,
  Asset,
  Box,
  BoxMap,
  Bytes,
  Contract,
  Global,
  GlobalState,
  OnCompleteAction,
  Txn,
  Uint64,
  abimethod,
  assert,
  baremethod,
  bytes,
  clone,
  contract,
  gtxn,
  itxn,
  op,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { compileArc4 } from '@algorandfoundation/algorand-typescript/arc4'

export const MODE_ESCROW: uint64 = 0
export const MODE_HELD: uint64 = 1
export const MODE_NFT: uint64 = 2

export const RETURN_SENDERS: uint64 = 0
export const RETURN_ADDRESS: uint64 = 1
export const RETURN_WINNER: uint64 = 2

export const STATUS_ACTIVE: uint64 = 0
export const STATUS_FINALIZED: uint64 = 1
export const STATUS_CANCELLED: uint64 = 2
export const STATUS_CLOSED: uint64 = 3

const MAX_OPTIONS: uint64 = 16
/** Sentinel winner value: no votes, or a tie. */
const NO_WINNER: uint64 = 2 ** 64 - 1
/** Default payout grace, ~1 week. If a payout can't be delivered this long after the end, voters get refunds. */
export const DEFAULT_PAYOUT_GRACE: uint64 = 200_000

// Registry record layout: fixed 104 bytes, so votes can patch single fields with app_box_replace.
const REC_SIZE: uint64 = 104
const REC_STATUS: uint64 = 72
const REC_WINNER: uint64 = 80
const REC_WEIGHT: uint64 = 88

export type VoteConfig = {
  mode: uint64
  /** Vote asset (ESCROW / HELD). 0 for NFT mode. */
  asset: uint64
  /** Base units per 1 vote (ESCROW / HELD). Ignored for NFT mode. */
  amountPerVote: uint64
  /** 0 = start now. */
  startRound: uint64
  endRound: uint64
  returnMode: uint64
  returnAddress: Account
  /** Optional eligibility gate: app whose boxes list allowed voters. 0 = anyone can vote. */
  gateApp: uint64
  /** Box-name prefix in the gate app, followed by the voter's 32-byte address (e.g. "b"). */
  gatePrefix: bytes
}

export type VoteOption = {
  title: string
  description: string
  /** Gets the pool in RETURN_WINNER mode. */
  recipient: Account
}

/**
 * NFT mode: which assets count as collection pieces. A piece counts when its creator is one of
 * `creators` (collections are often minted from several wallets) and, if `unitPrefix` is set, its
 * unit name starts with it (e.g. "WEN" matches WEN001, WEN002…).
 */
export type CollectionRule = {
  creators: Account[]
  unitPrefix: bytes
}

export const MAX_CREATORS: uint64 = 8

export type Ballot = {
  option: uint64
  /** ESCROW: base units deposited. HELD: balance counted. NFT: pieces counted. */
  amount: uint64
  weight: uint64
}

/* ------------------------------------------------------------------------------------------ */

@contract({ avmVersion: 13 })
export class VoteRegistry extends Contract {
  factory = GlobalState<uint64>({ key: 'factory' })

  @abimethod({ onCreate: 'require' })
  createApplication(): void {
    this.factory.value = Global.callerApplicationId
    // Votes (same creator: the factory) patch their own entries in place.
    op.AppParamsSet.appFamilyBoxAccess(true)
    // Anyone, including other contracts, can read the index of votes.
    op.AppParamsSet.appForeignBoxReads(true)
  }
}

/* ------------------------------------------------------------------------------------------ */

/** Allowlist of voters, managed by its owner. Box "b" + address = allowed. Usable as a vote gate. */
@contract({ avmVersion: 13 })
export class VoterList extends Contract {
  factory = GlobalState<uint64>({ key: 'factory' })
  owner = GlobalState<Account>({ key: 'owner' })
  count = GlobalState<uint64>({ key: 'count' })
  voters = BoxMap<Account, bytes>({ keyPrefix: 'b' })

  @abimethod({ onCreate: 'require' })
  createApplication(owner: Account): void {
    this.factory.value = Global.callerApplicationId
    this.owner.value = owner
    this.count.value = 0
    op.AppParamsSet.appForeignBoxReads(true)
  }

  /** No-op. Clients add it to a group for extra reference slots. */
  opUp(): void {}

  /** Add voters. `pay` covers the new boxes' MBR. Any surplus is returned. */
  add(pay: gtxn.PaymentTxn, addresses: Account[]): void {
    assert(Txn.sender === this.owner.value, 'owner only')
    assert(pay.receiver === Global.currentApplicationAddress, 'pay the list')
    const before = Global.currentApplicationAddress.minBalance
    for (const a of addresses) {
      if (!this.voters(a).exists) {
        this.voters(a).value = Bytes('1')
        this.count.value += 1
      }
    }
    const cost: uint64 = Global.currentApplicationAddress.minBalance - before
    assert(pay.amount >= cost, 'MBR not covered')
    if (pay.amount > cost) {
      itxn.payment({ receiver: Txn.sender, amount: pay.amount - cost, fee: 0 }).submit()
    }
  }

  /** Called by the factory's closeVoterList once the list is empty. Remaining ALGO goes to the owner. */
  @abimethod({ allowActions: 'DeleteApplication' })
  close(): void {
    assert(Global.callerApplicationId === this.factory.value, 'close through the factory')
    assert(this.count.value === 0, 'remove every voter first')
    itxn.payment({ receiver: this.owner.value, closeRemainderTo: this.owner.value, amount: 0, fee: 0 }).submit()
  }

  /** Remove voters and refund their box MBR to the owner. */
  remove(addresses: Account[]): void {
    assert(Txn.sender === this.owner.value, 'owner only')
    const before = Global.currentApplicationAddress.minBalance
    for (const a of addresses) {
      if (this.voters(a).exists) {
        this.voters(a).delete()
        this.count.value -= 1
      }
    }
    const freed: uint64 = before - Global.currentApplicationAddress.minBalance
    if (freed > 0) {
      itxn.payment({ receiver: this.owner.value, amount: freed, fee: 0 }).submit()
    }
  }
}

/* ------------------------------------------------------------------------------------------ */

@contract({ avmVersion: 13 })
export class Vote extends Contract {
  factory = GlobalState<uint64>({ key: 'factory' })
  registry = GlobalState<uint64>({ key: 'registry' })
  voteNo = GlobalState<uint64>({ key: 'vote_no' })
  creator = GlobalState<Account>({ key: 'creator' })
  mode = GlobalState<uint64>({ key: 'mode' })
  asset = GlobalState<uint64>({ key: 'asset' })
  amountPerVote = GlobalState<uint64>({ key: 'apv' })
  startRound = GlobalState<uint64>({ key: 'start' })
  endRound = GlobalState<uint64>({ key: 'end' })
  returnMode = GlobalState<uint64>({ key: 'return_mode' })
  returnAddress = GlobalState<Account>({ key: 'return_addr' })
  gateApp = GlobalState<uint64>({ key: 'gate_app' })
  gatePrefix = GlobalState<bytes>({ key: 'gate_prefix' })
  optionCount = GlobalState<uint64>({ key: 'options' })
  status = GlobalState<uint64>({ key: 'status' })
  winner = GlobalState<uint64>({ key: 'winner' })
  totalWeight = GlobalState<uint64>({ key: 'total_weight' })
  /** ESCROW: base units held for voters (sum of open ballots, or the pool before payout). */
  totalEscrow = GlobalState<uint64>({ key: 'escrow' })
  voters = GlobalState<uint64>({ key: 'voters' })
  openBallots = GlobalState<uint64>({ key: 'open_ballots' })
  openNfts = GlobalState<uint64>({ key: 'open_nfts' })
  payoutPending = GlobalState<boolean>({ key: 'payout_pending' })
  paidTo = GlobalState<Account>({ key: 'paid_to' })
  payoutGrace = GlobalState<uint64>({ key: 'grace' })

  meta = Box<{ title: string; description: string }>({ key: 'm' })
  options = BoxMap<uint64, VoteOption>({ keyPrefix: 'o' })
  /** 16 × uint64 tallies, one per option. */
  tally = Box<bytes>({ key: 't' })
  ballots = BoxMap<Account, Ballot>({ keyPrefix: 'b' })
  /** NFT mode: asset ID → voter who counted it. */
  nfts = BoxMap<uint64, Account>({ keyPrefix: 'n' })
  /** NFT mode: which assets count (creators + optional unit-name prefix). */
  collection = Box<CollectionRule>({ key: 'c' })

  // ---------------------------------------------------------------- lifecycle

  @abimethod({ onCreate: 'require' })
  createApplication(registry: uint64, voteNo: uint64, creator: Account, config: VoteConfig, optionCount: uint64, payoutGrace: uint64): void {
    this.factory.value = Global.callerApplicationId
    this.registry.value = registry
    this.voteNo.value = voteNo
    this.creator.value = creator
    this.mode.value = config.mode
    this.asset.value = config.asset
    this.amountPerVote.value = config.mode === MODE_NFT ? Uint64(1) : config.amountPerVote
    this.startRound.value = config.startRound === 0 ? Global.round : config.startRound
    this.endRound.value = config.endRound
    this.returnMode.value = config.mode === MODE_ESCROW ? config.returnMode : RETURN_SENDERS
    this.returnAddress.value = config.returnAddress
    this.gateApp.value = config.gateApp
    this.gatePrefix.value = config.gatePrefix
    this.optionCount.value = optionCount
    this.status.value = STATUS_ACTIVE
    this.winner.value = NO_WINNER
    this.totalWeight.value = 0
    this.totalEscrow.value = 0
    this.voters.value = 0
    this.openBallots.value = 0
    this.openNfts.value = 0
    this.payoutPending.value = false
    this.paidTo.value = Global.zeroAddress
    this.payoutGrace.value = payoutGrace
  }

  /**
   * Called once by the factory right after funding. Writes metadata, opts into the vote asset,
   * creates this vote's registry entry (a box in ANOTHER app: the v13 family write), then returns
   * any unused funding to the creator.
   */
  init(title: string, description: string, options: VoteOption[], collection: CollectionRule): void {
    assert(Global.callerApplicationId === this.factory.value, 'factory only')
    assert(!this.tally.exists, 'already initialised')
    assert(options.length === this.optionCount.value, 'option count')

    op.AppParamsSet.appForeignBoxReads(true)

    this.meta.value = { title: title, description: description }
    if (this.mode.value === MODE_NFT) {
      this.collection.value = clone(collection)
    }
    for (let i: uint64 = 0; i < options.length; i += 1) {
      this.options(i).value = clone(options[i])
    }
    this.tally.create({ size: MAX_OPTIONS * 8 })

    if (this.mode.value === MODE_ESCROW) {
      itxn
        .assetTransfer({ xferAsset: this.asset.value, assetReceiver: Global.currentApplicationAddress, assetAmount: 0, fee: 0 })
        .submit()
    }

    // Registry entry, paid for by this vote's funding.
    const registry = Application(this.registry.value)
    const regBefore = registry.address.minBalance
    const key = this.registryKey()
    op.AppBox.create(registry, key, REC_SIZE)
    op.AppBox.put(
      registry,
      key,
      op.itob(Global.currentApplicationId.id)
        .concat(this.creator.value.bytes)
        .concat(op.itob(this.mode.value))
        .concat(op.itob(this.asset.value))
        .concat(op.itob(this.startRound.value))
        .concat(op.itob(this.endRound.value))
        .concat(op.itob(STATUS_ACTIVE))
        .concat(op.itob(NO_WINNER))
        .concat(op.itob(0))
        .concat(op.itob(0)),
    )
    itxn.payment({ receiver: registry.address, amount: registry.address.minBalance - regBefore, fee: 0 }).submit()

    const app = Global.currentApplicationAddress
    if (app.balance > app.minBalance) {
      itxn.payment({ receiver: this.creator.value, amount: app.balance - app.minBalance, fee: 0 }).submit()
    }
  }

  /** Creator may change the program only before voting starts. After that the rules are locked. */
  @baremethod({ allowActions: 'UpdateApplication' })
  updateApplication(): void {
    assert(Txn.sender === this.creator.value, 'creator only')
    assert(Global.round < this.startRound.value, 'locked: voting has started')
    assert(this.status.value === STATUS_ACTIVE, 'not active')
  }

  // ---------------------------------------------------------------- voting

  /** Hard vote: deposit the vote asset. Calling again adds to (and can move) your ballot. */
  voteEscrow(pay: gtxn.PaymentTxn, deposit: gtxn.AssetTransferTxn, option: uint64): void {
    this.assertVoting(MODE_ESCROW)
    assert(deposit.sender === Txn.sender, 'deposit sender')
    assert(deposit.xferAsset === Asset(this.asset.value), 'wrong asset')
    assert(deposit.assetReceiver === Global.currentApplicationAddress, 'deposit receiver')
    assert(deposit.assetCloseTo === Global.zeroAddress, 'no close-to')
    assert(deposit.assetAmount > 0, 'empty deposit')
    assert(deposit.assetAmount % this.amountPerVote.value === 0, 'deposit must be a whole number of votes')

    const before = Global.currentApplicationAddress.minBalance
    const old = this.ballotOf(Txn.sender)
    const amount: uint64 = old.amount + deposit.assetAmount
    this.applyBallot(Txn.sender, option, amount, amount / this.amountPerVote.value)
    this.totalEscrow.value += deposit.assetAmount
    this.settleMbr(pay, before)
  }

  /** Tokens held: weight is read from your wallet. Calling again refreshes it and can change your option. */
  voteHeld(pay: gtxn.PaymentTxn, option: uint64): void {
    this.assertVoting(MODE_HELD)
    const [balance, optedIn] = op.AssetHolding.assetBalance(Txn.sender, this.asset.value)
    assert(optedIn, 'not opted in to the vote asset')
    const weight: uint64 = balance / this.amountPerVote.value
    assert(weight > 0, 'balance below one vote')

    const before = Global.currentApplicationAddress.minBalance
    this.applyBallot(Txn.sender, option, balance, weight)
    this.settleMbr(pay, before)
  }

  /** NFT collection: each held piece is one vote and can only be counted once. */
  voteNft(pay: gtxn.PaymentTxn, option: uint64, assets: uint64[]): void {
    this.assertVoting(MODE_NFT)
    const before = Global.currentApplicationAddress.minBalance
    let added: uint64 = 0
    const rule = clone(this.collection.value)
    for (const id of assets) {
      assert(this.isPiece(rule, id), 'not in collection')
      const [held] = op.AssetHolding.assetBalance(Txn.sender, id)
      assert(held > 0, 'piece not held')
      assert(!this.nfts(id).exists, 'piece already voted')
      this.nfts(id).value = Txn.sender
      added += 1
    }
    const old = this.ballotOf(Txn.sender)
    assert(added > 0 || this.ballots(Txn.sender).exists, 'no pieces')
    this.openNfts.value += added
    this.applyBallot(Txn.sender, option, old.amount + added, old.weight + added)
    this.settleMbr(pay, before)
  }

  // ---------------------------------------------------------------- recounts (read-only modes)

  /** HELD: lower a ballot to the voter's current balance. Anyone can call until the vote ends. */
  recount(voter: Account): void {
    assert(this.mode.value === MODE_HELD, 'held mode only')
    assert(this.status.value === STATUS_ACTIVE && Global.round <= this.endRound.value, 'vote over')
    assert(this.ballots(voter).exists, 'no ballot')
    const b = clone(this.ballots(voter).value)
    const [balance] = op.AssetHolding.assetBalance(voter, this.asset.value)
    const weight: uint64 = balance / this.amountPerVote.value
    if (weight < b.weight) {
      this.applyBallot(voter, b.option, balance, weight)
    }
  }

  /** NFT: remove a piece its voter no longer holds, so the new holder can vote with it. */
  recountNft(assetId: uint64): void {
    assert(this.mode.value === MODE_NFT, 'nft mode only')
    assert(this.status.value === STATUS_ACTIVE && Global.round <= this.endRound.value, 'vote over')
    assert(this.nfts(assetId).exists, 'piece not voted')
    const voter = this.nfts(assetId).value
    const [held] = op.AssetHolding.assetBalance(voter, assetId)
    assert(held === 0, 'still held')

    const before = Global.currentApplicationAddress.minBalance
    this.nfts(assetId).delete()
    this.openNfts.value -= 1
    const b = clone(this.ballots(voter).value)
    this.applyBallot(voter, b.option, b.amount - 1, b.weight - 1)
    this.refundMbr(voter, before)
  }

  // ---------------------------------------------------------------- ending

  /** Anyone, after the end round. Records the winner and decides where escrowed tokens go. */
  finalize(): void {
    assert(this.status.value === STATUS_ACTIVE, 'not active')
    assert(Global.round > this.endRound.value, 'still running')

    let best: uint64 = NO_WINNER
    let bestWeight: uint64 = 0
    let tie = false
    for (let i: uint64 = 0; i < this.optionCount.value; i += 1) {
      const w = this.tallyOf(i)
      if (w > bestWeight) {
        best = i
        bestWeight = w
        tie = false
      } else if (w === bestWeight && w > 0) {
        tie = true
      }
    }
    if (tie) best = NO_WINNER
    this.winner.value = best

    if (this.mode.value === MODE_ESCROW) {
      if (this.returnMode.value === RETURN_WINNER && best === NO_WINNER) {
        // Nobody won (tie or no votes): everyone gets their tokens back.
        this.returnMode.value = RETURN_SENDERS
      }
      this.payoutPending.value = this.returnMode.value !== RETURN_SENDERS && this.totalEscrow.value > 0
    }
    this.status.value = STATUS_FINALIZED
    this.patchRegistry(REC_STATUS, STATUS_FINALIZED)
    this.patchRegistry(REC_WINNER, best)
  }

  /** Anyone. Sends the whole pool to the return address or the winning option's recipient. */
  payout(): void {
    assert(this.payoutPending.value, 'no payout pending')
    const to: Account =
      this.returnMode.value === RETURN_ADDRESS ? this.returnAddress.value : this.options(this.winner.value).value.recipient
    itxn.assetTransfer({ xferAsset: this.asset.value, assetReceiver: to, assetAmount: this.totalEscrow.value, fee: 0 }).submit()
    this.totalEscrow.value = 0
    this.payoutPending.value = false
    this.paidTo.value = to
  }

  /** Anyone. If the payout target can't receive (not opted in) for `grace` rounds, refund voters instead. */
  fallbackToRefunds(): void {
    assert(this.payoutPending.value, 'no payout pending')
    assert(Global.round > this.endRound.value + this.payoutGrace.value, 'grace period')
    this.returnMode.value = RETURN_SENDERS
    this.payoutPending.value = false
  }

  /** Creator can cancel before the end. Nobody wins and escrowed tokens are refunded. */
  cancel(): void {
    assert(Txn.sender === this.creator.value, 'creator only')
    assert(this.status.value === STATUS_ACTIVE, 'not active')
    assert(Global.round <= this.endRound.value, 'already ended')
    this.status.value = STATUS_CANCELLED
    this.returnMode.value = RETURN_SENDERS
    this.patchRegistry(REC_STATUS, STATUS_CANCELLED)
  }

  /**
   * Anyone, once finalized or cancelled. Deletes a ballot and returns its MBR to the voter. In
   * refund mode it also returns the voter's escrowed tokens.
   */
  release(voter: Account): void {
    this.assertEnded()
    assert(this.ballots(voter).exists, 'no ballot')
    const b = clone(this.ballots(voter).value)
    const before = Global.currentApplicationAddress.minBalance
    this.ballots(voter).delete()
    this.openBallots.value -= 1
    if (this.mode.value === MODE_ESCROW && this.returnMode.value === RETURN_SENDERS && b.amount > 0) {
      itxn.assetTransfer({ xferAsset: this.asset.value, assetReceiver: voter, assetAmount: b.amount, fee: 0 }).submit()
      this.totalEscrow.value -= b.amount
    }
    this.refundMbr(voter, before)
  }

  /** Anyone, once finalized or cancelled. Deletes an NFT record and returns its MBR to the voter. */
  releaseNft(assetId: uint64): void {
    this.assertEnded()
    assert(this.nfts(assetId).exists, 'piece not voted')
    const voter = this.nfts(assetId).value
    const before = Global.currentApplicationAddress.minBalance
    this.nfts(assetId).delete()
    this.openNfts.value -= 1
    this.refundMbr(voter, before)
  }

  /**
   * Called by the factory's closeVote (anyone can trigger it) after every ballot is released.
   * Sends any stray tokens and all remaining ALGO to the creator, marks the registry entry closed,
   * and deletes the app. The factory then refunds the app's creation deposit to the creator.
   */
  @abimethod({ allowActions: 'DeleteApplication' })
  close(): void {
    assert(Global.callerApplicationId === this.factory.value, 'close through the factory')
    this.assertEnded()
    assert(this.openBallots.value === 0 && this.openNfts.value === 0, 'release ballots first')

    if (this.mode.value === MODE_ESCROW) {
      const asset = Asset(this.asset.value)
      const app = Global.currentApplicationAddress
      // Close-to the asset creator always works; use the vote creator if they can receive strays.
      const strays = asset.balance(app)
      const to: Account = strays > 0 && this.creator.value.isOptedIn(asset) ? this.creator.value : asset.creator
      itxn.assetTransfer({ xferAsset: asset, assetReceiver: to, assetCloseTo: to, assetAmount: 0, fee: 0 }).submit()
    }
    this.meta.delete()
    if (this.collection.exists) this.collection.delete()
    this.tally.delete()
    for (let i: uint64 = 0; i < this.optionCount.value; i += 1) {
      this.options(i).delete()
    }
    this.status.value = STATUS_CLOSED
    this.patchRegistry(REC_STATUS, STATUS_CLOSED)
    itxn.payment({ receiver: this.creator.value, closeRemainderTo: this.creator.value, amount: 0, fee: 0 }).submit()
  }

  /** No-op. Clients add it to a group for extra reference slots / opcode budget. */
  opUp(): void {}

  // ---------------------------------------------------------------- reads

  @abimethod({ readonly: true })
  getTallies(): uint64[] {
    const out: uint64[] = []
    for (let i: uint64 = 0; i < this.optionCount.value; i += 1) {
      out.push(this.tallyOf(i))
    }
    return out
  }

  // ---------------------------------------------------------------- internals

  private assertVoting(mode: uint64): void {
    assert(this.mode.value === mode, 'wrong vote method for this mode')
    assert(this.status.value === STATUS_ACTIVE, 'vote closed')
    assert(Global.round >= this.startRound.value, 'not started')
    assert(Global.round <= this.endRound.value, 'ended')
    if (this.gateApp.value !== 0) {
      // v13 cross-app box read: is this voter listed in the gate app?
      const [, listed] = op.AppBox.length(Application(this.gateApp.value), this.gatePrefix.value.concat(Txn.sender.bytes))
      assert(listed, 'not on the voter list')
    }
  }

  /** Asset created by one of the collection's creators, with the unit-name prefix if one is set. */
  private isPiece(rule: CollectionRule, id: uint64): boolean {
    const [assetCreator] = op.AssetParams.assetCreator(id)
    let byCreator = false
    for (let i: uint64 = 0; i < rule.creators.length; i += 1) {
      if (rule.creators[i] === assetCreator) byCreator = true
    }
    if (!byCreator) return false
    if (rule.unitPrefix.length === 0) return true
    const [unit] = op.AssetParams.assetUnitName(id)
    return unit.length >= rule.unitPrefix.length && op.extract(unit, 0, rule.unitPrefix.length) === rule.unitPrefix
  }

  private assertEnded(): void {
    assert(this.status.value === STATUS_FINALIZED || this.status.value === STATUS_CANCELLED, 'not ended')
    assert(!this.payoutPending.value, 'payout pending')
  }

  private ballotOf(voter: Account): Ballot {
    if (this.ballots(voter).exists) return clone(this.ballots(voter).value)
    return { option: 0, amount: 0, weight: 0 }
  }

  /** Replace a voter's ballot, moving their weight between options and patching totals. */
  private applyBallot(voter: Account, option: uint64, amount: uint64, weight: uint64): void {
    assert(option < this.optionCount.value, 'bad option')
    if (this.ballots(voter).exists) {
      const old = clone(this.ballots(voter).value)
      this.setTally(old.option, this.tallyOf(old.option) - old.weight)
      this.totalWeight.value -= old.weight
    } else {
      this.voters.value += 1
      this.openBallots.value += 1
    }
    this.ballots(voter).value = { option: option, amount: amount, weight: weight }
    this.setTally(option, this.tallyOf(option) + weight)
    this.totalWeight.value += weight
    this.patchRegistry(REC_WEIGHT, this.totalWeight.value)
    this.patchRegistry(REC_WEIGHT + 8, this.voters.value)
  }

  private tallyOf(i: uint64): uint64 {
    return op.btoi(this.tally.extract(i * 8, 8))
  }

  private setTally(i: uint64, v: uint64): void {
    this.tally.replace(i * 8, op.itob(v))
  }

  private registryKey(): bytes {
    return Bytes('v').concat(op.itob(this.voteNo.value))
  }

  /** v13 family write: patch one uint64 field of this vote's entry in the registry app. */
  private patchRegistry(offset: uint64, value: uint64): void {
    op.AppBox.replace(Application(this.registry.value), this.registryKey(), offset, op.itob(value))
  }

  /** Charge the voter exactly the MBR their new boxes added, and return any surplus. */
  private settleMbr(pay: gtxn.PaymentTxn, before: uint64): void {
    assert(pay.sender === Txn.sender, 'pay sender')
    assert(pay.receiver === Global.currentApplicationAddress, 'pay receiver')
    const after = Global.currentApplicationAddress.minBalance
    const cost: uint64 = after > before ? after - before : 0
    assert(pay.amount >= cost, 'MBR not covered')
    if (pay.amount > cost) {
      itxn.payment({ receiver: Txn.sender, amount: pay.amount - cost, fee: 0 }).submit()
    }
  }

  private refundMbr(to: Account, before: uint64): void {
    const freed: uint64 = before - Global.currentApplicationAddress.minBalance
    if (freed > 0) {
      itxn.payment({ receiver: to, amount: freed, fee: 0 }).submit()
    }
  }
}

/* ------------------------------------------------------------------------------------------ */

/**
 * The factory is meant to be upgraded in place for a long time, so it is created with headroom for
 * things an update can't change: spare global state slots (schema is fixed at creation) and the
 * maximum program pages (set by contracts/deploy-vote-tool.ts). Future versions add state in the
 * reserved slots or in boxes, never by redeploying. `lockUpgrades()` freezes it for good.
 */
@contract({ avmVersion: 13, stateTotals: { globalUints: 16, globalBytes: 8 } })
export class VoteFactory extends Contract {
  admin = GlobalState<Account>({ key: 'admin' })
  registry = GlobalState<uint64>({ key: 'registry' })
  totalVotes = GlobalState<uint64>({ key: 'total_votes' })
  totalLists = GlobalState<uint64>({ key: 'total_lists' })
  /** Rounds after the end before an undeliverable payout falls back to refunds (copied into each vote). */
  payoutGrace = GlobalState<uint64>({ key: 'grace' })

  @abimethod({ onCreate: 'require' })
  createApplication(payoutGrace: uint64): void {
    this.admin.value = Txn.sender
    this.registry.value = 0
    this.totalVotes.value = 0
    this.totalLists.value = 0
    this.payoutGrace.value = payoutGrace === 0 ? DEFAULT_PAYOUT_GRACE : payoutGrace
  }

  /** No-op. Clients add it to a group for extra reference slots (closeVote touches many resources). */
  opUp(): void {}

  /** Admin: payout grace for NEW votes (existing votes keep theirs). 0 = default (~1 week). */
  setPayoutGrace(payoutGrace: uint64): void {
    assert(Txn.sender === this.admin.value, 'admin only')
    this.payoutGrace.value = payoutGrace === 0 ? DEFAULT_PAYOUT_GRACE : payoutGrace
  }

  /** The factory itself is upgradeable (admin only). That only changes the template for NEW votes. */
  @baremethod({ allowActions: 'UpdateApplication' })
  updateApplication(): void {
    assert(Txn.sender === this.admin.value, 'admin only')
  }

  /** Admin: hand the factory to another account (e.g. a multisig) before or instead of locking. */
  setAdmin(newAdmin: Account): void {
    assert(Txn.sender === this.admin.value, 'admin only')
    assert(newAdmin !== Global.zeroAddress, 'use lockUpgrades to remove the admin')
    this.admin.value = newAdmin
  }

  /**
   * Admin, one-way: remove the admin. After this no one can upgrade the factory or change its
   * settings; votes, voter lists, closeVote and every refund keep working.
   */
  lockUpgrades(): void {
    assert(Txn.sender === this.admin.value, 'admin only')
    this.admin.value = Global.zeroAddress
  }

  /**
   * One-time: create the registry. `pay` covers the factory's own base balance, the registry's
   * creation deposit (charged to the factory as its creator) and the registry account's base.
   */
  bootstrap(pay: gtxn.PaymentTxn): uint64 {
    assert(Txn.sender === this.admin.value, 'admin only')
    assert(this.registry.value === 0, 'already bootstrapped')
    assert(pay.receiver === Global.currentApplicationAddress, 'pay the factory')
    const reg = compileArc4(VoteRegistry)
    const created = reg.call.createApplication({ fee: 0 }).itxn.createdApp
    itxn.payment({ receiver: created.address, amount: Global.minBalance, fee: 0 }).submit()
    this.registry.value = created.id
    return created.id
  }

  /**
   * Create a vote in one call. `pay` (to the factory) covers:
   *   1. the vote app's creation deposit, which the protocol charges to the factory as creator
   *      (held here and refunded to the vote's creator by closeVote), and
   *   2. the vote account itself: base + asset opt-in + boxes + registry entry. The vote returns
   *      whatever it didn't need to `Txn.sender`.
   */
  createVote(
    pay: gtxn.PaymentTxn,
    config: VoteConfig,
    title: string,
    description: string,
    options: VoteOption[],
    collection: CollectionRule,
  ): uint64 {
    assert(this.registry.value !== 0, 'not bootstrapped')
    assert(pay.sender === Txn.sender && pay.receiver === Global.currentApplicationAddress, 'funding payment')
    assert(options.length >= 2 && options.length <= MAX_OPTIONS, '2-16 options')
    assert(config.mode <= MODE_NFT, 'mode')
    assert(config.returnMode <= RETURN_WINNER, 'return mode')
    const start: uint64 = config.startRound === 0 ? Global.round : config.startRound
    assert(start >= Global.round, 'start in the past')
    assert(config.endRound > start, 'end before start')

    if (config.mode === MODE_NFT) {
      assert(collection.creators.length >= 1 && collection.creators.length <= MAX_CREATORS, '1-8 collection creators')
      for (let i: uint64 = 0; i < collection.creators.length; i += 1) {
        assert(collection.creators[i] !== Global.zeroAddress, 'collection creator required')
      }
    } else {
      assert(config.asset !== 0, 'asset required')
      assert(config.amountPerVote > 0, 'amount per vote')
    }
    if (config.mode === MODE_ESCROW && config.returnMode === RETURN_ADDRESS) {
      assert(config.returnAddress !== Global.zeroAddress, 'return address required')
    }
    if (config.mode === MODE_ESCROW && config.returnMode === RETURN_WINNER) {
      for (let i: uint64 = 0; i < options.length; i += 1) {
        assert(options[i].recipient !== Global.zeroAddress, 'every option needs a recipient')
      }
    }

    this.totalVotes.value += 1
    const voteNo = this.totalVotes.value
    const vote = compileArc4(Vote)
    const before = Global.currentApplicationAddress.minBalance
    const created = vote.call
      .createApplication({
        args: [this.registry.value, voteNo, Txn.sender, clone(config), options.length, this.payoutGrace.value],
        fee: 0,
      })
      .itxn.createdApp
    const appDeposit: uint64 = Global.currentApplicationAddress.minBalance - before
    assert(pay.amount > appDeposit, 'funding below the app deposit')

    itxn.payment({ receiver: created.address, amount: pay.amount - appDeposit, fee: 0 }).submit()
    vote.call.init({ appId: created, args: [title, description, clone(options), clone(collection)], fee: 0 })
    return created.id
  }

  /**
   * Anyone, once every ballot is released: deletes the vote (its ALGO and stray tokens go to the
   * vote's creator) and refunds the app creation deposit held here to that creator too.
   */
  closeVote(voteApp: Application): void {
    assert(voteApp.creator === Global.currentApplicationAddress, 'not a vote from this factory')
    const [creatorBytes, hasCreator] = op.AppGlobal.getExBytes(voteApp, Bytes('creator'))
    assert(hasCreator, 'not a vote')
    const before = Global.currentApplicationAddress.minBalance
    compileArc4(Vote).call.close({ appId: voteApp, onCompletion: OnCompleteAction.DeleteApplication, fee: 0 })
    const freed: uint64 = before - Global.currentApplicationAddress.minBalance
    itxn.payment({ receiver: Account(creatorBytes), amount: freed, fee: 0 }).submit()
  }

  /** Create a voter allowlist owned by the caller (same family, read-only to others). */
  createVoterList(pay: gtxn.PaymentTxn): uint64 {
    assert(pay.sender === Txn.sender && pay.receiver === Global.currentApplicationAddress, 'funding payment')
    const list = compileArc4(VoterList)
    const before = Global.currentApplicationAddress.minBalance
    const created = list.call.createApplication({ args: [Txn.sender], fee: 0 }).itxn.createdApp
    const appDeposit: uint64 = Global.currentApplicationAddress.minBalance - before
    assert(pay.amount > appDeposit, 'funding below the app deposit')
    itxn.payment({ receiver: created.address, amount: pay.amount - appDeposit, fee: 0 }).submit()
    this.totalLists.value += 1
    return created.id
  }

  /** Owner only, once the list is empty: deletes it and refunds every deposit to the owner. */
  closeVoterList(listApp: Application): void {
    assert(listApp.creator === Global.currentApplicationAddress, 'not a list from this factory')
    const [ownerBytes] = op.AppGlobal.getExBytes(listApp, Bytes('owner'))
    assert(Txn.sender.bytes === ownerBytes, 'owner only')
    const before = Global.currentApplicationAddress.minBalance
    compileArc4(VoterList).call.close({ appId: listApp, onCompletion: OnCompleteAction.DeleteApplication, fee: 0 })
    const freed: uint64 = before - Global.currentApplicationAddress.minBalance
    itxn.payment({ receiver: Txn.sender, amount: freed, fee: 0 }).submit()
  }
}
