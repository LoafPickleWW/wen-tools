/**
 * End-to-end test of the Vote Tool contracts on TESTNET (AVM v13 / go-algorand v5).
 *
 *   pnpm build:vote-contracts
 *   npx tsx --env-file=contracts/.env contracts/test/vote-tool.testnet.ts
 *   VOTE_FACTORY_ID=<id> PROMOTE=1 npx tsx …   reuse a deployed factory (grace ≤ 30), then reset its grace
 *
 * Deploys a fresh factory with a 30-round payout grace, creates throwaway wallets funded from
 * VOTE_DEPLOYER_MNEMONIC or WENPAD_DEPLOYER_MNEMONIC (~4 testnet ALGO, mostly returned), and runs every vote mode through to close. The focus
 * is that tokens are always returnable: each scenario checks exact token balances before and
 * after, and that voters' ALGO deposits come back (balance change = fees only).
 *
 * Everything goes through src/utils/voteCore.ts, the same builders the website uses.
 * Test wallets are closed back to the deployer at the end, even when a check fails.
 */
import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import { deployVoteFactory } from '../deploy-vote-tool';
import {
  BALLOT_MBR,
  MODE,
  NFT_MBR,
  REGISTRY_ENTRY_MBR,
  RETURN,
  STATUS,
  buildAction,
  buildCreateVote,
  buildCloseVoterList,
  buildCreateVoterList,
  buildRelease,
  buildVoteEscrow,
  buildVoteHeld,
  buildVoteNft,
  buildVoterListAdd,
  buildVoterListRemove,
  explainVoteError,
  getAlgod,
  getFactoryInfo,
  getVoteState,
  listBallots,
  listRegistry,
  parseCreateVoteResult,
  verifyVote,
  type CreateVoteParams,
} from '../../src/utils/voteCore';
import { APP_DEPOSITS, KNOWN_VOTE_TEMPLATES } from '../../src/utils/voteTemplates';
import { keepVote, type KeeperSigner } from '../../src/utils/voteKeeper';

const NETWORK = 'testnet' as const;
const algod = getAlgod(NETWORK);
const GRACE = 30;
/** Rounds each vote stays open: long enough to cast every ballot (~3 s per round). */
const VOTE_LENGTH = 45;

// ─── tiny test harness ───────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];
function check(cond: unknown, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}
async function expectReject(label: string, fn: () => Promise<unknown>, pattern?: RegExp) {
  try {
    await fn();
    check(false, `${label} (should have been rejected)`);
  } catch (err: any) {
    // Raw algod errors only carry "pc=N"; translate them the same way the site does.
    const msg = explainVoteError(String(err?.message || err));
    check(!pattern || pattern.test(msg), `${label} → rejected${pattern ? ` (${pattern})` : ''}`);
    if (pattern && !pattern.test(msg)) console.log(`      got: ${msg.slice(0, 200)}`);
  }
}

// ─── accounts & signing ──────────────────────────────────────────────────────

const keys = new Map<string, Uint8Array>();

/**
 * Throwaway wallet keys are written to this git-ignored file BEFORE the wallets are funded, so a
 * crash can never strand their ALGO: the next run sweeps anything listed here back to the deployer.
 */
const WALLET_FILE = path.join(import.meta.dirname, '..', '.env.vote-test-wallets');
const savedMnemonics = () => (fs.existsSync(WALLET_FILE) ? fs.readFileSync(WALLET_FILE, 'utf8').split('\n').filter(Boolean) : []);

const mk = () => {
  const a = algosdk.generateAccount();
  keys.set(a.addr.toString(), a.sk);
  fs.appendFileSync(WALLET_FILE, algosdk.secretKeyToMnemonic(a.sk) + '\n', { mode: 0o600 });
  return a.addr.toString();
};

/** Return a wallet's assets to their creators, destroy what it created, and close it to `to`. */
async function sweep(p: string, to: string) {
  const info = await algod.accountInformation(p).do();
  for (const holding of info.assets ?? []) {
    const params = await algod.getAssetByID(holding.assetId).do();
    const owner = params.params!.creator.toString();
    if (owner === p) continue;
    await send([
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: p,
        receiver: owner,
        closeRemainderTo: owner,
        assetIndex: holding.assetId,
        amount: 0,
        suggestedParams: await sp(),
      }),
    ]).catch(() => undefined);
  }
  for (const created of info.createdAssets ?? []) {
    await send([algosdk.makeAssetDestroyTxnWithSuggestedParamsFromObject({ sender: p, assetIndex: created.index, suggestedParams: await sp() })]).catch(
      () => undefined
    );
  }
  if (Number(info.amount) === 0) return;
  await send([algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: p, receiver: to, closeRemainderTo: to, amount: 0, suggestedParams: await sp() })]);
}

/** Sweep every saved wallet (creators of assets last), then forget the ones that closed. */
async function sweepAll(to: string, creatorsLast: string[] = []) {
  const addrs = savedMnemonics().map((m) => {
    const a = algosdk.mnemonicToSecretKey(m);
    keys.set(a.addr.toString(), a.sk);
    return a.addr.toString();
  });
  const ordered = [...addrs.filter((a) => !creatorsLast.includes(a)), ...addrs.filter((a) => creatorsLast.includes(a))];
  // Two passes: a creator can only destroy its assets after the holders closed out.
  const stuck: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    stuck.length = 0;
    for (const p of ordered) {
      try {
        await sweep(p, to);
      } catch (err: any) {
        stuck.push(p);
        if (pass === 1) console.log(`  could not close ${p}: ${String(err?.message || err).slice(0, 120)}`);
      }
    }
    if (!stuck.length) break;
  }
  // Swept keys are archived, never deleted: a vote left open by a crash refunds its creator later,
  // and that ALGO must still be reachable.
  const all = savedMnemonics();
  const keep = all.filter((m) => stuck.includes(algosdk.mnemonicToSecretKey(m).addr.toString()));
  const done = all.filter((m) => !keep.includes(m));
  if (done.length) fs.appendFileSync(WALLET_FILE + '.archive', done.join('\n') + '\n', { mode: 0o600 });
  if (keep.length) fs.writeFileSync(WALLET_FILE, keep.join('\n') + '\n', { mode: 0o600 });
  else if (fs.existsSync(WALLET_FILE)) fs.unlinkSync(WALLET_FILE);
}

async function send(txns: algosdk.Transaction[]) {
  const signed = txns.map((t) => {
    const sk = keys.get(t.sender.toString());
    if (!sk) throw new Error(`no key for ${t.sender}`);
    return t.signTxn(sk);
  });
  await algod.sendRawTransaction(signed).do();
  return algosdk.waitForConfirmation(algod, txns[txns.length - 1].txID(), 8);
}
const sendAll = async (groups: algosdk.Transaction[][]) => {
  for (const g of groups) await send(g);
};

async function sp() {
  return algod.getTransactionParams().do();
}
async function pay(from: string, to: string, amount: number) {
  await send([algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: from, receiver: to, amount, suggestedParams: await sp() })]);
}
async function optIn(addr: string, asset: number) {
  await send([
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: addr, receiver: addr, assetIndex: asset, amount: 0, suggestedParams: await sp() }),
  ]);
}
async function xfer(from: string, to: string, asset: number, amount: number | bigint) {
  await send([algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: from, receiver: to, assetIndex: asset, amount, suggestedParams: await sp() })]);
}
async function createAsset(creator: string, total: number, unitName: string, decimals = 0) {
  const res = await send([
    algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
      sender: creator,
      total,
      decimals,
      defaultFrozen: false,
      unitName,
      assetName: `Vote test ${unitName}`,
      manager: creator,
      suggestedParams: await sp(),
    }),
  ]);
  return Number(res.assetIndex);
}
const tokens = async (addr: string, asset: number) => {
  try {
    return BigInt((await algod.accountAssetInformation(addr, asset).do()).assetHolding?.amount ?? 0);
  } catch {
    return -1n;
  }
};
const algo = async (addr: string) => BigInt((await algod.accountInformation(addr).do()).amount);
/** Retry a node read: long waits see the provider drop connections now and then (ECONNRESET). */
async function retry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i >= attempts || !/fetch failed|ECONNRESET|ETIMEDOUT|socket|5\d\d/i.test(String(err?.message || err) + String(err?.cause ?? ''))) throw err;
      await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
}
const round = async () => retry(async () => Number((await algod.status().do()).lastRound));
async function waitForRound(r: number) {
  let cur = await round();
  while (cur < r) {
    await retry(() => algod.statusAfterBlock(cur).do());
    cur = await round();
  }
}

// ─── vote helpers ────────────────────────────────────────────────────────────

let FACTORY = 0;
let REGISTRY = 0;

async function createVote(creator: string, p: Omit<CreateVoteParams, 'title' | 'description' | 'startRound' | 'endRound'> & Partial<CreateVoteParams>) {
  const now = await round();
  const params: CreateVoteParams = {
    title: p.title ?? 'E2E vote',
    description: p.description ?? 'vote-tool.testnet.ts',
    startRound: p.startRound ?? 0,
    endRound: p.endRound ?? now + VOTE_LENGTH,
    ...p,
  } as CreateVoteParams;
  const conf = await send(await buildCreateVote(NETWORK, FACTORY, creator, params));
  const appId = parseCreateVoteResult(conf);
  return getVoteState(NETWORK, appId);
}
const state = (appId: number) => getVoteState(NETWORK, appId);

/** A KeeperSigner backed by one of the test wallets (fees come out of that wallet). */
const asKeeper = (addr: string): KeeperSigner => ({ addr, sign: (txns) => txns.map((t) => t.signTxn(keys.get(t.sender.toString())!)) });

const isClosed = async (appId: number) => algod.getApplicationByID(appId).do().then(() => false, () => true);

/**
 * Settle a vote the way production does: wait for the end, then let the keeper run
 * finalize → payout → release every ballot/NFT → closeVote. Fails the run if it doesn't close.
 */
async function settle(appId: number, caller: string) {
  const s = await state(appId);
  if (s.status === STATUS.ACTIVE) await waitForRound(s.endRound + 1);
  for (let pass = 0; pass < 3 && !(await isClosed(appId)); pass++) {
    const r = await keepVote(NETWORK, FACTORY, asKeeper(caller), appId);
    if (r.note && !/fee cap/.test(r.note)) throw new Error(`keeper stopped on ${appId}: ${r.note}`);
  }
  if (!(await isClosed(appId))) throw new Error(`vote ${appId} did not close`);
}

// ─── scenarios ───────────────────────────────────────────────────────────────

/** SCENARIOS=7,8,9 runs only those (setup always runs). Default: all. */
const ONLY = (process.env.SCENARIOS || '').split(',').map(Number).filter(Boolean);
const runs = (n: number) => ONLY.length === 0 || ONLY.includes(n);

async function main() {
  const mnemonic = process.env.VOTE_DEPLOYER_MNEMONIC || process.env.WENPAD_DEPLOYER_MNEMONIC;
  if (!mnemonic) throw new Error('Set VOTE_DEPLOYER_MNEMONIC (or WENPAD_DEPLOYER_MNEMONIC) in contracts/.env (a funded testnet account).');
  const deployer = algosdk.mnemonicToSecretKey(mnemonic);
  keys.set(deployer.addr.toString(), deployer.sk);
  const DEPLOYER = deployer.addr.toString();
  // Leftovers from a crashed run go back first.
  if (savedMnemonics().length) {
    console.log(`Sweeping ${savedMnemonics().length} wallet(s) left by an earlier run…`);
    await sweepAll(DEPLOYER);
  }

  // Peak need: creator ~1.9 ALGO (one open vote ≈ 1.3 incl. the ~1 ALGO app deposit, assets, a voter list), voters ~0.5.
  // carol and bob also run keeper passes (fees) and mint a piece each in scenario 7.
  // The creator also leaves one 0.0477 ALGO registry listing per vote (9 votes) and mints 4 assets.
  const FUNDING = { creator: 2_700_000, alice: 600_000, bob: 800_000, carol: 900_000, treasury: 210_000, stranger: 100_000 };
  const reuse = Number(process.env.VOTE_FACTORY_ID || 0);
  const deployCost = reuse ? 0 : APP_DEPOSITS.factory + 100_000 + APP_DEPOSITS.registry + 100_000;
  const need = Object.values(FUNDING).reduce((a, b) => a + b, 0) + deployCost + 50_000; // + fees
  const info = await algod.accountInformation(DEPLOYER).do();
  const spendable = Number(info.amount) - Number(info.minBalance);
  console.log(`Deployer ${DEPLOYER}: ${spendable / 1e6} ALGO spendable, run needs ~${need / 1e6}`);
  if (spendable < need) throw new Error(`Fund ${DEPLOYER} with at least ${((need - spendable) / 1e6).toFixed(2)} more testnet ALGO.`);

  if (reuse) {
    FACTORY = reuse;
    REGISTRY = (await getFactoryInfo(NETWORK, FACTORY)).registry;
    if (!REGISTRY) throw new Error(`Factory ${FACTORY} isn't bootstrapped.`);
  } else {
    ({ factoryId: FACTORY, registryId: REGISTRY } = await deployVoteFactory(NETWORK, deployer, GRACE));
  }
  console.log(`Factory ${FACTORY}, registry ${REGISTRY}`);
  const grace = (await getFactoryInfo(NETWORK, FACTORY)).payoutGrace;
  if (grace > GRACE) throw new Error(`Factory ${FACTORY} has a ${grace}-round payout grace; scenario 5 needs ≤ ${GRACE}.`);

  const creator = mk();
  const alice = mk();
  const bob = mk();
  const carol = mk();
  const treasury = mk();
  const stranger = mk();

  try {
    for (const [p, amount] of [
      [creator, FUNDING.creator],
      [alice, FUNDING.alice],
      [bob, FUNDING.bob],
      [carol, FUNDING.carol],
      [treasury, FUNDING.treasury],
      [stranger, FUNDING.stranger],
    ] as const)
      await pay(DEPLOYER, p, amount);

    // Fungible vote token: creator mints, voters get 10,000 each.
    const TOKEN = await createAsset(creator, 1_000_000, 'VOTE');
    for (const p of [alice, bob, carol, treasury]) await optIn(p, TOKEN);
    for (const p of [alice, bob, carol]) await xfer(creator, p, TOKEN, 10_000);

    if (runs(1)) {
    // ── 1. Hard vote, return to senders ──────────────────────────────────
    console.log('\n1. Hard vote → tokens return to voters');
    const creatorBefore = await algo(creator);
    const v1 = await createVote(creator, {
      mode: MODE.ESCROW,
      asset: TOKEN,
      amountPerVote: 100,
      returnMode: RETURN.SENDERS,
      options: [
        { title: 'Yes', description: '' },
        { title: 'No', description: '' },
      ],
    });
    check(KNOWN_VOTE_TEMPLATES.includes(v1.programHash), 'vote program matches the known template');
    check(await verifyVote(NETWORK, FACTORY, v1), 'registry entry points back at the vote (family write on init)');
    const algoBefore = { alice: await algo(alice), bob: await algo(bob) };
    await send(await buildVoteEscrow(NETWORK, v1, alice, 0, 30, false)); // 3,000 tokens
    await send(await buildVoteEscrow(NETWORK, v1, bob, 1, 10, false)); // 1,000
    await send(await buildVoteEscrow(NETWORK, v1, alice, 1, 5, true)); // +500, moves alice to No
    let s1 = await state(v1.appId);
    check(s1.totalEscrow === 4_500n, `escrow holds 4,500 (${s1.totalEscrow})`);
    check(s1.options[1].weight === 45n && s1.options[0].weight === 0n, 'second deposit moved alice’s whole ballot to "No"');
    check((await tokens(alice, TOKEN)) === 6_500n, 'alice deposited 3,500');
    await expectReject('deposit that isn’t a whole number of votes', async () => {
      // Build a valid 1-vote group, then tamper with the deposit to 150 (1.5 votes) and regroup.
      const group = await buildVoteEscrow(NETWORK, s1, carol, 0, 1, false);
      group.forEach((t) => (t.group = undefined));
      (group[1].assetTransfer as any).amount = 150n;
      algosdk.assignGroupID(group);
      await send(group);
    });
    const reg = (await listRegistry(NETWORK, REGISTRY)).find((e) => e.appId === v1.appId)!;
    check(reg.totalWeight === 45n && reg.voters === 2, 'registry totals were patched by the vote (v13 family write)');
    await expectReject('release before the vote ends', async () => sendAll(await buildRelease(NETWORK, v1.appId, carol, [alice])), /not ended/);
    await settle(v1.appId, carol);
    check((await tokens(alice, TOKEN)) === 10_000n, 'alice got all 3,500 tokens back');
    check((await tokens(bob, TOKEN)) === 10_000n, 'bob got all 1,000 tokens back');
    // Voters paid only fees: the ballot deposit came back.
    const aliceFees = algoBefore.alice - (await algo(alice));
    check(aliceFees > 0n && aliceFees < 20_000n, `alice’s ballot deposit (${BALLOT_MBR} µALGO) was refunded; net cost ${aliceFees} µALGO in fees`);
    // The creator's ~1.3 ALGO (app deposit held by the factory + vote account + boxes) came back,
    // except the registry entry's box deposit: that entry is kept as the vote's permanent listing.
    const creatorCost = creatorBefore - (await algo(creator)) - BigInt(REGISTRY_ENTRY_MBR);
    check(
      creatorCost > 0n && creatorCost < 20_000n,
      `creator’s vote deposit was refunded on close, except the ${REGISTRY_ENTRY_MBR} µALGO registry listing; net ${creatorCost} µALGO in fees`
    );
    const closedEntry = (await listRegistry(NETWORK, REGISTRY)).find((e) => e.appId === v1.appId)!;
    check(closedEntry.status === STATUS.CLOSED && closedEntry.winner === 1, 'registry shows the closed vote with "No" as winner');

    }
    if (runs(2)) {
    // ── 2. Cancel refunds even in payout mode ────────────────────────────
    console.log('\n2. Cancelled payout vote → tokens return to voters');
    const v2 = await createVote(creator, {
      mode: MODE.ESCROW,
      asset: TOKEN,
      amountPerVote: 1,
      returnMode: RETURN.ADDRESS,
      returnAddress: treasury,
      options: [
        { title: 'A', description: '' },
        { title: 'B', description: '' },
      ],
    });
    await send(await buildVoteEscrow(NETWORK, v2, bob, 0, 700, false));
    await expectReject('cancel by a non-creator', async () => send(await buildAction(NETWORK, v2.appId, bob, 'cancel')), /creator only/);
    await send(await buildAction(NETWORK, v2.appId, creator, 'cancel'));
    await settle(v2.appId, alice);
    check((await tokens(bob, TOKEN)) === 10_000n, 'bob’s 700 tokens came back after cancel');
    check((await tokens(treasury, TOKEN)) === 0n, 'treasury received nothing');

    }
    if (runs(3)) {
    // ── 3. Send to address ───────────────────────────────────────────────
    console.log('\n3. Hard vote → pool sent to a fixed address');
    const v3 = await createVote(creator, {
      mode: MODE.ESCROW,
      asset: TOKEN,
      amountPerVote: 10,
      returnMode: RETURN.ADDRESS,
      returnAddress: treasury,
      options: [
        { title: 'A', description: '' },
        { title: 'B', description: '' },
      ],
    });
    await send(await buildVoteEscrow(NETWORK, v3, alice, 0, 20, false));
    await send(await buildVoteEscrow(NETWORK, v3, bob, 1, 30, false));
    await settle(v3.appId, carol);
    check((await tokens(treasury, TOKEN)) === 500n, 'treasury received the whole 500-token pool');
    check((await tokens(alice, TOKEN)) === 9_800n && (await tokens(bob, TOKEN)) === 9_700n, 'voters’ tokens went to the pool, not back');

    }
    if (runs(4)) {
    // ── 4. Winner recipient, and a tie falling back to refunds ───────────
    console.log('\n4. Winner takes pool → recipient; tie → refunds');
    const v4 = await createVote(creator, {
      mode: MODE.ESCROW,
      asset: TOKEN,
      amountPerVote: 10,
      returnMode: RETURN.WINNER,
      options: [
        { title: 'Grant A', description: '', recipient: treasury },
        { title: 'Grant B', description: '', recipient: carol },
      ],
    });
    await send(await buildVoteEscrow(NETWORK, v4, alice, 1, 10, false));
    await send(await buildVoteEscrow(NETWORK, v4, bob, 0, 5, false));
    const carolBefore = await tokens(carol, TOKEN);
    await settle(v4.appId, alice);
    check((await tokens(carol, TOKEN)) - carolBefore === 150n, 'Grant B’s recipient got the 150-token pool');
    // Sequential (not side by side) so the creator only ever has one ~1.3 ALGO vote deposit out.
    const v4tie = await createVote(creator, {
      mode: MODE.ESCROW,
      asset: TOKEN,
      amountPerVote: 10,
      returnMode: RETURN.WINNER,
      options: [
        { title: 'Grant A', description: '', recipient: treasury },
        { title: 'Grant B', description: '', recipient: carol },
      ],
    });
    const aliceBefore4 = await tokens(alice, TOKEN);
    const bobBefore4 = await tokens(bob, TOKEN);
    await send(await buildVoteEscrow(NETWORK, v4tie, alice, 0, 4, false));
    await send(await buildVoteEscrow(NETWORK, v4tie, bob, 1, 4, false));
    await settle(v4tie.appId, alice);
    check((await tokens(alice, TOKEN)) === aliceBefore4 && (await tokens(bob, TOKEN)) === bobBefore4, 'tie: both voters got their 40 tokens back (balances match before voting)');

    }
    if (runs(5)) {
    // ── 5. Undeliverable payout → fallback to refunds after grace ────────
    console.log('\n5. Payout target not opted in → refunds after the grace period');
    const v5 = await createVote(creator, {
      mode: MODE.ESCROW,
      asset: TOKEN,
      amountPerVote: 1,
      returnMode: RETURN.ADDRESS,
      returnAddress: stranger,
      options: [
        { title: 'A', description: '' },
        { title: 'B', description: '' },
      ],
    });
    await send(await buildVoteEscrow(NETWORK, v5, alice, 0, 250, false));
    const aliceBefore5 = await tokens(alice, TOKEN);
    await waitForRound(v5.endRound + 1);
    await send(await buildAction(NETWORK, v5.appId, carol, 'finalize'));
    await expectReject('payout to an address that isn’t opted in', async () => send(await buildAction(NETWORK, v5.appId, carol, 'payout')));
    await expectReject('fallback before the grace period', async () => send(await buildAction(NETWORK, v5.appId, carol, 'fallbackToRefunds')), /grace/);
    await waitForRound(v5.endRound + GRACE + 1);
    await send(await buildAction(NETWORK, v5.appId, carol, 'fallbackToRefunds'));
    await settle(v5.appId, carol);
    check((await tokens(alice, TOKEN)) === aliceBefore5 + 250n, 'alice got her 250 tokens back');

    }
    if (runs(6)) {
    // ── 6. Tokens held (read-only) + recount ─────────────────────────────
    console.log('\n6. Tokens held: nothing moves, recount defeats wallet-hopping');
    const v6 = await createVote(creator, {
      mode: MODE.HELD,
      asset: TOKEN,
      amountPerVote: 100,
      options: [
        { title: 'Yes', description: '' },
        { title: 'No', description: '' },
      ],
    });
    const aliceTokens6 = await tokens(alice, TOKEN);
    await send(await buildVoteHeld(NETWORK, v6, alice, 0, false));
    check((await tokens(alice, TOKEN)) === aliceTokens6, 'voting moved no tokens');
    const w = (await state(v6.appId)).options[0].weight;
    check(w === aliceTokens6 / 100n, `weight = balance ÷ 100 (${w})`);
    // Alice moves everything to carol, who votes again with the same tokens…
    await xfer(alice, carol, TOKEN, aliceTokens6);
    await send(await buildVoteHeld(NETWORK, v6, carol, 0, false));
    // …and the keeper pass that follows carol's vote (what the site triggers) recounts alice to zero.
    const pass6 = await keepVote(NETWORK, FACTORY, asKeeper(bob), v6.appId);
    check(pass6.actions.join() === 'recount 1 ballot(s)', `keeper recounted only alice (${pass6.actions.join() || 'nothing'})`);
    const s6 = await state(v6.appId);
    const carolW = (await listBallots(NETWORK, v6.appId)).find((b) => b.voter === carol)!.weight;
    check(s6.options[0].weight === carolW, 'after recount the moved tokens count once, not twice');
    const idle6 = await keepVote(NETWORK, FACTORY, asKeeper(bob), v6.appId);
    check(idle6.actions.length === 0 && idle6.fees === 0, 'a keeper pass with nothing stale sends no transactions');
    await xfer(carol, alice, TOKEN, aliceTokens6);
    await settle(v6.appId, bob);

    }
    if (runs(7)) {
    // ── 7. NFT collection (read-only) ────────────────────────────────────
    console.log('\n7. NFT collection (two minting wallets + unit prefix): one vote per piece, counted once');
    // The collection is minted from two wallets (creator and carol); only units starting "NFT" count.
    const artist = creator;
    const nft1 = await createAsset(artist, 1, 'NFT1');
    const nft2 = await createAsset(artist, 1, 'NFT2');
    const nft3 = await createAsset(carol, 1, 'NFT3');
    const otherDrop = await createAsset(artist, 1, 'ART1');
    const fake = await createAsset(bob, 1, 'NFT9');
    for (const id of [nft1, nft2]) {
      await optIn(alice, id);
      await xfer(artist, alice, id, 1);
    }
    const v7 = await createVote(creator, {
      mode: MODE.NFT,
      collections: [artist, carol],
      unitPrefix: 'NFT',
      options: [
        { title: 'Red', description: '' },
        { title: 'Blue', description: '' },
      ],
    });
    check(v7.collections.length === 2 && v7.unitPrefix === 'NFT', 'vote stored both minting wallets and the prefix');
    const algoBefore7 = await algo(alice);
    await send(await buildVoteNft(NETWORK, v7, alice, 1, [nft1, nft2], false));
    check((await state(v7.appId)).options[1].weight === 2n, 'two pieces = two votes');
    check((await tokens(alice, nft1)) === 1n, 'pieces stayed in alice’s wallet');
    await send(await buildVoteNft(NETWORK, v7, carol, 0, [nft3], false));
    check((await state(v7.appId)).options[0].weight === 1n, 'a piece from the second minting wallet counts');
    await expectReject('a creator’s asset outside the unit prefix', async () => send(await buildVoteNft(NETWORK, v7, artist, 0, [otherDrop], false)), /collection/);
    await expectReject('a piece from an unlisted wallet', async () => send(await buildVoteNft(NETWORK, v7, bob, 0, [fake], false)), /collection/);
    // Alice passes nft2 to bob; bob can't vote with it until it's recounted.
    await optIn(bob, nft2);
    await xfer(alice, bob, nft2, 1);
    await expectReject('re-using a counted piece', async () => send(await buildVoteNft(NETWORK, v7, bob, 0, [nft2], false)), /already voted/);
    const pass7 = await keepVote(NETWORK, FACTORY, asKeeper(carol), v7.appId);
    check(pass7.actions.join() === 'recount 1 piece(s)', `keeper freed the moved piece (${pass7.actions.join() || 'nothing'})`);
    await send(await buildVoteNft(NETWORK, v7, bob, 0, [nft2], false));
    const s7 = await state(v7.appId);
    check(s7.options[0].weight === 2n && s7.options[1].weight === 1n, 'moved piece now counts for bob only');
    await settle(v7.appId, carol);
    const nftCost = algoBefore7 - (await algo(alice));
    check(nftCost < 30_000n, `alice’s NFT deposits (${NFT_MBR} µALGO each) were refunded; net ${nftCost} µALGO in fees`);

    }
    if (runs(8)) {
    // ── 8. Voter list gate (cross-app box read) ──────────────────────────
    console.log('\n8. Voter list: cross-app box read gates who can vote');
    const listConf = await send(await buildCreateVoterList(NETWORK, FACTORY, creator));
    const listId = parseCreateVoteResult(listConf);
    await send(await buildVoterListAdd(NETWORK, listId, creator, [alice]));
    const v8 = await createVote(creator, {
      mode: MODE.HELD,
      asset: TOKEN,
      amountPerVote: 1,
      gateApp: listId,
      gatePrefix: 'b',
      options: [
        { title: 'A', description: '' },
        { title: 'B', description: '' },
      ],
    });
    await send(await buildVoteHeld(NETWORK, v8, alice, 0, false));
    check(true, 'listed voter can vote');
    await expectReject('unlisted voter', async () => send(await buildVoteHeld(NETWORK, v8, bob, 0, false)), /voter list/);
    await settle(v8.appId, carol);
    await expectReject('closing a list that still has voters', async () => send(await buildCloseVoterList(NETWORK, FACTORY, listId, creator)), /remove every voter/);
    await send(await buildVoterListRemove(NETWORK, listId, creator, [alice]));
    await send(await buildCloseVoterList(NETWORK, FACTORY, listId, creator));
    check((await algod.getApplicationByID(listId).do().then(() => false, () => true)), 'empty voter list closed and its deposits refunded');

    }
    if (runs(9)) {
    // ── 9. Upgrade lock ──────────────────────────────────────────────────
    console.log('\n9. Upgrade before start, locked after');
    const start = (await round()) + 12;
    const v9 = await createVote(creator, {
      mode: MODE.HELD,
      asset: TOKEN,
      amountPerVote: 1,
      startRound: start,
      endRound: start + 10,
      options: [
        { title: 'A', description: '' },
        { title: 'B', description: '' },
      ],
    });
    const app = await algod.getApplicationByID(v9.appId).do();
    const update = async () =>
      send([
        algosdk.makeApplicationUpdateTxnFromObject({
          sender: creator,
          appIndex: v9.appId,
          approvalProgram: app.params!.approvalProgram,
          clearProgram: app.params!.clearStateProgram,
          suggestedParams: await sp(),
        }),
      ]);
    await update();
    check(true, 'creator can update before voting starts');
    await waitForRound(start);
    await expectReject('update after voting starts', update, /locked/);
    await send(await buildAction(NETWORK, v9.appId, creator, 'cancel'));
    await settle(v9.appId, creator);
    }
  } finally {
    // Return every test wallet's ALGO to the deployer (assets go back to their creator first).
    console.log('\nCleaning up test wallets…');
    await sweepAll(DEPLOYER, [creator, bob]);
    if (savedMnemonics().length) console.log(`  ${savedMnemonics().length} wallet(s) kept in ${WALLET_FILE}; the next run retries them.`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }

  // The factory just passed every scenario. With PROMOTE=1, reset its payout grace to the default
  // (~1 week) so it can serve as the public testnet factory instead of deploying another one.
  if (process.env.PROMOTE === '1') {
    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: FACTORY,
      method: algosdk.ABIMethod.fromSignature('setPayoutGrace(uint64)void'),
      methodArgs: [0],
      sender: DEPLOYER,
      signer: algosdk.makeBasicAccountTransactionSigner(deployer),
      suggestedParams: await sp(),
    });
    await atc.execute(algod, 4);
    console.log(`Testnet factory ready: ${FACTORY} (registry ${REGISTRY}), payout grace reset to default`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
