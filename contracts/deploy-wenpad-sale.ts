import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';

// ARC-59 router app IDs (same as src/arc59-helpers.ts)
const ARC59_ROUTER: Record<Network, number> = {
  mainnet: 2449590623,
  testnet: 643020148,
};

// Factory account base MBR, funded once after creation
const FACTORY_SEED = 100_000;

type Network = 'testnet' | 'mainnet';

// WENPAD_BUILD_DIR lets tests deploy an alternative build (e.g. the short reveal-window test build)
const buildDir = process.env.WENPAD_BUILD_DIR || path.join(import.meta.dirname, 'build');
const readTeal = (file: string) => fs.readFileSync(path.join(buildDir, file), 'utf8');

async function deployToNetwork(network: Network, mnemonic: string) {
  console.log(`\nDeploying WenPadSaleFactory to ${network.toUpperCase()}...`);

  const algod = new algosdk.Algodv2('', `https://${network}-api.4160.nodely.dev`, '');
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  console.log(`Deployer Address: ${account.addr}`);

  const accountInfo = await algod.accountInformation(account.addr).do();
  console.log(`Balance: ${accountInfo.amount / 1e6} ALGO`);
  if (accountInfo.amount < 1_000_000) {
    throw new Error(`Insufficient funds on ${network}. Please fund ${account.addr} with at least 1 ALGO`);
  }

  const compile = async (teal: string) =>
    new Uint8Array(Buffer.from((await algod.compile(teal).do()).result, 'base64'));

  // Compile the sale (child) program and inject it into the factory
  const childApproval = await compile(readTeal('WenPadSale.approval.teal'));
  const childClear = await compile(readTeal('WenPadSale.clear.teal'));

  const factoryTeal = readTeal('WenPadSaleFactory.approval.teal')
    .replace('PENDING_COMPILE_APPROVAL: WenPadSale', `byte base64(${Buffer.from(childApproval).toString('base64')})`)
    .replace('PENDING_COMPILE_CLEAR: WenPadSale', `byte base64(${Buffer.from(childClear).toString('base64')})`);

  const approvalProgram = await compile(factoryTeal);
  const clearProgram = await compile(readTeal('WenPadSaleFactory.clear.teal'));
  const extraPages = Math.ceil(approvalProgram.length / 2048) - 1;
  console.log(`Sale program: ${childApproval.length} bytes, factory program: ${approvalProgram.length} bytes`);

  const arc32 = JSON.parse(fs.readFileSync(path.join(buildDir, 'WenPadSaleFactory.arc32.json'), 'utf8'));
  const createMethod = algosdk.ABIMethod.fromSignature('createApplication(uint64)void');

  const suggestedParams = await algod.getTransactionParams().do();
  const createTxn = algosdk.makeApplicationCreateTxnFromObject({
    from: account.addr,
    approvalProgram,
    clearProgram,
    numGlobalInts: arc32.state.global.num_uints,
    numGlobalByteSlices: arc32.state.global.num_byte_slices,
    numLocalInts: arc32.state.local.num_uints,
    numLocalByteSlices: arc32.state.local.num_byte_slices,
    extraPages,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    suggestedParams,
    appArgs: [createMethod.getSelector(), algosdk.encodeUint64(ARC59_ROUTER[network])],
  });

  await algod.sendRawTransaction(createTxn.signTxn(account.sk)).do();
  console.log(`Waiting for confirmation of txID ${createTxn.txID()}...`);
  const result = await algosdk.waitForConfirmation(algod, createTxn.txID(), 4);
  const appId = Number(result['application-index']);

  // Fund the factory account's base MBR so it can hold boxes
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: account.addr,
    to: algosdk.getApplicationAddress(appId),
    amount: FACTORY_SEED,
    suggestedParams,
  });
  await algod.sendRawTransaction(fundTxn.signTxn(account.sk)).do();
  await algosdk.waitForConfirmation(algod, fundTxn.txID(), 4);

  console.log(`✅ Success!`);
  console.log(`Factory App ID: ${appId}`);
  console.log(`Factory Address: ${algosdk.getApplicationAddress(appId)}`);
  return appId;
}

async function main() {
  // Separate from DEPLOYER_MNEMONIC (agent marketplace) so the two deployers stay independent
  const mnemonic = process.env.WENPAD_DEPLOYER_MNEMONIC;
  if (!mnemonic) {
    console.error('ERROR: Please set WENPAD_DEPLOYER_MNEMONIC in contracts/.env.');
    process.exit(1);
  }

  // Testnet by default; pass "mainnet" explicitly to deploy there
  const network: Network = process.argv[2] === 'mainnet' ? 'mainnet' : 'testnet';

  try {
    const appId = await deployToNetwork(network, mnemonic);
    console.log(`\nHardcode ${appId} as the ${network} factory ID in src/utils/wenpadSale.ts and api/wenpad-reveal.ts`);
  } catch (err: any) {
    console.error('Deployment failed:', err.stack || err);
    process.exit(1);
  }
}

main();
