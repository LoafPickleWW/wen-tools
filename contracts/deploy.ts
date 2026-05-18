import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';

// Load ARC32 JSON spec dynamically to prevent ESM import resolution issues
const AgentFactoryARC32 = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'build', 'AgentFactory.arc32.json'), 'utf8')
);

async function deployToNetwork(network: 'testnet' | 'mainnet', mnemonic: string) {
  console.log(`\nDeploying to ${network.toUpperCase()}...`);
  
  // Set up clients
  const server = `https://${network}-api.4160.nodely.dev`;
  const algod = new algosdk.Algodv2('', server, '');
  
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  console.log(`Deployer Address: ${account.addr}`);

  // Get balance
  const accountInfo = await algod.accountInformation(account.addr).do();
  console.log(`Balance: ${accountInfo.amount / 1e6} ALGO`);

  if (accountInfo.amount < 200000) {
    throw new Error(`Insufficient funds on ${network}. Please fund ${account.addr}`);
  }

  // Compile programs
  const approvalTeal = Buffer.from(AgentFactoryARC32.source.approval, 'base64').toString('utf-8');
  const clearTeal = Buffer.from(AgentFactoryARC32.source.clear, 'base64').toString('utf-8');
  
  const approvalCompiled = await algod.compile(approvalTeal).do();
  const clearCompiled = await algod.compile(clearTeal).do();

  console.log('Deploying AgentFactory contract...');
  const suggestedParams = await algod.getTransactionParams().do();
  
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    from: account.addr,
    approvalProgram: new Uint8Array(Buffer.from(approvalCompiled.result, 'base64')),
    clearProgram: new Uint8Array(Buffer.from(clearCompiled.result, 'base64')),
    numGlobalInts: AgentFactoryARC32.state.global.num_uints,
    numGlobalByteSlices: AgentFactoryARC32.state.global.num_byte_slices,
    numLocalInts: AgentFactoryARC32.state.local.num_uints,
    numLocalByteSlices: AgentFactoryARC32.state.local.num_byte_slices,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    suggestedParams,
    extraPages: 0,
    appArgs: [new Uint8Array(Buffer.from("b8447b36", "hex"))] // ABI method "createApplication()void" selector
  });

  const signedTxn = txn.signTxn(account.sk);
  await algod.sendRawTransaction(signedTxn).do();
  
  console.log(`Waiting for confirmation of txID ${txn.txID().toString()}...`);
  await algosdk.waitForConfirmation(algod, txn.txID().toString(), 4);
  
  const ptx = await algod.pendingTransactionInformation(txn.txID().toString()).do();
  const appId = ptx['application-index'];

  console.log(`✅ Success!`);
  console.log(`App ID: ${appId}`);
  console.log(`Txn ID: ${txn.txID().toString()}`);
  
  return appId;
}

async function main() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC;
  if (!mnemonic || mnemonic.startsWith('word1')) {
    console.error('ERROR: Please set DEPLOYER_MNEMONIC in contracts/.env with a real mnemonic.');
    process.exit(1);
  }

  try {
    const testnetAppId = await deployToNetwork('testnet', mnemonic);
    const mainnetAppId = await deployToNetwork('mainnet', mnemonic);

    console.log('\nDeployment Complete!');
    console.log(`Testnet Factory App ID: ${testnetAppId}`);
    console.log(`Mainnet Factory App ID: ${mainnetAppId}`);
    
    // Auto-update .env files
    const rootEnvPath = path.join(import.meta.dirname, '..', '.env');
    let rootEnvStr = fs.existsSync(rootEnvPath) ? fs.readFileSync(rootEnvPath, 'utf-8') : '';
    
    if (rootEnvStr.includes('VITE_FACTORY_APP_ID_MAINNET=')) {
      rootEnvStr = rootEnvStr.replace(/VITE_FACTORY_APP_ID_MAINNET=.*/, `VITE_FACTORY_APP_ID_MAINNET=${mainnetAppId}`);
    } else {
      rootEnvStr += `\nVITE_FACTORY_APP_ID_MAINNET=${mainnetAppId}`;
    }
    
    if (rootEnvStr.includes('VITE_FACTORY_APP_ID_TESTNET=')) {
      rootEnvStr = rootEnvStr.replace(/VITE_FACTORY_APP_ID_TESTNET=.*/, `VITE_FACTORY_APP_ID_TESTNET=${testnetAppId}`);
    } else {
      rootEnvStr += `\nVITE_FACTORY_APP_ID_TESTNET=${testnetAppId}`;
    }
    
    fs.writeFileSync(rootEnvPath, rootEnvStr.trim() + '\n');
    console.log(`\nUpdated ${rootEnvPath} with new App IDs!`);

  } catch (err: any) {
    console.error('Deployment failed:', err.stack || err);
  }
}

main();
