/**
 * Deploy the Vote Tool factory and bootstrap its registry.
 *
 *   pnpm build:vote-contracts
 *   npx tsx --env-file=contracts/.env contracts/deploy-vote-tool.ts            # testnet
 *   npx tsx --env-file=contracts/.env contracts/deploy-vote-tool.ts mainnet    # mainnet
 *
 * Signs with VOTE_DEPLOYER_MNEMONIC from contracts/.env. That account becomes the factory admin,
 * the only account that can upgrade the factory (which changes the template for new votes only).
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import algosdk from 'algosdk';
import { APP_DEPOSITS } from '../src/utils/voteTemplates';

export type Network = 'testnet' | 'mainnet';

const buildDir = path.join(import.meta.dirname, 'build', 'vote');
const readBin = (file: string) => new Uint8Array(fs.readFileSync(path.join(buildDir, file)));

/** Factory account base + registry creation deposit (charged to the factory) + registry account base. */
const BOOTSTRAP_FUNDING = 100_000 + APP_DEPOSITS.registry + 100_000;

export const algodFor = (network: Network) => new algosdk.Algodv2('', `https://${network}-api.4160.nodely.dev`, '');

/**
 * Create + bootstrap a factory. `payoutGrace` = rounds after the end before an undeliverable payout
 * falls back to refunds (0 → contract default of 200,000 ≈ 1 week). Tests deploy with a short one.
 */
export async function deployVoteFactory(network: Network, account: algosdk.Account, payoutGrace = 0) {
  const algod = algodFor(network);
  const approvalProgram = readBin('VoteFactory.approval.bin');
  const clearProgram = readBin('VoteFactory.clear.bin');
  const arc56 = JSON.parse(fs.readFileSync(path.join(buildDir, 'VoteFactory.arc56.json'), 'utf8'));
  const schema = arc56.state.schema;
  const neededPages = Math.max(0, Math.ceil(approvalProgram.length / 2048) - 1);

  const sp = await algod.getTransactionParams().do();
  const createMethod = algosdk.ABIMethod.fromSignature('createApplication(uint64)void');
  const createWith = (extraPages: number) =>
    algosdk.makeApplicationCreateTxnFromObject({
      sender: account.addr,
      approvalProgram,
      clearProgram,
      numGlobalInts: schema.global.ints,
      numGlobalByteSlices: schema.global.bytes,
      numLocalInts: schema.local.ints,
      numLocalByteSlices: schema.local.bytes,
      extraPages,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      suggestedParams: sp,
      appArgs: [createMethod.getSelector(), algosdk.encodeUint64(payoutGrace)],
    });

  // Program size is fixed at creation, so take the most pages the network allows: future upgrades
  // (bigger Vote templates are embedded in the factory) then fit without a redeploy.
  // v5 raised the app size limit; try its maximum first, then the pre-v5 maximum.
  let createTxn: algosdk.Transaction | null = null;
  for (const pages of [7, 3]) {
    if (pages < neededPages) continue;
    const txn = createWith(pages);
    try {
      await algod.sendRawTransaction(txn.signTxn(account.sk)).do();
      createTxn = txn;
      console.log(`Factory created with ${pages} extra program pages (${2048 * (pages + 1)} bytes max)`);
      break;
    } catch (err: any) {
      if (!/extra.*pages|ExtraProgramPages|too many extra/i.test(String(err?.message))) throw err;
    }
  }
  if (!createTxn) throw new Error('No extra-pages setting was accepted');
  const created = await algosdk.waitForConfirmation(algod, createTxn.txID(), 4);
  const factoryId = Number(created.applicationIndex);

  // bootstrap(pay): creates the registry (one inner create + one inner payment)
  const atc = new algosdk.AtomicTransactionComposer();
  const signer = algosdk.makeBasicAccountTransactionSigner(account);
  atc.addMethodCall({
    appID: factoryId,
    method: algosdk.ABIMethod.fromSignature('bootstrap(pay)uint64'),
    methodArgs: [
      {
        txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: account.addr,
          receiver: algosdk.getApplicationAddress(factoryId),
          amount: BOOTSTRAP_FUNDING,
          suggestedParams: sp,
        }),
        signer,
      },
    ],
    sender: account.addr,
    signer,
    suggestedParams: { ...sp, fee: BigInt(3_000), flatFee: true },
  });
  const res = await atc.execute(algod, 4);
  const registryId = Number(res.methodResults[0].returnValue);
  return { factoryId, registryId };
}

/**
 * Admin-only: replace a deployed factory's program with the current build. Only NEW votes use the
 * new Vote template; existing votes keep their own program. Global schema can't change on update.
 */
export async function upgradeVoteFactory(network: Network, account: algosdk.Account, factoryId: number) {
  const algod = algodFor(network);
  const approvalProgram = readBin('VoteFactory.approval.bin');
  const app = await algod.getApplicationByID(factoryId).do();
  const maxBytes = 2048 * (1 + Number(app.params?.extraProgramPages ?? 0));
  if (approvalProgram.length > maxBytes) throw new Error(`New program (${approvalProgram.length} B) exceeds the app's ${maxBytes} B.`);
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationUpdateTxnFromObject({
    sender: account.addr,
    appIndex: factoryId,
    approvalProgram,
    clearProgram: readBin('VoteFactory.clear.bin'),
    suggestedParams: sp,
  });
  await algod.sendRawTransaction(txn.signTxn(account.sk)).do();
  await algosdk.waitForConfirmation(algod, txn.txID(), 4);
}

async function main() {
  const mnemonic = process.env.VOTE_DEPLOYER_MNEMONIC || process.env.WENPAD_DEPLOYER_MNEMONIC;
  if (!mnemonic) {
    console.error('ERROR: set VOTE_DEPLOYER_MNEMONIC in contracts/.env');
    process.exit(1);
  }
  const network: Network = process.argv[2] === 'mainnet' ? 'mainnet' : 'testnet';
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  // deploy-vote-tool.ts <network> upgrade <factoryId>
  if (process.argv[3] === 'upgrade') {
    const factoryId = Number(process.argv[4]);
    await upgradeVoteFactory(network, account, factoryId);
    console.log(`✅ Factory ${factoryId} upgraded on ${network} to the current build`);
    return;
  }
  console.log(`Deploying VoteFactory to ${network.toUpperCase()} from ${account.addr}`);
  const { factoryId, registryId } = await deployVoteFactory(network, account);
  console.log(`✅ Factory ${factoryId}, registry ${registryId}`);
  console.log(`Set VITE_VOTE_FACTORY_APP_ID_${network.toUpperCase()}=${factoryId} or hardcode it in src/utils/voteTool.ts`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Deployment failed:', err.stack || err);
    process.exit(1);
  });
}
