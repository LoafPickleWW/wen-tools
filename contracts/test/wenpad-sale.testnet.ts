/**
 * End-to-end test of the WenPad sale contracts on TESTNET, against the deployed factory.
 * Covers the audit test plan (contracts/WENPAD_SALE_AUDIT.md), sized to run on ~5 testnet ALGO.
 *
 *   npx tsx --env-file=contracts/.env contracts/test/wenpad-sale.testnet.ts <factoryAppId>
 *
 * Funds test wallets from WENPAD_DEPLOYER_MNEMONIC. Test wallet mnemonics are kept in
 * contracts/.env.testnet-wallets (git-ignored) and progress in contracts/test/.state.json so a
 * failed run can be resumed: completed steps are skipped.
 */

import * as fs from "fs";
import * as path from "path";
import algosdk from "algosdk";
import {
  ARC59_ROUTER_IDS,
  REVEAL_WINDOW,
  STATUS,
  buildAddItemsGroup,
  buildCancelExpired,
  buildCommit,
  buildCreateSale,
  buildDeleteItemPages,
  buildDeleteSale,
  buildRegister,
  buildReveal,
  buildSaleAction,
  buildUpdateMetadata,
  buyerLineItems,
  finalizeGroup,
  getAlgod,
  getCommit,
  getFactoryStats,
  getPayouts,
  getSaleByApp,
  getSaleState,
  listCommits,
  parseCommitResult,
  parseCreateSaleResult,
  parseRevealedAsset,
  waitForRound,
} from "../../src/utils/wenpadSaleCore";

const NETWORK = "testnet" as const;
const FACTORY_ID = Number(process.argv[2]);
if (!FACTORY_ID) throw new Error("Usage: wenpad-sale.testnet.ts <testnet factory app id>");
const FACTORY_ADDR = algosdk.getApplicationAddress(FACTORY_ID);
const ROUTER_ID = ARC59_ROUTER_IDS[NETWORK];

const PRICE = 10_000;
const REVEAL_FEE = 20_000;
const DELIVERY = 400_000;

const algod = getAlgod(NETWORK);
const here = import.meta.dirname;
// Overrides for running a single step against a test-only build without touching the main run:
//   WENPAD_TEST_TAG=short    -> separate wallets/state files
//   WENPAD_REVEAL_WINDOW=20  -> must match the deployed build's REVEAL_WINDOW
//   WENPAD_ONLY_STEP="cancel expired commit"
const TAG = process.env.WENPAD_TEST_TAG ? `-${process.env.WENPAD_TEST_TAG}` : "";
const WALLETS_FILE = path.join(here, "..", `.env.testnet-wallets${TAG}`);
const STATE_FILE = path.join(here, `.state${TAG}.json`);
const ONLY_STEP = process.env.WENPAD_ONLY_STEP;
const SETUP_STEPS = ["fund wallets"];
const REVEAL_WINDOW_ROUNDS = Number(process.env.WENPAD_REVEAL_WINDOW || REVEAL_WINDOW);

// ─── Wallets & state ─────────────────────────────────────────────────────────

type Role = "admin" | "dist" | "buyerA" | "buyerB";
const ROLES: Role[] = ["admin", "dist", "buyerA", "buyerB"];

function loadWallets(): Record<Role, algosdk.Account> {
  const saved: Record<string, string> = fs.existsSync(WALLETS_FILE)
    ? Object.fromEntries(
        fs
          .readFileSync(WALLETS_FILE, "utf8")
          .split("\n")
          .filter((l) => l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
      )
    : {};
  const out = {} as Record<Role, algosdk.Account>;
  for (const role of ROLES) {
    if (!saved[role]) saved[role] = algosdk.secretKeyToMnemonic(algosdk.generateAccount().sk);
    out[role] = algosdk.mnemonicToSecretKey(saved[role]);
  }
  fs.writeFileSync(WALLETS_FILE, ROLES.map((r) => `${r}=${saved[r]}`).join("\n") + "\n");
  return out;
}

const state: Record<string, any> = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const deployer = algosdk.mnemonicToSecretKey(process.env.WENPAD_DEPLOYER_MNEMONIC!);
const w = loadWallets();
const keys = new Map<string, Uint8Array>([[deployer.addr, deployer.sk], ...ROLES.map((r) => [w[r].addr, w[r].sk] as [string, Uint8Array])]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
const results: string[] = [];
const ok = (msg: string) => {
  passed++;
  results.push(`PASS  ${msg}`);
  console.log(`  ✅ ${msg}`);
};
function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  ok(msg);
}

async function send(txns: algosdk.Transaction[], confirmIndex = txns.length - 1) {
  const signed = txns.map((t) => {
    const sk = keys.get(algosdk.encodeAddress(t.from.publicKey));
    if (!sk) throw new Error(`No key for ${algosdk.encodeAddress(t.from.publicKey)}`);
    return t.signTxn(sk);
  });
  await algod.sendRawTransaction(signed).do();
  return algosdk.waitForConfirmation(algod, txns[confirmIndex].txID(), 8);
}

async function expectFail(msg: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return ok(`rejected: ${msg}`);
  }
  throw new Error(`CHECK FAILED: expected rejection: ${msg}`);
}

const sp = () => algod.getTransactionParams().do();
const balance = async (addr: string) => Number((await algod.accountInformation(addr).do()).amount);
const spendable = async (addr: string) => {
  const info = await algod.accountInformation(addr).do();
  return Number(info.amount) - Number(info["min-balance"]);
};
const authAddr = async (addr: string) => (await algod.accountInformation(addr).do())["auth-addr"] || "";
const holds = async (addr: string, asset: number) => {
  try {
    return Number((await algod.accountAssetInformation(addr, asset).do())["asset-holding"].amount);
  } catch {
    return 0;
  }
};

async function pay(from: algosdk.Account, to: string, amount: number, close?: string) {
  const t = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: from.addr,
    to,
    amount,
    closeRemainderTo: close,
    suggestedParams: await sp(),
  });
  return send([t]);
}

async function optIn(acct: algosdk.Account, asset: number) {
  const t = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: acct.addr,
    to: acct.addr,
    amount: 0,
    assetIndex: asset,
    suggestedParams: await sp(),
  });
  return send([t]);
}

/** Raw ABI call (for negative tests and ARC-59 calls not covered by the core builders). */
async function abiCall(appId: number, sig: string, sender: string, args: algosdk.ABIArgument[] = [], extra: algosdk.Transaction[] = []) {
  const atc = new algosdk.AtomicTransactionComposer();
  const signer = algosdk.makeEmptyTransactionSigner();
  extra.forEach((txn) => atc.addTransaction({ txn, signer }));
  atc.addMethodCall({
    appID: appId,
    method: algosdk.ABIMethod.fromSignature(sig),
    methodArgs: args,
    sender,
    suggestedParams: await sp(),
    signer,
  });
  const txns = atc.buildGroup().map((t) => {
    t.txn.group = undefined;
    return t.txn;
  });
  return finalizeGroup(algod, txns);
}

/** Simulate an arbitrary group and report whether the network would reject it. */
async function simulateRejects(txns: algosdk.Transaction[]) {
  txns.forEach((t) => (t.group = undefined));
  const atc = new algosdk.AtomicTransactionComposer();
  txns.forEach((txn) => atc.addTransaction({ txn, signer: algosdk.makeEmptyTransactionSigner() }));
  const { simulateResponse } = await atc.simulate(
    algod,
    new algosdk.modelsv2.SimulateRequest({ txnGroups: [], allowEmptySignatures: true, allowUnnamedResources: true })
  );
  return !!simulateResponse.txnGroups[0].failureMessage;
}

/** Spendable factory balance: must stay ~0 (no stuck deposits) */
async function factorySpare() {
  const info = await algod.accountInformation(algosdk.getApplicationAddress(FACTORY_ID)).do();
  return Number(info.amount) - Number(info["min-balance"]);
}

async function step(name: string, fn: () => Promise<void>) {
  if (ONLY_STEP && name !== ONLY_STEP && !SETUP_STEPS.includes(name)) return;
  if (state.done?.includes(name)) {
    console.log(`⏭  ${name} (done)`);
    return;
  }
  console.log(`▶  ${name}`);
  await fn();
  state.done = [...(state.done || []), name];
  saveState();
}

async function mintNft(n: number) {
  const t = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    from: w.dist.addr,
    total: 1,
    decimals: 0,
    defaultFrozen: false,
    unitName: `WPT${n}`,
    assetName: `WenPad Test #${n}`,
    assetURL: "https://wen.tools",
    manager: w.dist.addr,
    suggestedParams: await sp(),
  });
  const conf = await send([t]);
  return Number(conf["asset-index"]);
}

async function commitAndReveal(buyer: algosdk.Account, revealer: algosdk.Account, beforeReveal?: () => Promise<void>) {
  const st = await getSaleState(NETWORK, state.appId);
  const conf = await send(await buildCommit(NETWORK, buyer.addr, st));
  const { commitId, targetRound } = parseCommitResult(conf);
  const commit = await getCommit(NETWORK, state.appId, commitId);
  check(!!commit && commit.boxMbr === 34_900, `commit #${commitId} stored, box MBR measured as 34,900`);
  if (beforeReveal) await beforeReveal();
  await waitForRound(algod, targetRound);
  const rconf = await send(await buildReveal(NETWORK, revealer.addr, state.appId, commitId));
  return { commitId, targetRound, revealed: parseRevealedAsset(rconf.logs) };
}

// ─── Test run ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Factory ${FACTORY_ID} on ${NETWORK}`);
  console.log(Object.fromEntries(ROLES.map((r) => [r, w[r].addr])));

  await step("fund wallets", async () => {
    await pay(deployer, w.admin.addr, 1_650_000);
    await pay(deployer, w.dist.addr, 600_000);
    await pay(deployer, w.buyerA.addr, 950_000);
    await pay(deployer, w.buyerB.addr, 600_000);
    ok("test wallets funded");
  });

  await step("mint test NFTs", async () => {
    // NFTs + later test mints lock 0.1 ALGO each in the distribution wallet
    if ((await spendable(w.dist.addr)) < 800_000) await pay(deployer, w.dist.addr, 300_000);
    state.assets = [await mintNft(1), await mintNft(2), await mintNft(3)];
    ok(`distribution minted ${state.assets.join(", ")}`);
  });

  const now = async () => Number((await algod.status().do())["last-round"]);
  // Manager = admin wallet; proceeds split 70% admin / 30% deployer
  const saleParams = async (endIn: number) => ({
    admin: w.admin.addr,
    payouts: [
      { address: w.admin.addr, bps: 7_000 },
      { address: deployer.addr, bps: 3_000 },
    ],
    price: PRICE,
    startRound: await now(),
    endRound: (await now()) + endIn,
    revealFee: REVEAL_FEE,
    deliveryBudget: DELIVERY,
    metadata: { name: "WenPad E2E", unitName: "WPT", standard: "ARC3", metadataUrl: "ipfs://test" },
  });

  await step("create sale", async () => {
    await expectFail("manager == collection wallet", async () =>
      buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, { ...(await saleParams(50_000)), admin: w.dist.addr })
    );
    await expectFail("reveal fee below minimum", async () =>
      buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, { ...(await saleParams(50_000)), revealFee: 1_000 })
    );
    // Contract-side split validation (bypassing the client's packPayouts checks)
    const rawSplit = async (entries: [string, number][]) => {
      const p = await saleParams(50_000);
      const packed = new Uint8Array(entries.length * 40);
      entries.forEach(([addr, bps], i) => {
        packed.set(algosdk.decodeAddress(addr).publicKey, i * 40);
        packed.set(algosdk.encodeUint64(bps), i * 40 + 32);
      });
      const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: w.dist.addr, to: algosdk.getApplicationAddress(FACTORY_ID), amount: 1_200_000, suggestedParams: await sp(),
      });
      return abiCall(
        FACTORY_ID,
        "createSale(pay,address,byte[],uint64,uint64,uint64,uint64,uint64,string,string,string,string)uint64",
        w.dist.addr,
        [{ txn: pay, signer: algosdk.makeEmptyTransactionSigner() }, p.admin, packed, p.price, p.startRound, p.endRound,
          p.revealFee, p.deliveryBudget, "x", "x", "ARC3", "x"]
      );
    };
    await expectFail("split totalling 90%", () => rawSplit([[w.admin.addr, 9_000]]));
    await expectFail("split with a 0% share", () => rawSplit([[w.admin.addr, 10_000], [deployer.addr, 0]]));
    await expectFail("split with 6 recipients", () =>
      rawSplit(Array.from({ length: 6 }, (_, i) => [[w.admin.addr, deployer.addr, w.buyerA.addr, w.buyerB.addr, w.dist.addr, FACTORY_ADDR][i], i === 0 ? 5_000 : 1_000] as [string, number]))
    );
    state.factorySpare0 = await factorySpare();
    const conf = await send(await buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, await saleParams(50_000)));
    Object.assign(state, parseCreateSaleResult(conf));
    check((await factorySpare()) === state.factorySpare0, "overpayment refunded (no ALGO stuck in factory)");
    const listing = await getSaleByApp(NETWORK, FACTORY_ID, state.appId);
    check(listing?.saleId === state.saleId && listing.status === STATUS.SETUP, `indexed in factory as sale #${state.saleId}`);
  });

  await step("add items", async () => {
    // Includes a duplicate of asset 1, which the draw must skip once asset 1 is gone
    const items = [...state.assets, state.assets[0]];
    await send(await buildAddItemsGroup(NETWORK, w.dist.addr, state.appId, items, 0));
    const st = await getSaleState(NETWORK, state.appId);
    check(st.total === 4 && st.remaining === 4, "4 items loaded (3 NFTs + 1 duplicate)");
  });

  await step("register", async () => {
    await expectFail("register without the rekey", () => abiCall(state.appId, "register()void", w.dist.addr));
    await expectFail("commit before live", async () =>
      buildCommit(NETWORK, w.buyerA.addr, await getSaleState(NETWORK, state.appId))
    );
    const txns = await buildRegister(NETWORK, w.dist.addr, state.appId);
    await send(txns, txns.length - 2);
    check((await authAddr(w.dist.addr)) === algosdk.getApplicationAddress(state.appId), "distribution rekeyed to sale app");
    check((await getSaleState(NETWORK, state.appId)).status === STATUS.LIVE, "sale is live");
    check((await getSaleByApp(NETWORK, FACTORY_ID, state.appId))?.status === STATUS.LIVE, "factory index synced to live");
  });

  await step("negative: update/delete", async () => {
    const approval = new Uint8Array(Buffer.from((await algod.compile("#pragma version 10\nint 1").do()).result, "base64"));
    for (const [label, appId, from] of [
      ["sale app", state.appId, w.admin.addr],
      ["factory", FACTORY_ID, deployer.addr],
    ] as const) {
      const upd = algosdk.makeApplicationUpdateTxnFromObject({
        from, appIndex: appId, approvalProgram: approval, clearProgram: approval, suggestedParams: await sp(),
      });
      check(await simulateRejects([upd]), `${label} cannot be updated`);
      const del = algosdk.makeApplicationDeleteTxnFromObject({
        from, appIndex: appId, appArgs: [algosdk.ABIMethod.fromSignature("deleteApplication()void").getSelector()],
        suggestedParams: await sp(),
      });
      check(await simulateRejects([del]), `${label} cannot be deleted directly`);
    }
    await expectFail("rando calls pause", () => abiCall(state.appId, "pause()void", w.buyerA.addr));
    await expectFail("syncSale from a non-sale caller", () =>
      abiCall(FACTORY_ID, "syncSale(uint64,uint64,uint64,uint64,uint64,uint64)void", w.buyerA.addr, [
        state.saleId, 0, 0, 0, 999, 3,
      ])
    );
  });

  await step("buyer A: direct delivery", async () => {
    for (const a of state.assets) await optIn(w.buyerA, a);
    const before = await balance(w.buyerA.addr);
    const { revealed, commitId } = await commitAndReveal(w.buyerA, deployer, async () => {
      // Revealing before the target round has passed must fail (only testable if we are fast enough)
      const c = await getCommit(NETWORK, state.appId, (await getSaleState(NETWORK, state.appId)).nextCommit - 1);
      const round = Number((await algod.status().do())["last-round"]);
      if (c && round <= c.targetRound) {
        await expectFail("reveal before target round", () => buildReveal(NETWORK, deployer.addr, state.appId, c.commitId));
      } else {
        console.log("     (skipped early-reveal check: target round already passed)");
      }
    });
    check(!!revealed && revealed.inboxCost === 0, `commit #${commitId} delivered asset ${revealed?.assetId} directly`);
    check((await holds(w.buyerA.addr, revealed!.assetId)) === 1, "buyer A holds the NFT");
    const spent = before - (await balance(w.buyerA.addr));
    check(spent <= PRICE + REVEAL_FEE + 5_000, `deposit refunded (buyer A net cost ${spent / 1e6} ALGO = price + reveal fee + fees)`);
    state.soldA = [revealed!.assetId];
  });

  await step("buyer B: ARC-59 delivery after closing account", async () => {
    // High-severity regression test: buyer closes their account between commit and reveal.
    // Resumable: reuses an existing commit if a previous run stopped part-way.
    let [commit] = await listCommits(NETWORK, state.appId, w.buyerB.addr);
    if (!commit) {
      const conf = await send(await buildCommit(NETWORK, w.buyerB.addr, await getSaleState(NETWORK, state.appId)));
      commit = (await getCommit(NETWORK, state.appId, parseCommitResult(conf).commitId))!;
      check(commit.boxMbr === 34_900, `commit #${commit.commitId} stored, box MBR measured as 34,900`);
    }
    if ((await balance(w.buyerB.addr)) > 0) {
      // An account can only close once it holds no assets: opt out of each (back to its creator)
      const info = await algod.accountInformation(w.buyerB.addr).do();
      for (const holding of info.assets || []) {
        const assetId = Number(holding["asset-id"]);
        const creator = (await algod.getAssetByID(assetId).do()).params.creator;
        await send([
          algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            from: w.buyerB.addr, to: creator, closeRemainderTo: creator, amount: 0, assetIndex: assetId,
            suggestedParams: await sp(),
          }),
        ]);
      }
      await pay(w.buyerB, deployer.addr, 0, deployer.addr);
    }
    check((await balance(w.buyerB.addr)) === 0, `buyer B closed their account after commit #${commit.commitId}`);
    await waitForRound(algod, commit.targetRound);
    const rconf = await send(await buildReveal(NETWORK, deployer.addr, state.appId, commit.commitId));
    const revealed = parseRevealedAsset(rconf.logs);
    check(!!revealed && revealed.inboxCost > 0, `reveal still succeeded via ARC-59 (inbox cost ${revealed!.inboxCost / 1e6} ALGO)`);
    state.inboxAsset = revealed!.assetId;
  });

  await step("buyer B: claim from inbox", async () => {
    await pay(deployer, w.buyerB.addr, 250_000);
    const optin = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: w.buyerB.addr, to: w.buyerB.addr, amount: 0, assetIndex: state.inboxAsset, suggestedParams: await sp(),
    });
    const before = await balance(w.buyerB.addr);
    const txns = await abiCall(ROUTER_ID, "arc59_claim(uint64)void", w.buyerB.addr, [state.inboxAsset], [optin]);
    await send(txns);
    check((await holds(w.buyerB.addr, state.inboxAsset)) === 1, "buyer B claimed the NFT from the inbox");
    const delta = (await balance(w.buyerB.addr)) - before;
    console.log(`     buyer B balance change on claim: ${delta / 1e6} ALGO (includes leftover deposit, minus opt-in MBR and fees)`);
  });

  await step("pause blocks release while pending", async () => {
    const st = await getSaleState(NETWORK, state.appId);
    const conf = await send(await buildCommit(NETWORK, w.buyerA.addr, st));
    const { commitId, targetRound } = parseCommitResult(conf);
    await send(await buildSaleAction(NETWORK, w.admin.addr, state.appId, "pause"));
    await expectFail("commit while paused", async () =>
      buildCommit(NETWORK, w.buyerA.addr, await getSaleState(NETWORK, state.appId))
    );
    await expectFail("release with a pending commit", () => buildSaleAction(NETWORK, w.admin.addr, state.appId, "release"));
    await waitForRound(algod, targetRound);
    const rconf = await send(await buildReveal(NETWORK, deployer.addr, state.appId, commitId));
    const revealed = parseRevealedAsset(rconf.logs);
    check(!!revealed && !state.soldA.includes(revealed.assetId), `reveal while paused delivered a fresh asset ${revealed?.assetId}`);
  });

  await step("sell-out releases the wallet", async () => {
    let st = await getSaleState(NETWORK, state.appId);
    if (st.status !== STATUS.RELEASED) {
      // Only the duplicate of asset 1 can remain: the draw must skip it and refund in full
      // Resumable: a previous attempt may have unpaused already
      if (st.status === STATUS.PAUSED) await send(await buildSaleAction(NETWORK, w.admin.addr, state.appId, "unpause"));
      const before = await balance(w.buyerA.addr);
      const { revealed } = await commitAndReveal(w.buyerA, w.buyerA);
      check(revealed === null, "undeliverable duplicate skipped, no asset revealed");
      const net = before - (await balance(w.buyerA.addr));
      check(net < 10_000, `buyer fully refunded (net cost ${net / 1e6} ALGO = fees only)`);
      st = await getSaleState(NETWORK, state.appId);
    }
    check(st.status === STATUS.RELEASED && st.remaining === 0, "sale released after selling out");
    check((await authAddr(w.dist.addr)) === "", "distribution wallet rekeyed back to itself");
    check((await getSaleByApp(NETWORK, FACTORY_ID, state.appId))?.status === STATUS.RELEASED, "factory index synced to released");
  });

  await step("withdraw, cleanup, delete", async () => {
    const st = await getSaleState(NETWORK, state.appId);
    const [adminBefore, deployerBefore] = [await balance(w.admin.addr), await balance(deployer.addr)];
    check(st.proceeds > 0, `proceeds accumulated: ${st.proceeds / 1e6} ALGO`);
    const listing = await getSaleByApp(NETWORK, FACTORY_ID, state.appId);
    check(listing?.volume === st.proceeds, `factory records volume ${listing?.volume ? listing.volume / 1e6 : 0} ALGO for this Shuffle`);
    const stats = await getFactoryStats(NETWORK, FACTORY_ID);
    check(stats.totalVolume >= st.proceeds, `factory total volume ${stats.totalVolume / 1e6} ALGO`);
    await send(await buildSaleAction(NETWORK, w.buyerB.addr, state.appId, "withdrawProceeds"));
    const toAdmin = (await balance(w.admin.addr)) - adminBefore;
    const toDeployer = (await balance(deployer.addr)) - deployerBefore;
    const expect30 = Math.floor((st.proceeds * 3_000) / 10_000);
    check(toDeployer === expect30 && toAdmin === st.proceeds - expect30,
      `split paid by a third party: ${toAdmin / 1e6} (70% + dust) / ${toDeployer / 1e6} (30%)`);
    check((await getSaleState(NETWORK, state.appId)).proceeds === 0, "proceeds cleared");
    // Anyone can close a released sale (the keeper does it after the last delivery); deposits
    // still return to the collection wallet
    const distBefore = await balance(w.dist.addr);
    for (const g of await buildDeleteItemPages(NETWORK, w.buyerA.addr, state.appId)) await send(g);
    await send(await buildDeleteSale(NETWORK, FACTORY_ID, w.buyerA.addr, state.saleId));
    check((await balance(w.dist.addr)) - distBefore > 1_000_000, "a third party closed the sale; the collection wallet got its deposits back");
    check((await getSaleByApp(NETWORK, FACTORY_ID, state.appId)) === null, "sale removed from factory index");
    await expectFail("sale app deleted", () => algod.getApplicationByID(state.appId).do());
    check((await factorySpare()) === state.factorySpare0, "all factory deposits refunded (factory spare balance unchanged)");

  });

  await step("audit fixes: frozen, maxPrice, owed split, metadata refund", async () => {
    if ((await spendable(w.dist.addr)) < 1_800_000) await pay(deployer, w.dist.addr, 1_200_000);
    if ((await spendable(w.buyerA.addr)) < 1_100_000) await pay(deployer, w.buyerA.addr, 1_100_000);
    if ((await spendable(w.admin.addr)) < 300_000) await pay(deployer, w.admin.addr, 300_000);

    // A default-frozen NFT and a normal one
    const ft = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
      from: w.dist.addr, total: 1, decimals: 0, defaultFrozen: true, unitName: "WPZ", assetName: "WenPad Frozen Test",
      manager: w.dist.addr, freeze: w.dist.addr, suggestedParams: await sp(),
    });
    const frozen = Number((await send([ft]))["asset-index"]);
    const normal = await mintNft(7);
    await optIn(w.buyerA, normal);
    // The attack: opt in to the frozen asset so a delivery of it would fail (free re-roll)
    await optIn(w.buyerA, frozen);

    // 50/50 split with an account that was never funded: a 0.005 ALGO share cannot reach it
    const ghost = algosdk.generateAccount().addr;
    const { saleId, appId } = parseCreateSaleResult(
      await send(await buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, {
        ...(await saleParams(50_000)),
        payouts: [{ address: w.admin.addr, bps: 5_000 }, { address: ghost, bps: 5_000 }],
      }))
    );
    state.appId = appId;
    await send(await buildAddItemsGroup(NETWORK, w.dist.addr, appId, [frozen, normal], 0));
    const reg = await buildRegister(NETWORK, w.dist.addr, appId);
    await send(reg, reg.length - 2);

    // M-2: a commit whose maxPrice is below the current price is rejected
    const st = await getSaleState(NETWORK, appId);
    await expectFail("commit with maxPrice below the price", async () => {
      const p = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: w.buyerA.addr, to: algosdk.getApplicationAddress(appId), amount: buyerLineItems(st).total, suggestedParams: await sp(),
      });
      return abiCall(appId, "commit(pay,uint64)uint64", w.buyerA.addr, [
        { txn: p, signer: algosdk.makeEmptyTransactionSigner() }, st.price - 1,
      ]);
    });

    // H-1: the frozen asset is never delivered, whatever the draw
    const first = await commitAndReveal(w.buyerA, deployer);
    check(first.revealed?.assetId === normal, `draw delivered the normal NFT ${normal}`);
    if ((await getSaleState(NETWORK, appId)).remaining > 0) {
      const before = await balance(w.buyerA.addr);
      const second = await commitAndReveal(w.buyerA, deployer);
      check(second.revealed === null, "frozen asset dropped on the next draw; nothing revealed");
      check(before - (await balance(w.buyerA.addr)) < 10_000, "buyer refunded in full");
    }
    check((await holds(w.buyerA.addr, frozen)) === 0, "default-frozen asset never reached the buyer");
    check((await getSaleState(NETWORK, appId)).status === STATUS.RELEASED, "sale released");

    // M-1: the unreachable share is owed to that recipient only; repeated withdrawals never re-split it
    const adminBefore = await balance(w.admin.addr);
    for (let i = 0; i < 3; i++) await send(await buildSaleAction(NETWORK, w.buyerA.addr, appId, "withdrawProceeds"));
    check((await balance(w.admin.addr)) - adminBefore === PRICE / 2, "admin got exactly its 50% after 3 withdrawals");
    const pBox = (await algod.getApplicationBoxByName(appId, new TextEncoder().encode("p")).do()).value;
    const owed = Number(algosdk.decodeUint64(pBox.slice(48 + 40, 48 + 48), "bigint"));
    check(pBox.length === 96 && owed === PRICE / 2, `unreachable share of ${owed / 1e6} ALGO kept as owed to that recipient alone`);
    check((await getSaleState(NETWORK, appId)).proceeds === PRICE / 2, "proceeds = the owed amount");
    const payouts = await getPayouts(NETWORK, appId);
    check(payouts.length === 2 && payouts[1].address === ghost && payouts[1].bps === 5_000, "client reads the 48-byte split");

    // L-4: updateMetadata refunds the overpayment (the client pays a worst-case 0.16 ALGO)
    const adminBeforeMeta = await balance(w.admin.addr);
    await send(await buildUpdateMetadata(NETWORK, FACTORY_ID, w.admin.addr, saleId, (await saleParams(1)).metadata));
    const metaCost = adminBeforeMeta - (await balance(w.admin.addr));
    check(metaCost <= 5_000, `metadata update overpayment refunded (net cost ${metaCost / 1e6} ALGO = fees)`);

    // Option 2: a third party closes it; the unreachable owed amount folds into the collection wallet's refund
    const distBefore = await balance(w.dist.addr);
    const adminBeforeClose = await balance(w.admin.addr);
    await send(await buildDeleteSale(NETWORK, FACTORY_ID, deployer.addr, saleId));
    check((await getSaleByApp(NETWORK, FACTORY_ID, appId)) === null, "third party closed the sale");
    check((await balance(w.dist.addr)) > distBefore, "deposits (and the unreachable share) returned to the collection wallet");
    check((await balance(w.admin.addr)) === adminBeforeClose, "admin was not paid twice at close");
  });

  await step("permissionless release after end", async () => {
    const asset = await mintNft(4);
    const conf = await send(await buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, await saleParams(15)));
    const { saleId, appId } = parseCreateSaleResult(conf);
    state.sale2 = { saleId, appId };
    saveState();
    await send(await buildAddItemsGroup(NETWORK, w.dist.addr, appId, [asset], 0));
    const reg = await buildRegister(NETWORK, w.dist.addr, appId);
    await send(reg, reg.length - 2);
    const end = (await getSaleState(NETWORK, appId)).endRound;
    await expectFail("third-party release before end", () => buildSaleAction(NETWORK, deployer.addr, appId, "release"));
    await waitForRound(algod, end, 120_000);
    await send(await buildSaleAction(NETWORK, deployer.addr, appId, "release"));
    check((await authAddr(w.dist.addr)) === "", "anyone could release the wallet after the end round");
    for (const g of await buildDeleteItemPages(NETWORK, w.admin.addr, appId)) await send(g);
    await send(await buildDeleteSale(NETWORK, FACTORY_ID, w.admin.addr, saleId));
    check((await getSaleByApp(NETWORK, FACTORY_ID, appId)) === null, "second sale closed and refunded");
  });

  await step("cancel expired commit", async () => {
    if (!state.sale3) {
      if ((await spendable(w.dist.addr)) < 1_250_000) await pay(deployer, w.dist.addr, 300_000);
      const asset = await mintNft(5);
      const conf = await send(await buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, await saleParams(50_000)));
      state.sale3 = parseCreateSaleResult(conf);
      saveState();
      await send(await buildAddItemsGroup(NETWORK, w.admin.addr, state.sale3.appId, [asset], 0));
      const reg = await buildRegister(NETWORK, w.dist.addr, state.sale3.appId);
      await send(reg, reg.length - 2);
      if ((await spendable(w.buyerA.addr)) < 480_000) await pay(deployer, w.buyerA.addr, 500_000);
      const cconf = await send(await buildCommit(NETWORK, w.buyerA.addr, await getSaleState(NETWORK, state.sale3.appId)));
      Object.assign(state.sale3, parseCommitResult(cconf));
      saveState();
    }
    const { appId, saleId, commitId, targetRound } = state.sale3;
    await expectFail("cancelExpired inside the reveal window", () =>
      buildCancelExpired(NETWORK, deployer.addr, appId, commitId)
    );
    console.log(`     waiting for round ${targetRound + REVEAL_WINDOW_ROUNDS + 1} (~${Math.round((REVEAL_WINDOW_ROUNDS * 2.8) / 60)} min)…`);
    await waitForRound(algod, targetRound + REVEAL_WINDOW_ROUNDS, 70 * 60_000);

    const commit = await getCommit(NETWORK, appId, commitId);
    const owed = commit!.price + commit!.revealFee + commit!.deposit + commit!.boxMbr;
    const before = await balance(w.buyerA.addr);
    await send(await buildCancelExpired(NETWORK, deployer.addr, appId, commitId));
    check((await balance(w.buyerA.addr)) - before === owed, `expired commit refunded in full (${owed / 1e6} ALGO)`);
    check((await getSaleState(NETWORK, appId)).pending === 0, "pending cleared, so release is possible again");

    await send(await buildSaleAction(NETWORK, w.admin.addr, appId, "release"));
    check((await authAddr(w.dist.addr)) === "", "admin released the wallet after the cancel");
    for (const g of await buildDeleteItemPages(NETWORK, w.admin.addr, appId)) await send(g);
    await send(await buildDeleteSale(NETWORK, FACTORY_ID, w.admin.addr, saleId));
    check((await getSaleByApp(NETWORK, FACTORY_ID, appId)) === null, "third sale closed and refunded");
  });

  /** Close out a released sale and confirm it left the index */
  const closeSale = async (appId: number, saleId: number, label: string) => {
    for (const g of await buildDeleteItemPages(NETWORK, w.admin.addr, appId)) await send(g);
    await send(await buildDeleteSale(NETWORK, FACTORY_ID, w.admin.addr, saleId));
    check((await getSaleByApp(NETWORK, FACTORY_ID, appId)) === null, `${label} closed and refunded`);
  };
  const itemPages = async (appId: number) =>
    (await algod.getApplicationBoxes(appId).do()).boxes
      .map((b) => b.name)
      .filter((n) => n.length === 9 && n[0] === "i".charCodeAt(0))
      .map((n) => Number(algosdk.decodeUint64(n.slice(1), "bigint")))
      .sort();

  await step("page boundary", async () => {
    // One fungible asset listed 129 times: page 0 holds 128 items, page 1 holds 1
    // Sale deposit (~1.0) + two item pages (~0.83)
    // Resumable: setup is recorded in state.boundary once the sale is live
    if (!state.boundary) {
      if ((await spendable(w.dist.addr)) < 1_400_000) await pay(deployer, w.dist.addr, 600_000);
      if ((await spendable(w.admin.addr)) < 1_000_000) await pay(deployer, w.admin.addr, 600_000);
      const ct = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: w.dist.addr, total: 200, decimals: 0, defaultFrozen: false, unitName: "WPF", assetName: "WenPad Fungible Test",
        suggestedParams: await sp(),
      });
      const fungible = Number((await send([ct]))["asset-index"]);
      await optIn(w.buyerA, fungible);

      const { saleId, appId } = parseCreateSaleResult(
        await send(await buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, await saleParams(50_000)))
      );
      await send(await buildAddItemsGroup(NETWORK, w.admin.addr, appId, Array(129).fill(fungible), 0));
      check(JSON.stringify(await itemPages(appId)) === "[0,1]", "129 items span two pages (0 and 1)");
      const reg = await buildRegister(NETWORK, w.dist.addr, appId);
      await send(reg, reg.length - 2);
      state.boundary = { saleId, appId, fungible };
      saveState();
    }
    const { saleId, appId, fungible } = state.boundary;
    // Two mints, each needing price + reveal fee + ~0.43 refundable deposit
    if ((await spendable(w.buyerA.addr)) < 600_000) await pay(deployer, w.buyerA.addr, 600_000);

    state.appId = appId;
    const first = await commitAndReveal(w.buyerA, deployer);
    check(first.revealed?.assetId === fungible, "first draw delivered across the page boundary");
    check(JSON.stringify(await itemPages(appId)) === "[0]", "emptied last page was deleted");
    const second = await commitAndReveal(w.buyerA, deployer);
    check(second.revealed?.assetId === fungible, "second draw delivered from page 0");
    const st = await getSaleState(NETWORK, appId);
    check(st.remaining === 127 && st.sold === 2, "remaining 127, sold 2");
    const page0 = (await algod.getApplicationBoxByName(appId, new Uint8Array([105, ...algosdk.encodeUint64(0)])).do()).value;
    const intact = Array.from({ length: 127 }, (_, i) => Number(algosdk.decodeUint64(page0.slice(i * 8, i * 8 + 8), "bigint")));
    check(intact.every((id) => id === fungible), "item list intact after swap-and-pop");
    check((await holds(w.buyerA.addr, fungible)) === 2, "buyer holds 2 units");

    await send(await buildSaleAction(NETWORK, w.admin.addr, appId, "release"));
    check((await authAddr(w.dist.addr)) === "", "admin released the wallet mid-sale");
    await closeSale(appId, saleId, "boundary sale");
  });

  await step("nothing deliverable refund", async () => {
    // The only item is an asset the distribution wallet is not even opted in to
    const foreign = Number(process.env.WENPAD_FOREIGN_ASSET || 773804196);
    if ((await spendable(w.buyerB.addr)) < 480_000) await pay(deployer, w.buyerB.addr, 500_000);
    const { saleId, appId } = parseCreateSaleResult(
      await send(await buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, await saleParams(50_000)))
    );
    await send(await buildAddItemsGroup(NETWORK, w.dist.addr, appId, [foreign], 0));
    const reg = await buildRegister(NETWORK, w.dist.addr, appId);
    await send(reg, reg.length - 2);

    state.appId = appId;
    const before = await balance(w.buyerB.addr);
    const { revealed } = await commitAndReveal(w.buyerB, deployer);
    check(revealed === null, "undeliverable item skipped, nothing revealed");
    const net = before - (await balance(w.buyerB.addr));
    check(net === 2_000, `buyer refunded in full (net cost ${net / 1e6} ALGO = commit fees only)`);
    const st = await getSaleState(NETWORK, appId);
    check(st.status === STATUS.RELEASED && st.remaining === 0, "empty sale auto-released");
    check((await authAddr(w.dist.addr)) === "", "distribution wallet rekeyed back");
    await closeSale(appId, saleId, "undeliverable sale");
  });

  await step("keeper endpoint", async () => {
    const keeper = algosdk.generateAccount();
    keys.set(keeper.addr, keeper.sk);
    await pay(deployer, keeper.addr, 200_000);
    process.env.KEEPER_MNEMONIC = algosdk.secretKeyToMnemonic(keeper.sk);
    process.env.WENPAD_SALE_FACTORY_APP_ID_TESTNET = String(FACTORY_ID);
    const { default: handler } = await import("../../api/wenpad-reveal");
    const call = async (body: unknown) => {
      let status = 0;
      let json: any;
      const res: any = { status: (s: number) => ((status = s), res), json: (j: unknown) => ((json = j), res) };
      await handler({ method: "POST", body } as any, res);
      return { status, json };
    };

    check((await call({ network: "testnet", appId: -1, commitId: 1 })).status === 400, "keeper rejects bad input");
    check((await call({ network: "testnet", appId: ROUTER_ID, commitId: 1 })).status === 404, "keeper refuses non-WenPad apps");

    const assets = [await mintNft(6), await mintNft(8)];
    for (const a of assets) await optIn(w.buyerA, a);
    const { saleId, appId } = parseCreateSaleResult(
      await send(await buildCreateSale(NETWORK, FACTORY_ID, w.dist.addr, await saleParams(50_000)))
    );
    await send(await buildAddItemsGroup(NETWORK, w.dist.addr, appId, assets, 0));
    const reg = await buildRegister(NETWORK, w.dist.addr, appId);
    await send(reg, reg.length - 2);

    // C-1: two pending mints. The second can't be revealed before the first, even once its seed exists
    const first = parseCommitResult(
      await send(await buildCommit(NETWORK, w.buyerA.addr, await getSaleState(NETWORK, appId)))
    );
    const { commitId, targetRound } = parseCommitResult(
      await send(await buildCommit(NETWORK, w.buyerA.addr, await getSaleState(NETWORK, appId)))
    );
    await waitForRound(algod, targetRound);
    await expectFail(`reveal commit #${commitId} before #${first.commitId}`, () =>
      buildReveal(NETWORK, deployer.addr, appId, commitId)
    );
    await expectFail(`cancel commit #${commitId} out of order`, () =>
      buildCancelExpired(NETWORK, deployer.addr, appId, commitId)
    );

    // Asking the keeper for the second mint resolves the queue in order
    const keeperBefore = await balance(keeper.addr);
    const res = await call({ network: "testnet", appId, commitId });
    check(res.status === 200 && assets.includes(res.json.assetId), `keeper resolved #${first.commitId} then #${commitId} -> asset ${res.json?.assetId}`);
    check((await holds(w.buyerA.addr, assets[0])) === 1 && (await holds(w.buyerA.addr, assets[1])) === 1,
      "buyer received both NFTs with one signature per mint");
    // The reveal sold it out, so the keeper closed it in the same request
    check(res.json.closed === true, "keeper auto-closed the sold-out Shuffle");
    check((await getSaleByApp(NETWORK, FACTORY_ID, appId)) === null, `sold-out Shuffle #${saleId} left the index`);
    await expectFail("sale app deleted after auto-close", () => algod.getApplicationByID(appId).do());
    const net = (await balance(keeper.addr)) - keeperBefore;
    check(net > 0, `keeper net ${net / 1e6} ALGO after reveal bounty and close fees`);
    check((await call({ network: "testnet", appId, commitId })).status === 404, "keeper reports a closed Shuffle");

    await pay(keeper, deployer.addr, 0, deployer.addr);
  });

  console.log(`\n${passed} checks passed this run.`);
}

main().catch((err) => {
  console.error("\n❌", err?.message || err);
  saveState();
  process.exit(1);
});
