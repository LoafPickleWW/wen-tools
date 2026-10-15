import { Contract } from '@algorandfoundation/tealscript';

/**
 * Wen Tools PQ Coupon
 *
 * Pays 1 PQPRINT for every transaction a native post-quantum (Falcon-1024)
 * Algorand account "prints" through this app. Trustless: the app creates the
 * coupon ASA itself, holds the entire supply, has no admin keys and cannot be
 * updated or deleted.
 *
 * Proving a caller is a native PQ account:
 *   The AVM can't see how a transaction was signed, but a native PQ address is
 *   SHA-512/256("PQA" || "f1" || salt || falconPublicKey). If the sender equals
 *   that hash and is not rekeyed, no Ed25519 key can exist for it, so every
 *   transaction it sends is Falcon-authorized.
 *
 * Flow per printer account:
 *   register(salt||pk, beneficiary, mbrPay) -> box created, count 0
 *   print()                                 -> count + 1   (one per PQ txn)
 *   claim()                                 -> count PQPRINT to beneficiary, box deleted, MBR refunded
 */

/** Falcon-1024 public key (1793 bytes) prefixed by its 1-byte address salt. */
const PQ_KEY_PREIMAGE_LENGTH = 1794;

/** Each print pays 1.000000 PQPRINT (6 decimals). */
const COUPON_UNITS_PER_PRINT = 1_000_000;

/** A print must itself carry a Falcon-1024 fee (min fee + 2 min fees PQ surcharge). */
const PQ_FEE_MULTIPLIER = 3;

/** Box MBR: 2500 + 400 * (1-byte prefix + 32-byte address key + 40-byte value). */
const PRINTER_BOX_MBR = 31_700;

type Printer = {
  beneficiary: Address;
  count: uint64;
};

export class PQCoupon extends Contract {
  /** The PQPRINT ASA, created by bootstrap() */
  coupon = GlobalStateKey<AssetID>({ key: 'c' });

  /** Lifetime prints paid out or pending, across all printers */
  totalPrints = GlobalStateKey<uint64>({ key: 't' });

  printers = BoxMap<Address, Printer>({ prefix: 'p' });

  /**
   * The sender must still be authorized by its own (Falcon) key. AcctAuthAddr is read
   * after this transaction's own rekey is applied, so a transaction signed by another
   * key that rekeys back to the sender would look clean: reject any RekeyTo as well.
   */
  private assertNotRekeyed(): void {
    assert(this.txn.sender.authAddr === globals.zeroAddress);
    assert(this.txn.rekeyTo === globals.zeroAddress);
  }

  createApplication(): void {
    this.totalPrints.value = 0;
  }

  /**
   * Create the coupon ASA, held entirely by this app. Creator only, once.
   * The app account must be funded first (base MBR + asset MBR + this inner fee).
   */
  bootstrap(): AssetID {
    assert(this.txn.sender === globals.creatorAddress);
    assert(!this.coupon.exists);

    this.coupon.value = sendAssetCreation({
      configAssetName: 'Wen Tools PQ Coupon',
      configAssetUnitName: 'PQPRINT',
      configAssetURL: 'https://wen.tools/pq-printer',
      configAssetTotal: Uint<64>('18446744073709551615'),
      configAssetDecimals: 6,
      configAssetReserve: this.app.address,
      fee: 0,
    });
    return this.coupon.value;
  }

  /**
   * Register the sender as a PQ printer by revealing the preimage of its address.
   *
   * @param pqKey salt (1 byte) followed by the Falcon-1024 public key (1793 bytes)
   * @param beneficiary account that receives the coupons on claim; must already be opted in to PQPRINT
   * @param mbrPay exactly PRINTER_BOX_MBR to this app, refunded on claim
   */
  register(pqKey: bytes, beneficiary: Address, mbrPay: PayTxn): void {
    assert(this.coupon.exists);
    assert(!this.printers(this.txn.sender).exists);
    assert(len(pqKey) === PQ_KEY_PREIMAGE_LENGTH);
    assert(Address.fromBytes(sha512_256(concat('PQAf1', pqKey))) === this.txn.sender);
    this.assertNotRekeyed();
    assert(beneficiary !== globals.zeroAddress);
    assert(beneficiary.isOptedInToAsset(this.coupon.value));

    verifyPayTxn(mbrPay, {
      receiver: this.app.address,
      amount: PRINTER_BOX_MBR,
    });

    this.printers(this.txn.sender).value = { beneficiary: beneficiary, count: 0 };
  }

  /** One coupon per call. The call itself is the PQ transaction being rewarded. */
  print(): void {
    assert(this.printers(this.txn.sender).exists);
    this.assertNotRekeyed();
    // Every coupon costs a full Falcon-1024 fee, whoever else is in the group.
    assert(this.txn.fee >= globals.minTxnFee * PQ_FEE_MULTIPLIER);

    this.printers(this.txn.sender).value.count += 1;
    this.totalPrints.value += 1;
  }

  /**
   * Pay out all coupons to the beneficiary, delete the printer box and refund its MBR.
   * If the beneficiary has opted out since registering, the coupons are forfeited
   * (they stay with the app) so the deposit can never be locked. Returns coupons paid.
   * The caller covers the two inner transaction fees.
   */
  claim(): uint64 {
    assert(this.printers(this.txn.sender).exists);
    // Copy out first: box fields are read lazily, so they can't be used after delete().
    const beneficiary = this.printers(this.txn.sender).value.beneficiary;
    let count = this.printers(this.txn.sender).value.count;
    this.printers(this.txn.sender).delete();

    if (!beneficiary.isOptedInToAsset(this.coupon.value)) count = 0;
    if (count > 0) {
      sendAssetTransfer({
        xferAsset: this.coupon.value,
        assetReceiver: beneficiary,
        assetAmount: count * COUPON_UNITS_PER_PRINT,
        fee: 0,
      });
    }
    sendPayment({ receiver: this.txn.sender, amount: PRINTER_BOX_MBR, fee: 0 });
    return count;
  }

  /** Read-only: coupons owed to a printer that has not claimed yet. */
  @abi.readonly
  pending(printer: Address): uint64 {
    if (!this.printers(printer).exists) return 0;
    return this.printers(printer).value.count;
  }
}
