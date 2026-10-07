import { Contract } from '@algorandfoundation/tealscript';

// Sale lifecycle
const STATUS_SETUP = 0; // items being loaded, distribution wallet not yet rekeyed
const STATUS_LIVE = 1; // accepting commits
const STATUS_PAUSED = 2; // no new commits, pending commits can still be revealed
const STATUS_RELEASED = 3; // distribution wallet rekeyed back to itself, sale over

// Item list is stored as pages of packed uint64 asset IDs. 1KB pages keep every
// read/write within a single box reference's I/O budget.
const PAGE_ITEMS = 128;
const PAGE_BYTES = 1024;

// Randomness comes from the block seed of `commitRound + REVEAL_DELAY`, which is
// unknown when the commit lands. The AVM can only read seeds from roughly the last
// 1000 rounds, so a commit that is not revealed within REVEAL_WINDOW can be cancelled.
const REVEAL_DELAY = 1;
const REVEAL_WINDOW = 1000;

// Seed balance forwarded to each sale app: its base MBR plus the payout split box
// (2500 + 400 * (1-byte key + up to 240 bytes) = 98,900). Any excess returns on deletion.
const CHILD_SEED = 200_000;

// Payout splits: packed 40-byte entries (32-byte address + uint64 basis points), 1 to 5 of them,
// basis points summing to 10,000. The sale app stores each entry with a trailing uint64 "owed"
// amount (48 bytes): shares a recipient could not receive yet, kept for that recipient only.
const PAYOUT_ENTRY_BYTES = 40;
const PAYOUT_STORED_BYTES = 48;
const MAX_PAYOUTS = 5;
const BPS_TOTAL = 10_000;

// Floor for the buyer's refundable delivery deposit. It must always cover the worst-case
// ARC-59 inbox cost (router opt-in + new inbox account + inbox opt-in + router box,
// about 0.33 ALGO), otherwise a buyer could force reveals to fail and re-roll via refund.
const MIN_DELIVERY_BUDGET = 400_000;

// Floor for the reveal bounty so third parties are paid more than the pooled fees
// (an ARC-59 delivery is ~15 inner transactions)
const MIN_REVEAL_FEE = 20_000;

// ABI return: 4-byte prefix + (uint64,uint64,bool,bool,uint64,uint64) = 8+8+1+8+8
const ARC59_INFO_LOG_LENGTH = 37;

// Must match the state declared on WenPadSale
const CHILD_GLOBAL_UINTS = 16;
const CHILD_GLOBAL_BYTES = 2;
const CHILD_EXTRA_PAGES = 1;

type Commit = {
  buyer: Address;
  targetRound: uint64;
  price: uint64;
  revealFee: uint64;
  /**
   * Refundable delivery deposit. Refunded directly if the buyer is opted in to the drawn
   * asset; otherwise it pays the ARC-59 inbox cost and the remainder travels with the NFT
   * into the buyer's inbox, returned to them when they claim.
   */
  deposit: uint64;
  /** MBR of this commit box, measured at commit time and returned to the buyer with the deposit */
  boxMbr: uint64;
};

type SaleRecord = {
  app: AppID;
  admin: Address;
  distribution: Address;
  /** Primary (first) payout recipient; the full split is in the sale app's `p` box */
  payout: Address;
  price: uint64;
  startRound: uint64;
  endRound: uint64;
  totalItems: uint64;
  sold: uint64;
  status: uint64;
  createdRound: uint64;
  /** Total ALGO paid for delivered items (in µALGO), at the price each buyer actually paid */
  volume: uint64;
};

type SaleMetadata = {
  name: string;
  unitName: string;
  standard: string;
  /** Collection-level metadata JSON (ipfs:// or https://) for marketplaces and indexers */
  metadataUrl: string;
};

/**
 * A single random-mint sale. Created only by WenPadSaleFactory.
 *
 * The creator's distribution wallet is rekeyed to this app's address, so the app can
 * transfer NFTs out of it. The only transactions this contract ever sends from the
 * distribution wallet are: 1-unit asset transfers of listed items to buyers (directly or
 * via the ARC-59 router), and the rekey back to itself on release.
 *
 * Roles: the distribution wallet (the creator's connected wallet) signs the whole setup; the
 * admin (manager) controls the sale once live, because the distribution wallet can no longer
 * sign after the rekey; proceeds are split between up to 5 payout addresses, fixed at creation.
 *
 * The contract is immutable and can only be deleted by the factory after release.
 */
export class WenPadSale extends Contract {
  saleId = GlobalStateKey<uint64>({ key: 'sale_id' });
  factory = GlobalStateKey<AppID>({ key: 'factory' });
  router = GlobalStateKey<AppID>({ key: 'arc59' });

  admin = GlobalStateKey<Address>({ key: 'admin' });
  distribution = GlobalStateKey<Address>({ key: 'distribution' });
  /** Payout split as PAYOUT_STORED_BYTES entries (address, bps, owed). The split is set once by the factory. */
  payouts = BoxKey<bytes>({ key: 'p' });

  price = GlobalStateKey<uint64>({ key: 'price' });
  startRound = GlobalStateKey<uint64>({ key: 'start' });
  endRound = GlobalStateKey<uint64>({ key: 'end' });
  revealFee = GlobalStateKey<uint64>({ key: 'reveal_fee' });
  deliveryBudget = GlobalStateKey<uint64>({ key: 'delivery_budget' });

  status = GlobalStateKey<uint64>({ key: 'status' });
  total = GlobalStateKey<uint64>({ key: 'total' });
  remaining = GlobalStateKey<uint64>({ key: 'remaining' });
  pending = GlobalStateKey<uint64>({ key: 'pending' });
  sold = GlobalStateKey<uint64>({ key: 'sold' });
  proceeds = GlobalStateKey<uint64>({ key: 'proceeds' });
  nextCommit = GlobalStateKey<uint64>({ key: 'next_commit' });
  /**
   * The only commit that may be resolved next. Each draw takes from the list the earlier draws
   * left behind, so commits must resolve in commit order: otherwise whoever reveals could try
   * every order of the pending commits and pick the one that gives them the item they want.
   */
  nextReveal = GlobalStateKey<uint64>({ key: 'next_reveal' });

  items = BoxMap<uint64, bytes>({ prefix: 'i' });
  commits = BoxMap<uint64, Commit>({ prefix: 'c' });

  Committed = new EventLogger<{ commitId: uint64; buyer: Address; targetRound: uint64 }>();
  Revealed = new EventLogger<{ commitId: uint64; buyer: Address; asset: AssetID; inboxCost: uint64 }>();
  Cancelled = new EventLogger<{ commitId: uint64; buyer: Address }>();
  Released = new EventLogger<{ sold: uint64; remaining: uint64 }>();

  createApplication(
    saleId: uint64,
    admin: Address,
    distribution: Address,
    price: uint64,
    startRound: uint64,
    endRound: uint64,
    revealFee: uint64,
    deliveryBudget: uint64,
    router: AppID
  ): void {
    // Only creatable by the factory, so the registry only ever lists genuine sale contracts
    assert(this.txn.sender === globals.callerApplicationAddress);

    this.saleId.value = saleId;
    this.factory.value = globals.callerApplicationID;
    this.router.value = router;
    this.admin.value = admin;
    this.distribution.value = distribution;
    this.price.value = price;
    this.startRound.value = startRound;
    this.endRound.value = endRound;
    this.revealFee.value = revealFee;
    this.deliveryBudget.value = deliveryBudget;

    this.status.value = STATUS_SETUP;
    this.total.value = 0;
    this.remaining.value = 0;
    this.pending.value = 0;
    this.sold.value = 0;
    this.proceeds.value = 0;
    this.nextCommit.value = 1;
    this.nextReveal.value = 1;
  }

  // ---------------------------------------------------------------------------
  // Setup (distribution wallet or admin)
  // ---------------------------------------------------------------------------

  /** Called once by the factory right after creation (the app needs a balance to hold the box). */
  setPayouts(payouts: bytes): void {
    assert(this.txn.sender === this.app.creator);
    assert(!this.payouts.exists);
    // Widen each 40-byte entry to 48 bytes; the new box is zero-filled, so every owed amount starts at 0
    this.payouts.create((payouts.length / PAYOUT_ENTRY_BYTES) * PAYOUT_STORED_BYTES);
    for (let i = 0; i < payouts.length; i = i + PAYOUT_ENTRY_BYTES) {
      this.payouts.replace((i / PAYOUT_ENTRY_BYTES) * PAYOUT_STORED_BYTES, extract3(payouts, i, PAYOUT_ENTRY_BYTES));
    }
  }

  /**
   * Append asset IDs to the sale list. The payment must cover the box MBR for any new pages.
   * The frontend should only pass assets the distribution wallet holds; any that are not
   * held at reveal time are skipped and dropped from the list.
   */
  addItems(mbrPay: PayTxn, assets: bytes): void {
    // The distribution wallet can still sign during setup (it is rekeyed only by register)
    assert(this.txn.sender === this.admin.value || this.txn.sender === this.distribution.value);
    assert(this.status.value === STATUS_SETUP);
    // `assets` is packed big-endian uint64 asset IDs: the same layout as an item page, so each
    // page is written with one box replace (cost per page, not per item: ~53 ops/item otherwise)
    assert(assets.length % 8 === 0);

    const preMbr = this.app.address.minBalance;

    let consumed = 0;
    while (consumed < assets.length) {
      const n = this.remaining.value;
      const page = n / PAGE_ITEMS;
      const offset = (n % PAGE_ITEMS) * 8;
      if (offset === 0) {
        this.items(page).create(PAGE_BYTES);
      }
      let chunk = PAGE_BYTES - offset;
      if (chunk > assets.length - consumed) {
        chunk = assets.length - consumed;
      }
      this.items(page).replace(offset, extract3(assets, consumed, chunk));
      this.remaining.value = n + chunk / 8;
      consumed = consumed + chunk;
    }

    this.total.value = this.remaining.value;

    verifyPayTxn(mbrPay, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: this.app.address.minBalance - preMbr },
    });
  }

  /**
   * Go live. Must be followed in the same group by the distribution wallet's rekey to this
   * app, or called after that rekey has happened. Either way the distribution wallet can
   * sign both transactions in one prompt: [register(), pay 0 to self with rekeyTo=app].
   */
  register(): void {
    assert(this.status.value === STATUS_SETUP);
    assert(this.remaining.value > 0);

    const dist = this.distribution.value;
    if (dist.authAddr !== this.app.address) {
      verifyPayTxn(this.txnGroup[this.txn.groupIndex + 1], {
        sender: dist,
        receiver: dist,
        amount: 0,
        closeRemainderTo: globals.zeroAddress,
        rekeyTo: this.app.address,
      });
    }

    this.status.value = STATUS_LIVE;
    this.syncFactory();
  }

  pause(): void {
    assert(this.txn.sender === this.admin.value);
    assert(this.status.value === STATUS_LIVE);
    this.status.value = STATUS_PAUSED;
    this.syncFactory();
  }

  unpause(): void {
    assert(this.txn.sender === this.admin.value);
    assert(this.status.value === STATUS_PAUSED);
    this.status.value = STATUS_LIVE;
    this.syncFactory();
  }

  setPrice(price: uint64): void {
    assert(this.txn.sender === this.admin.value);
    assert(this.status.value !== STATUS_RELEASED);
    this.price.value = price;
    this.syncFactory();
  }

  /** The end round can be moved but never removed, so the permissionless release always applies eventually. */
  setEndRound(endRound: uint64): void {
    assert(this.txn.sender === this.admin.value);
    assert(this.status.value !== STATUS_RELEASED);
    assert(endRound > globals.round);
    assert(endRound > this.startRound.value);
    this.endRound.value = endRound;
    this.syncFactory();
  }

  // ---------------------------------------------------------------------------
  // Buying
  // ---------------------------------------------------------------------------

  /**
   * Reserve one random item. Payment must cover the four line items:
   *   price          -> creator (held until reveal)
   *   revealFee      -> whoever calls reveal (keeper bounty)
   *   commit box MBR -> refundable (2500 + 400 * (9-byte key + 72-byte Commit) = 34,900 today)
   *   deliveryBudget -> refundable delivery deposit (direct refund or carried to the ARC-59 inbox)
   * Anything paid above that is added to the refundable deposit. `maxPrice` is the price the
   * buyer saw, so a price raised while the commit is in flight makes it fail instead of charging more.
   */
  commit(payment: PayTxn, maxPrice: uint64): uint64 {
    assert(this.status.value === STATUS_LIVE);
    assert(globals.round >= this.startRound.value);
    assert(globals.round <= this.endRound.value);
    assert(this.pending.value < this.remaining.value);

    const commitId = this.nextCommit.value;

    // Measure the box MBR instead of hardcoding it, so protocol MBR changes cannot break commits
    const preMbr = this.app.address.minBalance;
    this.commits(commitId).create();
    const boxMbr = this.app.address.minBalance - preMbr;

    const price = this.price.value;
    assert(price <= maxPrice);
    const revealFee = this.revealFee.value;
    verifyPayTxn(payment, {
      sender: this.txn.sender,
      receiver: this.app.address,
      closeRemainderTo: globals.zeroAddress,
      rekeyTo: globals.zeroAddress,
      amount: { greaterThanEqualTo: price + revealFee + boxMbr + this.deliveryBudget.value },
    });

    const targetRound = globals.round + REVEAL_DELAY;
    this.commits(commitId).value = {
      buyer: this.txn.sender,
      targetRound: targetRound,
      price: price,
      revealFee: revealFee,
      deposit: payment.amount - price - revealFee - boxMbr,
      boxMbr: boxMbr,
    };

    this.nextCommit.value = commitId + 1;
    this.pending.value = this.pending.value + 1;

    this.Committed.log({ commitId: commitId, buyer: this.txn.sender, targetRound: targetRound });
    return commitId;
  }

  /**
   * Resolve a commit once its target round has passed. Callable by anyone, but only for the
   * commit at the head of the queue (`next_reveal`), so every result is fixed by the block seeds
   * alone, never by who reveals first. The caller receives revealFee as a bounty, which should
   * exceed the pooled fees they pay for this call.
   *
   * Security invariant: once a draw is made, nothing the buyer controls can make this call
   * fail. Otherwise a buyer could let unwanted draws expire and take the refund (free re-roll).
   * So every payment to the buyer goes either to an account that provably exists (opted in
   * to the asset) or into the ARC-59 inbox, and the deposit floor covers the worst-case inbox.
   */
  reveal(commitId: uint64): void {
    assert(commitId === this.nextReveal.value);
    assert(this.commits(commitId).exists);
    // Copy every field out first: TEALScript reads struct fields lazily from the box, so the
    // values would be unreadable after the box is deleted below
    const buyer = this.commits(commitId).value.buyer;
    const targetRound = this.commits(commitId).value.targetRound;
    const price = this.commits(commitId).value.price;
    const revealFee = this.commits(commitId).value.revealFee;
    const refundable = this.commits(commitId).value.deposit + this.commits(commitId).value.boxMbr;

    let entropy = sha256(
      concat(concat(blocks[targetRound].seed, buyer), concat(itob(commitId), itob(globals.currentApplicationID)))
    );

    // Draw until we hit an item the distribution wallet actually holds. Items that are not
    // held (moved out before register, or duplicated) are dropped from the list. Default-frozen
    // assets are dropped too: a buyer could opt in to one so its delivery fails, then take the
    // expiry refund (a free re-roll).
    let assetId = 0;
    while (assetId === 0 && this.remaining.value > 0) {
      const candidate = this.takeItem(extractUint64(entropy, 0) % this.remaining.value);
      // An ID of 0 can't be looked up, so it is dropped without a holding check
      if (candidate !== 0) {
        const asset = AssetID.fromUint64(candidate);
        if (this.distribution.value.isOptedInToAsset(asset)) {
          if (this.distribution.value.assetBalance(asset) > 0 && !asset.defaultFrozen) {
            assetId = candidate;
          }
        }
      }
      entropy = sha256(entropy);
    }

    this.commits(commitId).delete();
    this.pending.value = this.pending.value - 1;
    this.nextReveal.value = commitId + 1;

    if (assetId === 0) {
      // Nothing deliverable was left; refund everything
      this.safeRefund(buyer, price + revealFee + refundable);
      this.Cancelled.log({ commitId: commitId, buyer: buyer });
    } else {
      const asset = AssetID.fromUint64(assetId);
      const inboxCost = this.deliver(asset, buyer, refundable, price);
      // If the inbox ever costs more than the deposit (a protocol MBR increase), the shortfall
      // came out of the price
      let fromPrice = 0;
      if (inboxCost > refundable) {
        fromPrice = inboxCost - refundable;
      }

      this.sold.value = this.sold.value + 1;
      this.proceeds.value = this.proceeds.value + price - fromPrice;

      sendPayment({ receiver: this.txn.sender, amount: revealFee, fee: 0 });

      this.Revealed.log({ commitId: commitId, buyer: buyer, asset: asset, inboxCost: inboxCost });

      sendMethodCall<[uint64, AssetID, Address, uint64, uint64, uint64], void>({
        applicationID: this.factory.value,
        name: 'logPurchase',
        methodArgs: [this.saleId.value, asset, buyer, price, this.sold.value, this.remaining.value],
        fee: 0,
      });
    }

    if (this.remaining.value === 0 && this.pending.value === 0) {
      this.doRelease();
    }
  }

  /**
   * Refund a commit nobody revealed within REVEAL_WINDOW rounds (its block seed is no longer
   * readable). The reveal bounty makes it profitable for anyone to reveal long before this,
   * and the buyer's own page reveals too.
   */
  cancelExpired(commitId: uint64): void {
    // Same queue as reveal: the head can be cancelled once expired, then later commits proceed
    assert(commitId === this.nextReveal.value);
    assert(this.commits(commitId).exists);
    // Copy fields before deleting the box (struct fields are read lazily from the box)
    const buyer = this.commits(commitId).value.buyer;
    const amount =
      this.commits(commitId).value.price +
      this.commits(commitId).value.revealFee +
      this.commits(commitId).value.deposit +
      this.commits(commitId).value.boxMbr;
    assert(globals.round > this.commits(commitId).value.targetRound + REVEAL_WINDOW);

    this.commits(commitId).delete();
    this.pending.value = this.pending.value - 1;
    this.nextReveal.value = commitId + 1;

    this.safeRefund(buyer, amount);
    this.Cancelled.log({ commitId: commitId, buyer: buyer });
  }

  // ---------------------------------------------------------------------------
  // Ending
  // ---------------------------------------------------------------------------

  /**
   * Rekey the distribution wallet back to itself. Requires no pending commits (pause first,
   * then let them be revealed). Allowed for the admin at any time, or for anyone once the
   * sale has ended or sold out, so the wallet can never be stuck.
   */
  release(): void {
    assert(this.status.value !== STATUS_RELEASED);
    assert(this.pending.value === 0);
    assert(
      this.txn.sender === this.admin.value || globals.round > this.endRound.value || this.remaining.value === 0
    );
    this.doRelease();
  }

  /** Split accumulated sale proceeds between the payout addresses. Callable by anyone. */
  withdrawProceeds(): void {
    assert(this.proceeds.value > 0);
    this.payProceeds();
  }

  /** Free leftover item pages after release so the app can be deleted. Callable by anyone. */
  deleteItemPage(page: uint64): void {
    assert(this.status.value === STATUS_RELEASED);
    assert(this.items(page).exists);
    this.items(page).delete();
  }

  /** No-op. Grouped alongside heavy calls (reveal) to pool extra opcode budget. */
  opUp(): void {}

  /**
   * Called by the factory's deleteSale. Pays out proceeds, then closes the account to the
   * distribution wallet, which paid the deposits.
   */
  deleteApplication(): void {
    assert(this.txn.sender === this.app.creator);
    assert(this.status.value === STATUS_RELEASED);
    assert(this.pending.value === 0);

    // Amounts owed to recipients that still cannot receive are folded into the close-out
    // below, so deletion can never be blocked
    if (this.proceeds.value > 0) {
      this.payProceeds();
    }

    this.payouts.delete();
    assert(this.app.address.totalBoxes === 0);

    sendPayment({
      receiver: this.distribution.value,
      amount: 0,
      closeRemainderTo: this.distribution.value,
      fee: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Remove the item at `index` (swap with last, shrink) and return its asset ID. */
  private takeItem(index: uint64): uint64 {
    const lastIndex = this.remaining.value - 1;
    const page = index / PAGE_ITEMS;
    const offset = (index % PAGE_ITEMS) * 8;
    const value = btoi(this.items(page).extract(offset, 8));

    const lastPage = lastIndex / PAGE_ITEMS;
    const lastOffset = (lastIndex % PAGE_ITEMS) * 8;
    if (index !== lastIndex) {
      this.items(page).replace(offset, this.items(lastPage).extract(lastOffset, 8));
    }

    // Drop the last page once it is empty
    if (lastOffset === 0) {
      this.items(lastPage).delete();
    }

    this.remaining.value = lastIndex;
    return value;
  }

  /**
   * Send 1 unit from the distribution wallet to the buyer, together with their refundable
   * deposit. If they are opted in, both go directly (the account provably exists, so the
   * refund cannot fail). Otherwise the asset goes through the ARC-59 router: the deposit pays
   * the inbox MBR and everything left over is sent along as additionalReceiverFunds, which
   * the buyer gets back when they claim. Returns the ALGO spent on inbox MBR. Should the inbox
   * cost more than the deposit (protocol MBR increase), the shortfall comes out of `price`, so a
   * buyer can never make delivery fail by staying un-opted-in.
   */
  private deliver(asset: AssetID, buyer: Address, refundable: uint64, price: uint64): uint64 {
    const dist = this.distribution.value;

    if (buyer.isOptedInToAsset(asset)) {
      sendAssetTransfer({
        sender: dist,
        xferAsset: asset,
        assetReceiver: buyer,
        assetAmount: 1,
        fee: 0,
      });
      sendPayment({ receiver: buyer, amount: refundable, fee: 0 });
      return 0;
    }

    const router = this.router.value;
    // (itxns, mbr, routerOptedIn, receiverOptedIn, receiverAlgoNeededForClaim, worstCaseClaim)
    const info = sendMethodCall<[Address, AssetID], [uint64, uint64, boolean, boolean, uint64, uint64]>({
      applicationID: router,
      name: 'arc59_getSendAssetInfo',
      methodArgs: [buyer, asset],
      fee: 0,
    });
    // TEALScript does not validate ABI return values, so check the raw log ourselves
    const infoLog = this.itxn.lastLog;
    assert(infoLog.length === ARC59_INFO_LOG_LENGTH);
    assert(extract3(infoLog, 0, 4) === hex('0x151f7c75'));

    const routerMbr = info[1];
    assert(routerMbr <= refundable + price);
    let funds = refundable;
    if (routerMbr > refundable) {
      funds = routerMbr;
    }
    const claimAlgo = funds - routerMbr;

    if (funds > 0) {
      sendPayment({ receiver: router.address, amount: funds, fee: 0 });
    }

    if (!info[2]) {
      sendMethodCall<[AssetID], void>({
        applicationID: router,
        name: 'arc59_optRouterIn',
        methodArgs: [asset],
        fee: 0,
      });
    }

    sendMethodCall<[AssetTransferTxn, Address, uint64], Address>({
      applicationID: router,
      name: 'arc59_sendAsset',
      methodArgs: [
        {
          sender: dist,
          xferAsset: asset,
          assetReceiver: router.address,
          assetAmount: 1,
          fee: 0,
        },
        buyer,
        claimAlgo,
      ],
      fee: 0,
    });

    return routerMbr;
  }

  /**
   * Pay out proceeds. `proceeds` is the unsplit balance plus every recipient's owed amount. The
   * unsplit part is divided by the payout split (rounding dust to the first recipient); each
   * recipient then gets their share plus anything owed to them. A recipient who cannot receive
   * (closed account, amount below the min balance) keeps it as owed, for them alone, instead of
   * blocking the others or being re-split.
   */
  private payProceeds(): void {
    const size = this.payouts.size;

    let owedTotal = 0;
    for (let i = 0; i < size; i = i + PAYOUT_STORED_BYTES) {
      owedTotal = owedTotal + btoi(this.payouts.extract(i + 40, 8));
    }
    const amount = this.proceeds.value - owedTotal;

    let allocated = 0;
    for (let i = 0; i < size; i = i + PAYOUT_STORED_BYTES) {
      allocated = allocated + wideRatio([amount, btoi(this.payouts.extract(i + 32, 8))], [BPS_TOTAL]);
    }

    let retained = 0;
    for (let i = 0; i < size; i = i + PAYOUT_STORED_BYTES) {
      const receiver = castBytes<Address>(this.payouts.extract(i, 32));
      const owed = btoi(this.payouts.extract(i + 40, 8));
      let due = wideRatio([amount, btoi(this.payouts.extract(i + 32, 8))], [BPS_TOTAL]) + owed;
      if (i === 0) {
        due = due + amount - allocated;
      }
      if (due > 0) {
        if (this.canReceive(receiver, due)) {
          sendPayment({ receiver: receiver, amount: due, fee: 0 });
          if (owed > 0) {
            this.payouts.replace(i + 40, itob(0));
          }
        } else {
          retained = retained + due;
          this.payouts.replace(i + 40, itob(due));
        }
      }
    }
    this.proceeds.value = retained;
  }

  /** Whether a payment of `amount` to `account` can succeed (existing account, or enough to fund a new one) */
  private canReceive(account: Address, amount: uint64): boolean {
    return account.balance > 0 || amount >= globals.minBalance;
  }

  /**
   * Refund that can never fail: if the buyer closed their account and the amount is too small
   * to re-fund it, the amount is forfeited to proceeds instead of blocking the call.
   */
  private safeRefund(buyer: Address, amount: uint64): void {
    if (this.canReceive(buyer, amount)) {
      sendPayment({ receiver: buyer, amount: amount, fee: 0 });
    } else {
      this.proceeds.value = this.proceeds.value + amount;
    }
  }

  private doRelease(): void {
    const dist = this.distribution.value;
    if (dist.authAddr === this.app.address) {
      sendPayment({ sender: dist, receiver: dist, amount: 0, rekeyTo: dist, fee: 0 });
    }
    this.status.value = STATUS_RELEASED;
    this.Released.log({ sold: this.sold.value, remaining: this.remaining.value });
    this.syncFactory();
  }

  private syncFactory(): void {
    sendMethodCall<[uint64, uint64, uint64, uint64, uint64, uint64], void>({
      applicationID: this.factory.value,
      name: 'syncSale',
      methodArgs: [
        this.saleId.value,
        this.price.value,
        this.endRound.value,
        this.total.value,
        this.sold.value,
        this.status.value,
      ],
      fee: 0,
    });
  }
}

/**
 * Registry and deployer for WenPad random-mint sales.
 *
 * Every sale app is created here, and sale apps report their state back on every change,
 * so the factory's boxes and ARC-28 events form a single index of all WenPad sales:
 *   s<saleId>          -> SaleRecord
 *   m<saleId>          -> SaleMetadata
 *   c<admin><saleId>   -> appId   (list a creator's sales by box-name prefix)
 *
 * To find a sale by app ID, read the app's `sale_id` global and check s<saleId>.app matches.
 * (There is deliberately no box keyed by app ID: the new app's ID is unknown until the
 * createSale transaction lands, so its box reference would race with other app creations.)
 *
 * The factory is immutable: no update or delete.
 */
export class WenPadSaleFactory extends Contract {
  totalSales = GlobalStateKey<uint64>({ key: 'total_sales' });
  /** Total ALGO volume across every Shuffle ever run through this factory (µALGO) */
  totalVolume = GlobalStateKey<uint64>({ key: 'total_volume' });
  nextSaleId = GlobalStateKey<uint64>({ key: 'next_sale_id' });
  router = GlobalStateKey<AppID>({ key: 'arc59' });

  sales = BoxMap<uint64, SaleRecord>({ prefix: 's' });
  metadata = BoxMap<uint64, SaleMetadata>({ prefix: 'm' });
  creatorSales = BoxMap<bytes, AppID>({ prefix: 'c' });

  SaleCreated = new EventLogger<{ saleId: uint64; app: AppID; admin: Address; distribution: Address }>();
  SaleSynced = new EventLogger<{ saleId: uint64; status: uint64; totalItems: uint64; sold: uint64 }>();
  Purchase = new EventLogger<{ saleId: uint64; app: AppID; asset: AssetID; buyer: Address; price: uint64 }>();
  MetadataUpdated = new EventLogger<{ saleId: uint64 }>();
  SaleDeleted = new EventLogger<{ saleId: uint64 }>();

  createApplication(router: AppID): void {
    this.totalSales.value = 0;
    this.totalVolume.value = 0;
    this.nextSaleId.value = 1;
    this.router.value = router;
  }

  /**
   * Deploy a new sale app. The sender is the distribution wallet: the creator's connected
   * wallet that holds the collection and signs the whole setup. `admin` (the manager) controls
   * the sale once live. `payouts` is the packed proceeds split (see PAYOUT_ENTRY_BYTES).
   * The payment must cover the factory's MBR increase (child app + index boxes) plus
   * CHILD_SEED; any overpayment is refunded.
   */
  createSale(
    mbrPay: PayTxn,
    admin: Address,
    payouts: bytes,
    price: uint64,
    startRound: uint64,
    endRound: uint64,
    revealFee: uint64,
    deliveryBudget: uint64,
    name: string,
    unitName: string,
    standard: string,
    metadataUrl: string
  ): uint64 {
    const distribution = this.txn.sender;

    // The admin must be a different wallet: once rekeyed, the distribution wallet's own
    // key can no longer sign, so it could never call admin methods.
    assert(admin !== distribution);
    assert(admin !== globals.zeroAddress);

    // Payout split: 1-5 entries, non-zero addresses, positive shares summing to 100%
    assert(payouts.length > 0);
    assert(payouts.length <= PAYOUT_ENTRY_BYTES * MAX_PAYOUTS);
    assert(payouts.length % PAYOUT_ENTRY_BYTES === 0);
    let totalBps = 0;
    for (let i = 0; i < payouts.length; i = i + PAYOUT_ENTRY_BYTES) {
      // castBytes is safe here: exactly 32 bytes are extracted
      assert(castBytes<Address>(extract3(payouts, i, 32)) !== globals.zeroAddress);
      const bps = extractUint64(payouts, i + 32);
      assert(bps > 0);
      totalBps = totalBps + bps;
    }
    assert(totalBps === BPS_TOTAL);
    const payout = castBytes<Address>(extract3(payouts, 0, 32));

    assert(endRound > startRound);
    assert(endRound > globals.round);
    assert(revealFee >= MIN_REVEAL_FEE);
    assert(deliveryBudget >= MIN_DELIVERY_BUDGET);
    assert(name.length <= 64);
    assert(unitName.length <= 8);
    assert(standard.length <= 8);
    assert(metadataUrl.length <= 256);
    verifyPayTxn(mbrPay, {
      sender: distribution,
      receiver: this.app.address,
      closeRemainderTo: globals.zeroAddress,
      rekeyTo: globals.zeroAddress,
    });

    const preMbr = this.app.address.minBalance;
    const saleId = this.nextSaleId.value;

    sendMethodCall<typeof WenPadSale.prototype.createApplication>({
      approvalProgram: WenPadSale.approvalProgram(),
      clearStateProgram: WenPadSale.clearProgram(),
      globalNumUint: CHILD_GLOBAL_UINTS,
      globalNumByteSlice: CHILD_GLOBAL_BYTES,
      extraProgramPages: CHILD_EXTRA_PAGES,
      methodArgs: [
        saleId,
        admin,
        distribution,
        price,
        startRound,
        endRound,
        revealFee,
        deliveryBudget,
        this.router.value,
      ],
      fee: 0,
    });
    const app = this.itxn.createdApplicationID;

    sendPayment({ receiver: app.address, amount: CHILD_SEED, fee: 0 });
    sendMethodCall<typeof WenPadSale.prototype.setPayouts>({
      applicationID: app,
      methodArgs: [payouts],
      fee: 0,
    });

    this.sales(saleId).value = {
      app: app,
      admin: admin,
      distribution: distribution,
      payout: payout,
      price: price,
      startRound: startRound,
      endRound: endRound,
      totalItems: 0,
      sold: 0,
      status: STATUS_SETUP,
      createdRound: globals.round,
      volume: 0,
    };
    this.metadata(saleId).value = {
      name: name,
      unitName: unitName,
      standard: standard,
      metadataUrl: metadataUrl,
    };
    this.creatorSales(concat(admin, itob(saleId))).value = app;

    this.nextSaleId.value = saleId + 1;
    this.totalSales.value = this.totalSales.value + 1;

    // Charge exactly what was used and refund any overpayment
    const required = this.app.address.minBalance - preMbr + CHILD_SEED;
    assert(mbrPay.amount >= required);
    if (mbrPay.amount > required) {
      sendPayment({ receiver: distribution, amount: mbrPay.amount - required, fee: 0 });
    }

    this.SaleCreated.log({ saleId: saleId, app: app, admin: admin, distribution: distribution });
    return saleId;
  }

  /** Called by a sale app whenever its state changes. */
  syncSale(saleId: uint64, price: uint64, endRound: uint64, totalItems: uint64, sold: uint64, status: uint64): void {
    this.assertCallerIsSale(saleId);
    this.sales(saleId).value.price = price;
    this.sales(saleId).value.endRound = endRound;
    this.sales(saleId).value.totalItems = totalItems;
    this.sales(saleId).value.sold = sold;
    this.sales(saleId).value.status = status;

    this.SaleSynced.log({ saleId: saleId, status: status, totalItems: totalItems, sold: sold });
  }

  /** Called by a sale app on every delivered item. */
  logPurchase(saleId: uint64, asset: AssetID, buyer: Address, price: uint64, sold: uint64, remaining: uint64): void {
    this.assertCallerIsSale(saleId);
    this.sales(saleId).value.sold = sold;
    this.sales(saleId).value.volume = this.sales(saleId).value.volume + price;
    this.totalVolume.value = this.totalVolume.value + price;

    this.Purchase.log({ saleId: saleId, app: globals.callerApplicationID, asset: asset, buyer: buyer, price: price });
  }

  /** Admin-only. Payment covers any MBR increase; any decrease is refunded. */
  updateMetadata(
    mbrPay: PayTxn,
    saleId: uint64,
    name: string,
    unitName: string,
    standard: string,
    metadataUrl: string
  ): void {
    assert(this.sales(saleId).exists);
    const admin = this.sales(saleId).value.admin;
    assert(this.txn.sender === admin);
    assert(name.length <= 64);
    assert(unitName.length <= 8);
    assert(standard.length <= 8);
    assert(metadataUrl.length <= 256);
    verifyPayTxn(mbrPay, { sender: admin, receiver: this.app.address });

    const preMbr = this.app.address.minBalance;
    this.metadata(saleId).delete();
    this.metadata(saleId).value = {
      name: name,
      unitName: unitName,
      standard: standard,
      metadataUrl: metadataUrl,
    };
    const postMbr = this.app.address.minBalance;

    // Charge exactly the MBR increase; refund any overpayment and any MBR decrease
    let refund = mbrPay.amount + preMbr;
    assert(refund >= postMbr);
    refund = refund - postMbr;
    if (refund > 0) {
      sendPayment({ receiver: admin, amount: refund, fee: 0 });
    }

    this.MetadataUpdated.log({ saleId: saleId });
  }

  /**
   * Callable by anyone (the keeper closes a Shuffle right after its last delivery). Deletes a
   * released sale app (after its item pages are freed) and its index entries. Nothing can be
   * redirected: proceeds go to the payout split, all MBR to the distribution wallet, and the
   * sale app itself refuses deletion unless it is released with nothing pending. Purchase
   * history stays in the event logs.
   */
  deleteSale(saleId: uint64): void {
    assert(this.sales(saleId).exists);
    // Copy fields before deleting the box (struct fields are read lazily from the box)
    const admin = this.sales(saleId).value.admin;
    const app = this.sales(saleId).value.app;
    const distribution = this.sales(saleId).value.distribution;

    const preMbr = this.app.address.minBalance;

    sendMethodCall<typeof WenPadSale.prototype.deleteApplication>({
      applicationID: app,
      onCompletion: OnCompletion.DeleteApplication,
      fee: 0,
    });

    this.sales(saleId).delete();
    this.metadata(saleId).delete();
    this.creatorSales(concat(admin, itob(saleId))).delete();
    this.totalSales.value = this.totalSales.value - 1;

    // Deposits go back to the distribution wallet, which paid them at createSale
    sendPayment({ receiver: distribution, amount: preMbr - this.app.address.minBalance, fee: 0 });

    this.SaleDeleted.log({ saleId: saleId });
  }

  // ---------------------------------------------------------------------------
  // Read-only helpers for frontends and indexers
  // ---------------------------------------------------------------------------

  @abi.readonly
  getSale(saleId: uint64): SaleRecord {
    return this.sales(saleId).value;
  }

  @abi.readonly
  getSaleMetadata(saleId: uint64): SaleMetadata {
    return this.metadata(saleId).value;
  }

  /** Authenticate a sale app callback: the caller must be the app recorded for `saleId`. */
  private assertCallerIsSale(saleId: uint64): void {
    assert(this.sales(saleId).exists);
    assert(this.sales(saleId).value.app === globals.callerApplicationID);
  }
}
