import { PeraWalletConnect } from "@perawallet/connect";
import * as algosdk from "algosdk";
import {
  algosToMicroalgos,
  computeGroupID,
  encodeAddress,
  makeAssetConfigTxnWithSuggestedParamsFromObject,
  makeAssetCreateTxnWithSuggestedParamsFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
  signTransaction,
  makeAssetDestroyTxnWithSuggestedParamsFromObject,
  makeAssetFreezeTxnWithSuggestedParamsFromObject,
  decodeAddress,
} from "algosdk";
import axios from "axios";
import { CID } from "multiformats/cid";
import { toast } from "react-toastify";
import {
  MAINNET_ALGONODE_INDEXER,
  MINT_FEE_PER_ASA,
  MINT_FEE_WALLET,
  TESTNET_ALGONODE_INDEXER,
  UPDATE_FEE_PER_ASA,
  CREATOR_WALLETS,
  PREFIXES,
  IPFS_ENDPOINT,
  MAINNET_NFD_API_BASE_URL,
  TESTNET_NFD_API_BASE_URL,
} from "./constants";
import * as mfsha2 from "multiformats/hashes/sha2";
import * as digest from "multiformats/hashes/digest";
import {
  appId,
  buildAssetMintAtomicTransactionComposer,
  getPrice,
  getRandomNode,
  makeCrustPinTx,
  mnemonicSignerCreator,
  pinJSONToCrust,
} from "./crust";
import { NetworkId } from "@txnlab/use-wallet-react";

export const peraWallet = new PeraWalletConnect({
  shouldShowSignTxnToast: true,
});

export function sliceIntoChunks(arr, chunkSize) {
  const res = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize);
    res.push(chunk);
  }
  return res;
}

export async function walletSign(txns, signer) {
  const all = Array.from(Array(txns.flat().length).keys());
  return signer(txns.flat(), all);
}

export function getIndexerURL(activeNetwork: NetworkId) {
  if (activeNetwork === NetworkId.MAINNET) {
    return MAINNET_ALGONODE_INDEXER;
  } else {
    return TESTNET_ALGONODE_INDEXER;
  }
}

export function getNfdomainAPIURL(activeNetwork: NetworkId) {
  if (activeNetwork === NetworkId.MAINNET) {
    return MAINNET_NFD_API_BASE_URL;
  } else {
    return TESTNET_NFD_API_BASE_URL;
  }
}

export function SignWithSk(txnsArray, sk) {
  let signedTxns = [];
  for (let i = 0; i < txnsArray.length; i++) {
    signedTxns.push(signTransaction(txnsArray[i], sk).blob);
  }
  return signedTxns;
}

export function SignWithMnemonic(txnsArray, mnemonic) {
  if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
  const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
  return SignWithSk(txnsArray.flat(), sk);
}

export async function createAssetConfigArray(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2
) {
  const params = await algodClient.getTransactionParams().do();
  const txnsArray = [];
  const wallet = address;
  for (let i = 0; i < data_for_txns.length; i++) {
    let asset_update_tx = makeAssetConfigTxnWithSuggestedParamsFromObject({
      from: wallet,
      assetIndex: parseInt(data_for_txns[i].asset_id),
      note: new TextEncoder().encode(JSON.stringify(data_for_txns[i].note)),
      manager: wallet,
      reserve: wallet,
      freeze: data_for_txns[i].freeze || undefined,
      clawback: data_for_txns[i].clawback || undefined,
      suggestedParams: params,
      strictEmptyAddressChecking: false,
    });
    const fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
      from: wallet,
      to: MINT_FEE_WALLET,
      amount: algosToMicroalgos(UPDATE_FEE_PER_ASA),
      suggestedParams: params,
      note: new TextEncoder().encode(
        "via wen.tools - free tools for creators and collectors | " +
          Math.random().toString(36).substring(2)
      ),
    });
    const groupID = computeGroupID([asset_update_tx, fee_tx]);
    asset_update_tx.group = groupID;
    fee_tx.group = groupID;
    txnsArray.push([asset_update_tx, fee_tx]);
  }
  return txnsArray;
}

export async function createAssetMintArrayV2(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  transactionSigner,
  extraPinCids // cid array
) {
  // create atomic transaction composer
  const atc = new algosdk.AtomicTransactionComposer();

  const params = await algodClient.getTransactionParams().do();

  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const note = new TextEncoder().encode(
        JSON.stringify(data_for_txns[i].asset_note)
      );
      let asset_create_tx = makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: wallet,
        manager: wallet,
        assetName: data_for_txns[i].asset_name,
        unitName: data_for_txns[i].unit_name,
        total:
          BigInt(data_for_txns[i].total_supply) *
          10n ** BigInt(data_for_txns[i].decimals),
        decimals: parseInt(data_for_txns[i].decimals),
        reserve: wallet,
        freeze: data_for_txns[i].has_freeze === "Y" ? wallet : undefined,
        assetURL: data_for_txns[i].asset_url,
        suggestedParams: params,
        note: note,
        clawback: data_for_txns[i].has_clawback === "Y" ? wallet : undefined,
        strictEmptyAddressChecking: false,
        defaultFrozen: data_for_txns[i].default_frozen === "Y" ? true : false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(MINT_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      });

      atc.addTransaction({ txn: asset_create_tx, signer: transactionSigner });
      atc.addTransaction({ txn: fee_tx, signer: transactionSigner });
    } catch (error) {
      console.log(error);
    }
  }

  // extra pinning
  if (extraPinCids) {
    for (let i = 0; i < extraPinCids.length; i++) {
      atc.addMethodCall(
        await makeCrustPinTx(
          extraPinCids[i],
          transactionSigner,
          address,
          algodClient
        )
      );
    }
  }

  return atc;
}

export async function createAssetMintArray(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2
) {
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = address;
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const note = new TextEncoder().encode(
        JSON.stringify(data_for_txns[i].asset_note)
      );
      let asset_create_tx = makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: wallet,
        manager: wallet,
        assetName: data_for_txns[i].asset_name,
        unitName: data_for_txns[i].unit_name,
        total:
          BigInt(data_for_txns[i].total_supply) *
          10n ** BigInt(data_for_txns[i].decimals),
        decimals: parseInt(data_for_txns[i].decimals),
        reserve: wallet,
        freeze: data_for_txns[i].has_freeze === "Y" ? wallet : undefined,
        assetURL: data_for_txns[i].asset_url,
        suggestedParams: params,
        note: note,
        clawback: data_for_txns[i].has_clawback === "Y" ? wallet : undefined,
        strictEmptyAddressChecking: false,
        defaultFrozen: data_for_txns[i].default_frozen === "Y" ? true : false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(MINT_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      });
      const groupID = computeGroupID([asset_create_tx, fee_tx]);
      asset_create_tx.group = groupID;
      fee_tx.group = groupID;
      txnsArray.push([asset_create_tx, fee_tx]);
    } catch (error) {
      console.log(error);
    }
  }
  return txnsArray;
}

/**
 * createARC3AssetMintArrayV2 create array of transactions for minting
 * @param {*} data_for_txns
 * @param {*} extraPinCids
 * @param {*} mnemonic
 * @returns AtomicTransactionComposer
 */
export async function createARC3AssetMintArrayV2(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  transactionSigner,
  extraPinCids,
  mnemonic
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  // create atomic transaction composer
  const atc = new algosdk.AtomicTransactionComposer();

  let txSigner = null;
  if (mnemonic !== undefined && mnemonic !== null && mnemonic !== "") {
    // create a mnemonic signer
    txSigner = mnemonicSignerCreator(mnemonic);
  } else {
    txSigner = transactionSigner;
  }

  if (txSigner === null) {
    throw new Error("txSigner is not defined");
  }

  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);

      const authBasic = localStorage.getItem("authBasic");
      // upload to Crust
      const cid = await pinJSONToCrust(authBasic, jsonString);

      let suggestedParams = await algodClient.getTransactionParams().do();
      suggestedParams.flatFee = true;
      suggestedParams.fee = 2000 * 4; // set fee

      // build ATC
      await buildAssetMintAtomicTransactionComposer(
        atc,
        address,
        algodClient,
        "ARC3",
        txSigner,
        data_for_txns[i],
        suggestedParams,
        cid
      );

      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {
      console.error(error);
    }
  }

  // extra pinning
  if (extraPinCids) {
    for (let i = 0; i < extraPinCids.length; i++) {
      atc.addMethodCall(
        await makeCrustPinTx(extraPinCids[i], txSigner, address, algodClient)
      );
    }
  }

  return atc;
}

function getTxnGroupFromATC(atc) {
  const txnsWithSigners = atc.buildGroup();
  return txnsWithSigners.map((txnWithSigner) => txnWithSigner.txn);
}

export async function createARC3AssetMintArrayV2Batch(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  transactionSigner,
  mnemonic
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  let txSigner = null;
  if (mnemonic !== undefined && mnemonic !== null && mnemonic !== "") {
    // create a mnemonic signer
    txSigner = mnemonicSignerCreator(mnemonic);
  } else {
    txSigner = transactionSigner;
  }

  if (txSigner === null) {
    throw new Error("txSigner is not defined");
  }

  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    // create new atomic transaction composer
    const atc = new algosdk.AtomicTransactionComposer();

    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);

      const authBasic = localStorage.getItem("authBasic");
      // upload to Crust
      const cid = await pinJSONToCrust(authBasic, jsonString);

      let suggestedParams = await algodClient.getTransactionParams().do();
      suggestedParams.flatFee = true;
      suggestedParams.fee = 2000 * 4; // set fee

      // build ATC
      await buildAssetMintAtomicTransactionComposer(
        atc,
        address,
        algodClient,
        "ARC3",
        txSigner,
        data_for_txns[i],
        suggestedParams,
        cid
      );

      txnsArray.push(getTxnGroupFromATC(atc));
      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {
      console.error(error);
    }
  }

  return txnsArray;
}

export async function createARC3AssetMintArray(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  token
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);
      let cid = await pinJSONToPinata(token, jsonString);
      const price = await getPrice(algodClient, 10000);
      const node = await getRandomNode(algodClient);
      if (typeof node !== "string") {
        throw new Error("Invalid Node!");
      }

      let suggestedParams = await algodClient.getTransactionParams().do();
      suggestedParams.flatFee = true;
      suggestedParams.fee = 2000 * 4; // 设置固定费用

      const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        type: "pay",
        from: wallet,
        to: algosdk.getApplicationAddress(appId),
        receiver: algosdk.getApplicationAddress(appId),
        amount: price,
        closeRemainderTo: undefined,
        note: undefined,
        suggestedParams,
      });

      const method = algosdk.ABIMethod.fromSignature(
        "place_order(pay,account,string,uint64,bool)void"
      );

      const args = [
        method.getSelector(),
        algosdk.encodeUnsignedTransaction(paymentTxn),
        algosdk.decodeAddress(node).publicKey,
        algosdk.encodeObj(cid),
        algosdk.encodeUint64(10000),
        new Uint8Array([1]),
      ];
      console.log(args);

      const appCallTxn = algosdk.makeApplicationCallTxnFromObject({
        accounts: [wallet, node],
        from: wallet,
        appIndex: appId,
        appArgs: [
          method.getSelector(),
          algosdk.decodeAddress(node).publicKey,
          algosdk.encodeObj(cid),
          algosdk.encodeUint64(10000),
          new Uint8Array([1]),
        ],
        suggestedParams,
        boxes: [
          { appIndex: appId, name: algosdk.decodeAddress(node).publicKey },
          { appIndex: appId, name: new TextEncoder().encode("nodes") },
        ],
      });

      data_for_txns[i].asset_url_section = "ipfs://" + cid;
      let asset_create_tx = makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: wallet,
        manager: wallet,
        assetName: data_for_txns[i].asset_name,
        unitName: data_for_txns[i].unit_name,
        total:
          BigInt(data_for_txns[i].total_supply) *
          10n ** BigInt(data_for_txns[i].decimals),
        decimals: parseInt(data_for_txns[i].decimals),
        reserve: wallet,
        freeze: data_for_txns[i].has_freeze === "Y" ? wallet : undefined,
        assetURL: data_for_txns[i].asset_url_section + "#arc3",
        suggestedParams: params,
        clawback: data_for_txns[i].has_clawback === "Y" ? wallet : undefined,
        defaultFrozen: data_for_txns[i].default_frozen === "Y" ? true : false,
        strictEmptyAddressChecking: false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(MINT_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      });
      const groupID = computeGroupID([
        asset_create_tx,
        fee_tx,
        paymentTxn,
        appCallTxn,
      ]);
      asset_create_tx.group = groupID;
      fee_tx.group = groupID;
      paymentTxn.group = groupID;
      appCallTxn.group = groupID;
      txnsArray.push([asset_create_tx, fee_tx, paymentTxn, appCallTxn]);
      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {
      console.error(error);
    }
  }
  return txnsArray;
}

export async function createARC19AssetMintArrayV2(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  transactionSigner,
  extraPinCids,
  mnemonic
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  // create atomic transaction composer
  const atc = new algosdk.AtomicTransactionComposer();

  let txSigner = null;
  if (mnemonic !== undefined && mnemonic !== null && mnemonic !== "") {
    // create a mnemonic signer
    txSigner = mnemonicSignerCreator(mnemonic);
  } else {
    txSigner = transactionSigner;
  }

  if (txSigner === null) {
    throw new Error("txSigner is not defined");
  }

  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);

      const authBasic = localStorage.getItem("authBasic");
      // upload to Crust
      const cid = await pinJSONToCrust(authBasic, jsonString);

      let suggestedParams = await algodClient.getTransactionParams().do();
      suggestedParams.flatFee = true;
      suggestedParams.fee = 2000 * 4; // set fee

      // build ATC
      await buildAssetMintAtomicTransactionComposer(
        atc,
        address,
        algodClient,
        "ARC19",
        txSigner,
        data_for_txns[i],
        suggestedParams,
        cid
      );

      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {
      console.log(error);
    }
  }

  // extra pinning
  if (extraPinCids) {
    for (let i = 0; i < extraPinCids.length; i++) {
      atc.addMethodCall(
        await makeCrustPinTx(extraPinCids[i], txSigner, address, algodClient)
      );
    }
  }

  return atc;
}

export async function createARC19AssetMintArrayV2Batch(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  transactionSigner,
  mnemonic
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  let txSigner = null;
  if (mnemonic !== undefined && mnemonic !== null && mnemonic !== "") {
    // create a mnemonic signer
    txSigner = mnemonicSignerCreator(mnemonic);
  } else {
    txSigner = transactionSigner;
  }

  if (txSigner === null) {
    throw new Error("txSigner is not defined");
  }

  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    // create atomic transaction composer
    const atc = new algosdk.AtomicTransactionComposer();

    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);

      const authBasic = localStorage.getItem("authBasic");
      // upload to Crust
      const cid = await pinJSONToCrust(authBasic, jsonString);

      let suggestedParams = await algodClient.getTransactionParams().do();
      suggestedParams.flatFee = true;
      suggestedParams.fee = 2000 * 4; // set fee

      // build ATC
      await buildAssetMintAtomicTransactionComposer(
        atc,
        address,
        algodClient,
        "ARC19",
        txSigner,
        data_for_txns[i],
        suggestedParams,
        cid
      );

      txnsArray.push(getTxnGroupFromATC(atc));
      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {
      console.log(error);
    }
  }

  return txnsArray;
}

export async function createARC19AssetMintArray(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  token
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  if (token === "" || token === undefined) {
    throw new Error("IPFS token not found");
  }
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);
      let cid = await pinJSONToPinata(token, jsonString);
      const { assetURL, reserveAddress } = createReserveAddressFromIpfsCid(cid);
      let asset_create_tx = makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: wallet,
        manager: wallet,
        assetName: data_for_txns[i].asset_name,
        unitName: data_for_txns[i].unit_name,
        total:
          BigInt(data_for_txns[i].total_supply) *
          10n ** BigInt(data_for_txns[i].decimals),
        decimals: parseInt(data_for_txns[i].decimals),
        reserve: reserveAddress,
        freeze: data_for_txns[i].has_freeze === "Y" ? wallet : undefined,
        assetURL: assetURL,
        suggestedParams: params,
        clawback: data_for_txns[i].has_clawback === "Y" ? wallet : undefined,
        strictEmptyAddressChecking: false,
        defaultFrozen: data_for_txns[i].default_frozen === "Y" ? true : false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(MINT_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      });
      const groupID = computeGroupID([asset_create_tx, fee_tx]);
      asset_create_tx.group = groupID;
      fee_tx.group = groupID;
      txnsArray.push([asset_create_tx, fee_tx]);
      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {
      console.log(error);
    }
  }
  return txnsArray;
}

/**
 * updateARC19AssetMintArrayV2 return ATC for updating transactions
 * @param {*} data_for_txns
 * @returns
 */
export async function updateARC19AssetMintArrayV2(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  transactionSigner,
  extraPinCids,
  mnemonic
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  // create atomic transaction composer
  const atc = new algosdk.AtomicTransactionComposer();

  let params = await algodClient.getTransactionParams().do();

  let txSigner = null;
  if (mnemonic !== undefined && mnemonic !== null && mnemonic !== "") {
    // create a mnemonic signer
    txSigner = mnemonicSignerCreator(mnemonic);
  } else {
    txSigner = transactionSigner;
  }

  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const assetURL = await getAssetUrl(
        parseInt(data_for_txns[i].asset_id),
        algodClient
      );
      let chunks = assetURL.split("://");
      const cidVersion = chunks[1].split(":")[1];
      const cidCodec = chunks[1].split(":")[2];
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);

      const authBasic = localStorage.getItem("authBasic");
      // upload to Crust
      let cid = await pinJSONToCrust(
        authBasic,
        jsonString,
        cidVersion,
        cidCodec
      );

      const { reserveAddress } = createReserveAddressFromIpfsCid(cid);

      let update_tx = makeAssetConfigTxnWithSuggestedParamsFromObject({
        from: wallet,
        assetIndex: parseInt(data_for_txns[i].asset_id),
        note: new TextEncoder().encode(JSON.stringify(data_for_txns[i].note)),
        manager: wallet,
        reserve: reserveAddress,
        freeze: data_for_txns[i].freeze || undefined,
        clawback: data_for_txns[i].clawback || undefined,
        suggestedParams: params,
        strictEmptyAddressChecking: false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(UPDATE_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      });

      atc.addTransaction({ txn: update_tx, signer: txSigner });
      atc.addTransaction({ txn: fee_tx, signer: txSigner });
      atc.addMethodCall(
        await makeCrustPinTx(cid, txSigner, address, algodClient)
      );

      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {}
    if (i % 100 === 0) {
      params = await algodClient.getTransactionParams().do();
    }
  }

  // extra pinning
  if (extraPinCids) {
    for (let i = 0; i < extraPinCids.length; i++) {
      atc.addMethodCall(
        await makeCrustPinTx(extraPinCids[i], txSigner, address, algodClient)
      );
    }
  }

  return atc;
}

export async function updateARC19AssetMintArray(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2,
  token
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  if (token === "" || token === undefined) {
    throw new Error("IPFS token not found");
  }
  let params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const assetURL = await getAssetUrl(
        parseInt(data_for_txns[i].asset_id),
        algodClient
      );
      let chunks = assetURL.split("://");
      const cidVersion = chunks[1].split(":")[1];
      const cidCodec = chunks[1].split(":")[2];
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);
      let cid = await pinJSONToPinata(token, jsonString, cidVersion, cidCodec);
      const { reserveAddress } = createReserveAddressFromIpfsCid(cid);
      let update_tx = makeAssetConfigTxnWithSuggestedParamsFromObject({
        from: wallet,
        assetIndex: parseInt(data_for_txns[i].asset_id),
        note: new TextEncoder().encode(JSON.stringify(data_for_txns[i].note)),
        manager: wallet,
        reserve: reserveAddress,
        freeze: data_for_txns[i].freeze || undefined,
        clawback: data_for_txns[i].clawback || undefined,
        suggestedParams: params,
        strictEmptyAddressChecking: false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(UPDATE_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      });
      const groupID = computeGroupID([update_tx, fee_tx]);
      update_tx.group = groupID;
      fee_tx.group = groupID;
      txnsArray.push([update_tx, fee_tx]);
      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {}
    if (i % 100 === 0) {
      params = await algodClient.getTransactionParams().do();
    }
  }
  return txnsArray;
}

export async function createAirdropTransactions(
  data_for_txns,
  assetDecimals,
  address: string,
  algodClient: algosdk.Algodv2,
  activeNetwork: NetworkId
) {
  const wallet = address;
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  if (wallet === "" || wallet === undefined) {
    throw new Error(
      "You need to connect your wallet first, if using mnemonic too!"
    );
  }
  let nfd_wallets = [];
  let nfdDomains = {};
  for (let i = 0; i < data_for_txns.length; i++) {
    if (data_for_txns[i].receiver.includes(".algo")) {
      nfd_wallets.push(data_for_txns[i].receiver);
    }
  }
  if (nfd_wallets.length > 0) {
    nfdDomains = await getAddressesFromNFDomain(nfd_wallets);
  }
  const isHolder = await isWalletHolder(wallet, activeNetwork);
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      let tx;
      data_for_txns[i].asset_id = parseInt(data_for_txns[i].asset_id);
      if (data_for_txns[i].receiver.includes(".algo")) {
        data_for_txns[i].receiver = nfdDomains[data_for_txns[i].receiver];
      }
      data_for_txns[i].note = data_for_txns[i].note || "";
      if (data_for_txns[i].asset_id === 1) {
        tx = makePaymentTxnWithSuggestedParamsFromObject({
          from: wallet,
          to: data_for_txns[i].receiver.trim(),
          amount: algosToMicroalgos(data_for_txns[i].amount * 1),
          suggestedParams: params,
          note: new TextEncoder().encode(
            isHolder
              ? data_for_txns[i].note.slice(0, 950) +
                  " | via wen.tools - free tools for creators and collectors  " +
                  Math.random().toString(36).substring(2)
              : data_for_txns[i].note.slice(0, 950) +
                  " | via wen.tools - free tools for creators and collectors  " +
                  Math.random().toString(36).substring(2)
          ),
        });
      } else {
        data_for_txns[i].decimals = assetDecimals[data_for_txns[i].asset_id];
        tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: wallet,
          to: data_for_txns[i].receiver.trim(),
          amount:
            BigInt(data_for_txns[i].amount) *
            10n ** BigInt(data_for_txns[i].decimals),
          assetIndex: parseInt(data_for_txns[i].asset_id),
          suggestedParams: params,
          note: new TextEncoder().encode(
            isHolder
              ? data_for_txns[i].note.slice(0, 950) +
                  " | via wen.tools - free tools for creators and collectors  " +
                  Math.random().toString(36).substring(2)
              : data_for_txns[i].note.slice(0, 950) +
                  " | via wen.tools - free tools for creators and collectors  " +
                  Math.random().toString(36).substring(2)
          ),
        });
      }
      txnsArray.push(tx);
    } catch (error) {
      toast.error("Error in creating transaction " + (i + 1));
    }
  }
  return txnsArray;
}

export async function createAssetOptInTransactions(
  assets,
  address: string,
  algodClient: algosdk.Algodv2
) {
  const wallet = address;
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < assets.length; i++) {
    const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: wallet,
      to: wallet.trim(),
      amount: 0,
      assetIndex: parseInt(assets[i]),
      suggestedParams: params,
      note: new TextEncoder().encode(
        "via wen.tools - free tools for creators and collectors"
      ),
    });
    txnsArray.push(tx);
  }
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  return groups;
}

export async function createClawbackTransactions(
  data_for_txns,
  assetDecimals,
  address: string,
  algodClient: algosdk.Algodv2
) {
  const wallet = address;
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: wallet.trim(),
      revocationTarget: data_for_txns[i].clawback_from,
      to: data_for_txns[i].receiver,
      suggestedParams: params,
      assetIndex: parseInt(data_for_txns[i].asset_id),
      amount:
        BigInt(data_for_txns[i].amount) *
        10n ** BigInt(assetDecimals[data_for_txns[i].asset_id]),
      note: new TextEncoder().encode(
        "via wen.tools - free tools for creators and collectors"
      ),
    });
    txnsArray.push(tx);
  }
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  return groups;
}

export async function createFreezeTransactions(
  data_for_txns,
  address: string,
  algodClient: algosdk.Algodv2
) {
  const wallet = address;
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    const tx = makeAssetFreezeTxnWithSuggestedParamsFromObject({
      from: wallet.trim(),
      suggestedParams: params,
      assetIndex: parseInt(data_for_txns[i].asset_id),
      freezeState: data_for_txns[i].frozen.trim() === "Y" ? true : false,
      freezeTarget: data_for_txns[i].wallet,
      note: new TextEncoder().encode(
        "via wen.tools - free tools for creators and collectors"
      ),
    });
    txnsArray.push(tx);
  }
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  return groups;
}

export async function getAssetCreatorWallet(
  assetId,
  algodClient: algosdk.Algodv2
) {
  try {
    const assetData = await algodClient.getAssetByID(assetId).do();
    console.log("getAssetCreatorWallet " + JSON.stringify(assetData));
    console.log("getAssetCreatorWallet " + assetData.params.creator);
    return assetData.params.creator;
  } catch (err) {
    console.log("error " + err);
    return "";
  }
}

export async function createAssetOptoutTransactions(
  assets,
  address: string,
  algodClient: algosdk.Algodv2
) {
  const wallet = address;
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < assets.length; i++) {
    const creatorAddress = await getAssetCreatorWallet(assets[i], algodClient);
    if (creatorAddress !== "") {
      const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: creatorAddress.trim(),
        amount: 0,
        assetIndex: parseInt(assets[i]),
        suggestedParams: params,
        closeRemainderTo: creatorAddress.trim(),
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors"
        ),
      });
      txnsArray.push(tx);
    }
  }
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  return groups;
}

export async function createAssetDeleteTransactions(
  assets,
  address: string,
  algodClient: algosdk.Algodv2
) {
  const wallet = address;
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < assets.length; i++) {
    try {
      let asset_create_tx = makeAssetDestroyTxnWithSuggestedParamsFromObject({
        from: wallet,
        suggestedParams: params,
        assetIndex: parseInt(assets[i]),
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      });
      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(UPDATE_FEE_PER_ASA),
        suggestedParams: params,
      });
      const groupID = computeGroupID([asset_create_tx, fee_tx]);
      asset_create_tx.group = groupID;
      fee_tx.group = groupID;
      txnsArray.push([asset_create_tx, fee_tx]);
    } catch (error) {
      console.log(error);
    }
  }
  return txnsArray;
}

export class Arc69 {
  async fetch(assetId, activeNetwork: NetworkId) {
    const idx = getIndexerURL(activeNetwork);
    const url = `${idx}/v2/assets/${assetId}/transactions?tx-type=acfg`;

    let transactions;

    try {
      transactions = (await fetch(url).then((res) => res.json())).transactions;
    } catch (err) {
      return null;
    }

    transactions.sort((a, b) => b["round-time"] - a["round-time"]);

    for (const transaction of transactions) {
      try {
        const noteBase64 = transaction.note;
        const noteString = atob(noteBase64)
          .trim()
          .replace(/[^ -~]+/g, "");
        const noteObject = JSON.parse(noteString);
        if (noteObject.standard === "arc69") {
          return noteObject;
        }
      } catch (err) {}
    }
    return {
      metadata_description: "",
      metadata_external_url: "",
      metadata_mime_type: "",
    };
  }
}

async function fetchNFDJSON(url) {
  while (true) {
    const response = await fetch(url);
    if (response.status === 404) {
      return response;
    }
    const jsonData = await response.json();
    if (response.status === 429 && jsonData.length > 0) {
      // Wait for 'secsRemaining' seconds before retrying.
      await new Promise((resolve) =>
        setTimeout(resolve, jsonData.secsRemaining * 1000)
      );
    } else {
      // If status is not 429, return the json data and status.
      return { status: response.status, body: jsonData };
    }
  }
}

export async function getNfdDomain(wallet) {
  const nfdDomain = await fetchNFDJSON(
    "https://api.nf.domains/nfd/lookup?address=" + wallet + "&view=tiny"
  );
  if (nfdDomain.status === 200) {
    return nfdDomain.body[wallet].name;
  } else {
    return "";
  }
}

function codeToCodec(code) {
  switch (code.toString(16)) {
    case "55":
      return "raw";
    case "70":
      return "dag-pb";
    default:
      throw new Error("Unknown codec");
  }
}

export function createReserveAddressFromIpfsCid(ipfsCid) {
  const decoded = CID.parse(ipfsCid.toString());
  const version = decoded.version;
  const codec = codeToCodec(decoded.code);

  const assetURL = `template-ipfs://{ipfscid:${version}:${codec}:reserve:sha2-256}`;

  const reserveAddress = encodeAddress(
    Uint8Array.from(Buffer.from(decoded.multihash.digest))
  );

  return { assetURL, reserveAddress };
}

export async function getAssetsFromAddress(address, activeNetwork: NetworkId) {
  let threshold = 1000;
  let userAssets = await axios.get(
    `${getIndexerURL(activeNetwork)}/v2/accounts/${address}/assets`
  );
  while (userAssets.data.assets.length === threshold) {
    const nextAssets = await axios.get(
      `${getIndexerURL(activeNetwork)}/v2/accounts/${address}/assets?next=${
        userAssets.data["next-token"]
      }`
    );
    userAssets.data.assets = userAssets.data.assets.concat(
      nextAssets.data.assets
    );
    userAssets.data["next-token"] = nextAssets.data["next-token"];
    threshold += 1000;
  }
  return userAssets.data.assets
    .filter((asset) => asset.amount > 0)
    .map((asset) => asset["asset-id"]);
}

export async function getCreatedAssets(address, activeNetwork: NetworkId) {
  let threshold = 1000;
  let createdAssets = await axios.get(
    `${getIndexerURL(
      activeNetwork
    )}/v2/accounts/${address}/created-assets?limit=${threshold}`
  );
  while (createdAssets.data.assets.length === threshold) {
    const nextAssets = await axios.get(
      `${getIndexerURL(
        activeNetwork
      )}/v2/accounts/${address}/created-assets?limit=1000&next=${
        createdAssets.data["next-token"]
      }`
    );
    createdAssets.data.assets = createdAssets.data.assets.concat(
      nextAssets.data.assets
    );
    createdAssets.data["next-token"] = nextAssets.data["next-token"];
    threshold += 1000;
  }
  return createdAssets.data.assets.map((asset) => {
    return { asset_id: asset["index"], unit_name: asset.params["unit-name"] };
  });
}

export async function isWalletHolder(wallet, activeNetwork: NetworkId) {
  let createdAssets = [];
  for (let i = 0; i < CREATOR_WALLETS.length; i++) {
    createdAssets = createdAssets.concat(
      await getCreatedAssets(CREATOR_WALLETS[i], activeNetwork)
    );
  }
  createdAssets = createdAssets.filter((asset) => {
    return PREFIXES.some(
      (prefix) => asset.unit_name && asset.unit_name.startsWith(prefix)
    );
  });
  createdAssets = createdAssets.map((asset) => asset.asset_id);
  const userAssets = await getAssetsFromAddress(wallet, activeNetwork);
  return userAssets.some((asset) => createdAssets.includes(asset));
}

export async function getNfDomainsInBulk(wallets, bulkSize = 20) {
  const uniqueWallets = [...new Set(wallets)];
  let nfdDomains = {};
  let counter = 0;
  for (let i = 0; i < uniqueWallets.length; i += bulkSize) {
    const chunk = uniqueWallets
      .slice(i, i + bulkSize)
      .map((wallet) => `address=${wallet}`)
      .join("&");
    try {
      const nfdLookup = await fetchNFDJSON(
        `https://api.nf.domains/nfd/lookup?view=tiny&${chunk}`
      );
      if (nfdLookup.status === 200) {
        for (const [account, domain] of Object.entries(nfdLookup.body)) {
          nfdDomains[account] = domain.name;
        }
      }
    } catch {
      continue;
    }
    counter += bulkSize;
    if (counter > uniqueWallets.length) {
      counter = uniqueWallets.length;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return nfdDomains;
}

export async function getAddressesFromNFDomain(domains) {
  toast.info("Fetching NFDomain addresses", { autoClose: 1000 });
  const uniqueDomains = [...new Set(domains)];
  let nfdDomains = {};
  for (let i = 0; i < uniqueDomains.length; i++) {
    try {
      const response = await axios.get(
        `https://api.nf.domains/nfd/${uniqueDomains[i].toLowerCase()}?view=tiny`
      );
      if (response.data.depositAccount) {
        nfdDomains[uniqueDomains[i]] = response.data.depositAccount;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch {
      continue;
    }
  }
  return nfdDomains;
}

export async function getOwnerAddressOfAsset(
  assetId,
  activeNetwork: NetworkId
) {
  try {
    const url =
      getIndexerURL(activeNetwork) +
      `/v2/assets/${assetId}/balances?currency-greater-than=0`;
    const response = await axios.get(url);
    return response.data.balances[0].address;
  } catch (err) {
    return "";
  }
}
export async function getOwnerAddressAmountOfAsset(
  assetId,
  activeNetwork: NetworkId
) {
  try {
    const url =
      getIndexerURL(activeNetwork) +
      `/v2/assets/${assetId}/balances?currency-greater-than=0`;
    const response = await axios.get(url);
    return response;
  } catch (err) {
    console.log(err);
    return "";
  }
}
export async function getRandListingAsset(assetId) {
  try {
    const url = `https://www.randswap.com/v1/listings/asset/${assetId}`;
    const response = await axios.get(url);
    const assetData = response.data.map((listing) => {
      return {
        sellerAddress: listing.sellerAddress,
        escrowAddress: listing.escrowAddress,
      };
    });
    return assetData;
  } catch (err) {
    return [];
  }
}

export async function getRandCreatorListings(creatorWallet) {
  try {
    const url = `https://www.randswap.com/v1/listings/creator/${creatorWallet}`;
    const response = await axios.get(url);
    const assetData = response.data.map((listing) => {
      return {
        assetId: listing.assetId,
        sellerAddress: listing.sellerAddress,
      };
    });
    return assetData;
  } catch (err) {
    return "";
  }
}

export async function getARC19AssetMetadataData(url, reserve) {
  try {
    let chunks = url.split("://");
    if (chunks[0] === "template-ipfs" && chunks[1].startsWith("{ipfscid:")) {
      const cidComponents = chunks[1].split(":");
      const cidVersion = cidComponents[1];
      const cidCodec = cidComponents[2];
      let cidCodecCode;
      if (cidCodec === "raw") {
        cidCodecCode = 0x55;
      } else if (cidCodec === "dag-pb") {
        cidCodecCode = 0x70;
      }
      const addr = decodeAddress(reserve);
      const mhdigest = digest.create(mfsha2.sha256.code, addr.publicKey);
      if (cidVersion === "1") {
        const cid = CID.createV1(cidCodecCode, mhdigest);
        const response = await axios.get(`${IPFS_ENDPOINT}${cid}`);
        return response.data;
      } else {
        const cid = CID.createV0(mhdigest);
        const response = await axios.get(`${IPFS_ENDPOINT}${cid}`);
        return response.data;
      }
    }
    return {};
  } catch (error) {
    return {};
  }
}

export async function pinJSONToPinata(
  token,
  json,
  version = "",
  cidCodec = ""
) {
  try {
    let response;
    if (cidCodec === "raw" || cidCodec === "") {
      const blob = new Blob([json], { type: "application/json" });
      const data = new FormData();
      data.append("file", blob);
      const options = JSON.stringify({
        cidVersion: version === "" ? 1 : parseInt(version),
      });
      data.append("pinataOptions", options);
      response = await axios.post(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        data,
        {
          headers: {
            Authorization: `Bearer ${token.trim()}`,
          },
        }
      );
      return response.data.IpfsHash;
    } else {
      response = await axios.post(
        "https://api.pinata.cloud/pinning/pinJSONToIPFS",
        json,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return response.data.IpfsHash;
    }
  } catch (error) {
    throw new Error("IPFS pinning failed");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

export async function pinImageToPinata(token, image) {
  try {
    const data = new FormData();
    data.append("file", image);
    const options = JSON.stringify({
      cidVersion: 1,
    });
    data.append("pinataOptions", options);
    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      data,
      {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
      }
    );
    return response.data.IpfsHash;
  } catch (error) {
    throw new Error("IPFS pinning failed");
  }
}

export async function getParticipationStatusOfWallet(
  wallet,
  algodClient: algosdk.Algodv2
) {
  try {
    const resp = await algodClient.accountInformation(wallet).do();
    if (resp.participation && resp.status === "Online") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function getAssetUrl(assetId, algodClient: algosdk.Algodv2) {
  try {
    const assetData = await algodClient.getAssetByID(assetId).do();
    return assetData.params.url;
  } catch {
    return "";
  }
}
