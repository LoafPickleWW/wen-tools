/**
 * End-to-end testnet test for PQCoupon.
 *
 * Deploys a fresh PQCoupon, bootstraps the PQPRINT ASA, then drives a real
 * native Falcon-1024 account through register -> print × N -> claim -> close,
 * plus the attacks the contract must reject.
 *
 *   npx tsx contracts/test/pq-coupon.testnet.ts            (funder from contracts/.env.testnet-wallets-v5 "dist")
 *   FUNDER_MNEMONIC="..." npx tsx contracts/test/pq-coupon.testnet.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import Falcon from 'falcon-signatures';
import { sha512_256 } from '@noble/hashes/sha2.js';
import { deriveNativePQAddress, type NativePQAccount } from '../../src/utils/pqNative';

const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
const buildDir = path.join(import.meta.dirname, '..', 'build');
const PRINTS = 20;
const BOX_MBR = 31_700;
const enc = new TextEncoder();

function funderMnemonic(): string {
  if (process.env.FUNDER_MNEMONIC) return process.env.FUNDER_MNEMONIC;
  const txt = fs.readFileSync(path.join(import.meta.dirname, '..', '.env.testnet-wallets-v5'), 'utf8');
  const m = txt.match(/^dist=\s*"?(.+?)"?\s*$/m);
  if (!m) throw new Error('No funder mnemonic');
  return m[1];
}

const funder = algosdk.mnemonicToSecretKey(funderMnemonic());
const falcon = new Falcon();
const arc4 = JSON.parse(fs.readFileSync(path.join(buildDir, 'PQCoupon.arc4.json'), 'utf8'));
const contract = new algosdk.ABIContract(arc4);
const method = (name: string) => contract.getMethodByName(name);

let passed = 0;
function ok(label: string) {
  passed++;
  console.log(`  ✓ ${label}`);
}

async function send(stxns: Uint8Array[], waitFor: string) {
  await algod.sendRawTransaction(stxns).do();
  return algosdk.waitForConfirmation(algod, waitFor, 10);
}

async function expectReject(label: string, stxns: Uint8Array[], match?: RegExp) {
  try {
    await algod.sendRawTransaction(stxns).do();
  } catch (e: any) {
    const msg: string = e?.response?.body?.message ?? e.message;
    if (match && !match.test(msg)) throw new Error(`${label}: rejected for the wrong reason: ${msg}`);
    ok(`rejects ${label}`);
    return;
  }
  throw new Error(`${label}: was accepted but should have been rejected`);
}

async function newPQAccount(): Promise<NativePQAccount> {
  const { publicKey, secretKey } = await falcon.keypair();
  const { address, salt } = deriveNativePQAddress(publicKey);
  return { address, salt, publicKey: Falcon.bytesToHex(publicKey), secretKey: Falcon.bytesToHex(secretKey) };
}

async function pqSign(txn: algosdk.Transaction, acct: NativePQAccount): Promise<Uint8Array> {
  const sig = await falcon.sign(txn.bytesToSign(), Falcon.hexToBytes(acct.secretKey));
  const pqsig: Record<string, unknown> = { pk: Falcon.hexToBytes(acct.publicKey), sch: enc.encode('f1'), sig };
  if (acct.salt !== 0) pqsig.slt = acct.salt;
  return algosdk.encodeObj({ pqsig, txn: txn.get_obj_for_encoding() });
}

function pqKeyArg(acct: NativePQAccount) {
  return new Uint8Array([acct.salt, ...Falcon.hexToBytes(acct.publicKey)]);
}

function boxRef(appId: number, addr: string) {
  return { appIndex: appId, name: new Uint8Array([0x70, ...algosdk.decodeAddress(addr).publicKey]) };
}

function appCall(
  sp: algosdk.SuggestedParams,
  appId: number,
  from: string,
  name: string,
  args: Uint8Array[],
  fee: number,
  extra: Partial<{ boxes: any[]; foreignAssets: number[]; accounts: string[]; note: Uint8Array; rekeyTo: string }> = {},
) {
  return algosdk.makeApplicationNoOpTxnFromObject({
    from,
    appIndex: appId,
    appArgs: [method(name).getSelector(), ...args],
    suggestedParams: { ...sp, fee, flatFee: true },
    ...extra,
  });
}

async function main() {
  console.log(`Funder ${funder.addr}`);
  const minFee = 1000;
  const pqFee = 3 * minFee;

  // ── Deploy ───────────────────────────────────────────────────────────────
  const compile = async (file: string) =>
    new Uint8Array(Buffer.from((await algod.compile(fs.readFileSync(path.join(buildDir, file), 'utf8')).do()).result, 'base64'));
  let sp = await algod.getTransactionParams().do();
  const create = algosdk.makeApplicationCreateTxnFromObject({
    from: funder.addr,
    approvalProgram: await compile('PQCoupon.approval.teal'),
    clearProgram: await compile('PQCoupon.clear.teal'),
    numGlobalInts: 2,
    numGlobalByteSlices: 0,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [method('createApplication').getSelector()],
    suggestedParams: sp,
  });
  const created: any = await send([create.signTxn(funder.sk)], create.txID());
  const appId = Number(created['application-index']);
  const appAddr = algosdk.getApplicationAddress(appId);
  console.log(`App ${appId} (${appAddr})`);

  // ── Bootstrap: fund app, create PQPRINT ──────────────────────────────────
  sp = await algod.getTransactionParams().do();
  const fund = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: funder.addr, to: appAddr, amount: 200_000, suggestedParams: sp });
  const boot = appCall(sp, appId, funder.addr, 'bootstrap', [], 2 * minFee);
  algosdk.assignGroupID([fund, boot]);
  await send([fund.signTxn(funder.sk), boot.signTxn(funder.sk)], boot.txID());
  const coupon = Number((await algod.getApplicationByID(appId).do()).params['global-state'].find((s: any) => Buffer.from(s.key, 'base64').toString() === 'c').value.uint);
  const asset: any = (await algod.getAssetByID(coupon).do()).params;
  console.log(`Coupon ASA ${coupon}: ${asset.name} / ${asset['unit-name']}, decimals ${asset.decimals}, total ${asset.total}`);
  if (asset.decimals !== 6 || asset.name !== 'Wen Tools PQ Coupon' || asset['unit-name'] !== 'PQPRINT') throw new Error('bad ASA params');
  if (asset.manager || asset.freeze || asset.clawback) throw new Error('ASA has admin keys');
  if (asset.reserve !== appAddr) throw new Error('reserve should be the app');
  ok('PQPRINT created by the app: 6 decimals, no manager/freeze/clawback, reserve = app');

  sp = await algod.getTransactionParams().do();
  await expectReject('a second bootstrap', [appCall(sp, appId, funder.addr, 'bootstrap', [], 2 * minFee, { note: enc.encode('again') }).signTxn(funder.sk)]);

  // ── Beneficiary opts in ──────────────────────────────────────────────────
  const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ from: funder.addr, to: funder.addr, amount: 0, assetIndex: coupon, suggestedParams: sp });
  await send([optIn.signTxn(funder.sk)], optIn.txID());

  // ── Make a PQ printer and fund it ────────────────────────────────────────
  const pq = await newPQAccount();
  console.log(`PQ printer ${pq.address} (salt ${pq.salt})`);
  sp = await algod.getTransactionParams().do();
  const load = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: funder.addr, to: pq.address, amount: 300_000, suggestedParams: sp });
  await send([load.signTxn(funder.sk)], load.txID());

  // ── Attack: classic account claiming to be PQ (uses pq's key, its own sender) ──
  sp = await algod.getTransactionParams().do();
  {
    const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: funder.addr, to: appAddr, amount: BOX_MBR, suggestedParams: sp });
    const reg = appCall(sp, appId, funder.addr, 'register', [algosdk.ABIType.from('byte[]').encode(pqKeyArg(pq)), algosdk.decodeAddress(funder.addr).publicKey], pqFee, { boxes: [boxRef(appId, funder.addr)] });
    algosdk.assignGroupID([pay, reg]);
    await expectReject('a classic account registering with someone else\'s PQ key', [pay.signTxn(funder.sk), reg.signTxn(funder.sk)], /assert/);
  }

  // ── Attack: PQ account presenting the wrong public key ───────────────────
  const other = await newPQAccount();
  const registerGroup = async (key: Uint8Array, note: string, beneficiary = funder.addr, acct = pq) => {
    sp = await algod.getTransactionParams().do();
    const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: acct.address, to: appAddr, amount: BOX_MBR, suggestedParams: { ...sp, fee: pqFee, flatFee: true }, note: enc.encode(note) });
    const reg = appCall(sp, appId, acct.address, 'register', [algosdk.ABIType.from('byte[]').encode(key), algosdk.decodeAddress(beneficiary).publicKey], pqFee, {
      boxes: [boxRef(appId, acct.address)],
      accounts: [beneficiary],
      foreignAssets: [coupon],
      note: enc.encode(note),
    });
    algosdk.assignGroupID([pay, reg]);
    return { stxns: [await pqSign(pay, acct), await pqSign(reg, acct)], id: reg.txID() };
  };
  await expectReject('a PQ account presenting the wrong public key', (await registerGroup(pqKeyArg(other), 'wrong')).stxns, /assert/);
  await expectReject('the zero address as beneficiary', (await registerGroup(pqKeyArg(pq), 'zero', algosdk.encodeAddress(new Uint8Array(32)))).stxns, /assert/);
  await expectReject('a beneficiary not opted in to PQPRINT', (await registerGroup(pqKeyArg(pq), 'noopt', algosdk.generateAccount().addr)).stxns, /assert/);

  // ── Attack: print before registering ─────────────────────────────────────
  sp = await algod.getTransactionParams().do();
  await expectReject('printing before registering', [await pqSign(appCall(sp, appId, pq.address, 'print', [], pqFee, { boxes: [boxRef(appId, pq.address)] }), pq)], /assert/);

  // ── Register for real ────────────────────────────────────────────────────
  const real = await registerGroup(pqKeyArg(pq), 'register');
  await send(real.stxns, real.id);
  ok('PQ account registers by proving its address preimage on-chain');
  await expectReject('registering twice', (await registerGroup(pqKeyArg(pq), 'twice')).stxns, /assert/);

  // ── Attack: underpaid print (fee pooled from a classic txn) ──────────────
  sp = await algod.getTransactionParams().do();
  {
    const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: funder.addr, to: funder.addr, amount: 0, suggestedParams: { ...sp, fee: 4 * minFee, flatFee: true } });
    const pr = appCall(sp, appId, pq.address, 'print', [], 0, { boxes: [boxRef(appId, pq.address)], note: enc.encode('cheap') });
    algosdk.assignGroupID([pay, pr]);
    await expectReject('a print that offloads its fee to another txn', [pay.signTxn(funder.sk), await pqSign(pr, pq)], /assert/);
  }

  // ── Attack: print that rekeys (a rekeyed-away account could rekey back mid-print) ──
  sp = await algod.getTransactionParams().do();
  {
    const pr = appCall(sp, appId, pq.address, 'print', [], pqFee, { boxes: [boxRef(appId, pq.address)], note: enc.encode('rekey'), rekeyTo: funder.addr });
    await expectReject('a print carrying a RekeyTo', [await pqSign(pr, pq)], /assert/);
  }

  // ── Print × N (one atomic group of 16, then the rest) ────────────────────
  let printed = 0;
  while (printed < PRINTS) {
    sp = await algod.getTransactionParams().do();
    const n = Math.min(16, PRINTS - printed);
    const txns = Array.from({ length: n }, (_, i) =>
      appCall(sp, appId, pq.address, 'print', [], pqFee, { boxes: [boxRef(appId, pq.address)], note: enc.encode(`print #${printed + i + 1}`) }),
    );
    if (n > 1) algosdk.assignGroupID(txns);
    const stxns = [];
    for (const t of txns) stxns.push(await pqSign(t, pq));
    await send(stxns, txns[0].txID());
    printed += n;
  }
  const pendingBox = await algod.getApplicationBoxByName(appId, boxRef(appId, pq.address).name).do();
  const count = Number(Buffer.from(pendingBox.value).readBigUInt64BE(32));
  if (count !== PRINTS) throw new Error(`box count ${count} != ${PRINTS}`);
  ok(`${PRINTS} Falcon-signed prints counted on-chain`);

  // ── Claim + close out in one group ───────────────────────────────────────
  const before: any = await algod.accountAssetInformation(funder.addr, coupon).do();
  sp = await algod.getTransactionParams().do();
  const claim = appCall(sp, appId, pq.address, 'claim', [], pqFee + 2 * minFee, { boxes: [boxRef(appId, pq.address)], foreignAssets: [coupon], accounts: [funder.addr] });
  const close = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: pq.address, to: funder.addr, amount: 0, closeRemainderTo: funder.addr, suggestedParams: { ...sp, fee: pqFee, flatFee: true } });
  algosdk.assignGroupID([claim, close]);
  await send([await pqSign(claim, pq), await pqSign(close, pq)], close.txID());
  const after: any = await algod.accountAssetInformation(funder.addr, coupon).do();
  const gained = Number(after['asset-holding'].amount) - Number(before['asset-holding'].amount);
  if (gained !== PRINTS * 1_000_000) throw new Error(`beneficiary gained ${gained} base units`);
  ok(`claim paid ${gained / 1e6} PQPRINT to the beneficiary`);

  const boxGone = await algod.getApplicationBoxByName(appId, boxRef(appId, pq.address).name).do().then(() => false, () => true);
  const pqBal = Number((await algod.accountInformation(pq.address).do()).amount);
  if (!boxGone || pqBal !== 0) throw new Error(`box gone ${boxGone}, printer balance ${pqBal}`);
  ok('box deleted, MBR refunded, printer closed out to 0');

  // ── Beneficiary opts out after registering: claim must not lock the deposit ──
  const ben = algosdk.generateAccount();
  const pq2 = await newPQAccount();
  sp = await algod.getTransactionParams().do();
  {
    const f1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: funder.addr, to: ben.addr, amount: 210_000, suggestedParams: sp });
    const f2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: funder.addr, to: pq2.address, amount: 160_000, suggestedParams: sp });
    const opt = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ from: ben.addr, to: ben.addr, amount: 0, assetIndex: coupon, suggestedParams: sp });
    algosdk.assignGroupID([f1, f2, opt]);
    await send([f1.signTxn(funder.sk), f2.signTxn(funder.sk), opt.signTxn(ben.sk)], opt.txID());
  }
  const reg2 = await registerGroup(pqKeyArg(pq2), 'register2', ben.addr, pq2);
  await send(reg2.stxns, reg2.id);
  sp = await algod.getTransactionParams().do();
  const pr2 = appCall(sp, appId, pq2.address, 'print', [], pqFee, { boxes: [boxRef(appId, pq2.address)] });
  await send([await pqSign(pr2, pq2)], pr2.txID());
  // Beneficiary opts out (closes its zero PQPRINT holding to the creator, the app)
  const optOut = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ from: ben.addr, to: appAddr, closeRemainderTo: appAddr, amount: 0, assetIndex: coupon, suggestedParams: sp });
  await send([optOut.signTxn(ben.sk)], optOut.txID());

  sp = await algod.getTransactionParams().do();
  const claim2 = appCall(sp, appId, pq2.address, 'claim', [], pqFee + 2 * minFee, { boxes: [boxRef(appId, pq2.address)], foreignAssets: [coupon], accounts: [ben.addr] });
  const close2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: pq2.address, to: funder.addr, amount: 0, closeRemainderTo: funder.addr, suggestedParams: { ...sp, fee: pqFee, flatFee: true } });
  algosdk.assignGroupID([claim2, close2]);
  const res2: any = await send([await pqSign(claim2, pq2), await pqSign(close2, pq2)], claim2.txID());
  const paid = Number(Buffer.from(res2.logs[0], 'base64').readBigUInt64BE(4));
  const pq2Bal = Number((await algod.accountInformation(pq2.address).do()).amount);
  if (paid !== 0 || pq2Bal !== 0) throw new Error(`forfeit claim paid ${paid}, printer balance ${pq2Bal}`);
  ok('beneficiary opted out: claim forfeits coupons but still refunds the deposit and closes');

  // Return the test beneficiary's ALGO
  const back = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: ben.addr, to: funder.addr, amount: 0, closeRemainderTo: funder.addr, suggestedParams: sp });
  await send([back.signTxn(ben.sk)], back.txID());

  console.log(`\nAll ${passed} checks passed. App ${appId}, PQPRINT ASA ${coupon}`);
}

main().catch((e) => {
  console.error('\nFAILED:', e?.response?.body?.message ?? e);
  process.exit(1);
});
