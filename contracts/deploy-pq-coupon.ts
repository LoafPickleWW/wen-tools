/**
 * Deploy PQCoupon and create the PQPRINT ASA.
 *
 *   npx tealscript contracts/PQCoupon.algo.ts contracts/build/ --skip-algod
 *   npx tsx --env-file=contracts/.env contracts/deploy-pq-coupon.ts <testnet|mainnet>
 *
 * Uses DEPLOYER_MNEMONIC (the app creator, who alone can call bootstrap()).
 * Prints the app and asset IDs to put in src/utils/pqCoupon.ts (PQ_COUPON).
 */
import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';

type Network = 'testnet' | 'mainnet';

/** App account: base MBR (0.1) + PQPRINT holding MBR (0.1). Box deposits are paid by printers. */
const APP_SEED = 200_000;

const buildDir = path.join(import.meta.dirname, 'build');
const readTeal = (file: string) => fs.readFileSync(path.join(buildDir, file), 'utf8');

async function deploy(network: Network, mnemonic: string) {
  const algod = new algosdk.Algodv2('', `https://${network}-api.algonode.cloud`, '');
  const deployer = algosdk.mnemonicToSecretKey(mnemonic);
  const info = await algod.accountInformation(deployer.addr).do();
  const spendable = (Number(info.amount) - Number(info.minBalance)) / 1e6;
  console.log(`Deploying PQCoupon to ${network.toUpperCase()} from ${deployer.addr} (${spendable} ALGO spendable)`);
  if (spendable < 0.5) throw new Error(`Fund ${deployer.addr} with at least 0.5 spendable ALGO on ${network}`);

  const compile = async (teal: string) => new Uint8Array(Buffer.from((await algod.compile(teal).do()).result, 'base64'));
  const arc4 = JSON.parse(readTeal('PQCoupon.arc4.json'));
  const contract = new algosdk.ABIContract(arc4);

  let sp = await algod.getTransactionParams().do();
  const create = algosdk.makeApplicationCreateTxnFromObject({
    sender: deployer.addr,
    approvalProgram: await compile(readTeal('PQCoupon.approval.teal')),
    clearProgram: await compile(readTeal('PQCoupon.clear.teal')),
    numGlobalInts: 2,
    numGlobalByteSlices: 0,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [contract.getMethodByName('createApplication').getSelector()],
    suggestedParams: sp,
  });
  await algod.sendRawTransaction(create.signTxn(deployer.sk)).do();
  const created: any = await algosdk.waitForConfirmation(algod, create.txID(), 10);
  const appId = Number(created['application-index']);
  const appAddr = algosdk.getApplicationAddress(appId);
  console.log(`App created: ${appId} (${appAddr})`);

  sp = await algod.getTransactionParams().do();
  const seed = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: deployer.addr, receiver: appAddr, amount: APP_SEED, suggestedParams: sp });
  const boot = algosdk.makeApplicationNoOpTxnFromObject({
    sender: deployer.addr,
    appIndex: appId,
    appArgs: [contract.getMethodByName('bootstrap').getSelector()],
    suggestedParams: { ...sp, fee: 2 * Number(sp.minFee || 1000), flatFee: true },
  });
  algosdk.assignGroupID([seed, boot]);
  await algod.sendRawTransaction([seed.signTxn(deployer.sk), boot.signTxn(deployer.sk)]).do();
  await algosdk.waitForConfirmation(algod, boot.txID(), 10);

  const state = (await algod.getApplicationByID(appId).do()).params?.globalState ?? [];
  const assetId = Number(state.find((s) => Buffer.from(s.key).toString() === 'c')!.value.uint);
  const asset = (await algod.getAssetByID(assetId).do()).params!;
  console.log(`PQPRINT created: ${assetId} — ${asset.name} / ${asset.unitName}, decimals ${asset.decimals}`);
  console.log(`\nSet in src/utils/pqCoupon.ts:\n  ${network}: { appId: ${appId}, assetId: ${assetId} },`);
}

const network = process.argv[2] as Network;
if (network !== 'testnet' && network !== 'mainnet') {
  console.error('Usage: deploy-pq-coupon.ts <testnet|mainnet>');
  process.exit(1);
}
const mnemonic = process.env.DEPLOYER_MNEMONIC;
if (!mnemonic) {
  console.error('DEPLOYER_MNEMONIC is not set (use --env-file=contracts/.env)');
  process.exit(1);
}
deploy(network, mnemonic).catch((e) => {
  console.error(e?.response?.body?.message ?? e);
  process.exit(1);
});
