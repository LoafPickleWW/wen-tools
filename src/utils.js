import { PeraWalletConnect } from "@perawallet/connect";
import MyAlgoConnect from "@randlabs/myalgo-connect";
import {
  Algodv2,
  algosToMicroalgos,
  computeGroupID,
  encodeAddress,
  makeAssetConfigTxnWithSuggestedParamsFromObject,
  makeAssetCreateTxnWithSuggestedParamsFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
  mnemonicToSecretKey,
  signTransaction,
  makeAssetDestroyTxnWithSuggestedParamsFromObject,
} from "algosdk";
import axios from "axios";
import { CID } from "multiformats/cid";
import { toast } from "react-toastify";
import { Web3Storage } from "web3.storage/dist/bundle.esm.min.js";
import {
  DONATE_WALLET_1,
  DONATE_WALLET_2,
  MAINNET_ALGONODE_INDEXER,
  MAINNET_ALGONODE_NODE,
  MINT_FEE_PER_ASA,
  MINT_FEE_WALLET,
  TESTNET_ALGONODE_INDEXER,
  TESTNET_ALGONODE_NODE,
  UPDATE_FEE_PER_ASA,
  CREATOR_WALLETS,
  PREFIXES,
} from "./constants";

const peraWallet = new PeraWalletConnect({ shouldShowSignTxnToast: true });

export function sliceIntoChunks(arr, chunkSize) {
  const res = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize);
    res.push(chunk);
  }
  return res;
}

export function getNodeURL() {
  const networkType = localStorage.getItem("networkType");
  if (networkType === "mainnet") {
    return MAINNET_ALGONODE_NODE;
  } else {
    return TESTNET_ALGONODE_NODE;
  }
}

export function getIndexerURL() {
  const networkType = localStorage.getItem("networkType");
  if (networkType === "mainnet") {
    return MAINNET_ALGONODE_INDEXER;
  } else {
    return TESTNET_ALGONODE_INDEXER;
  }
}

export async function signGroupTransactions(
  groups,
  wallet,
  isMultipleGroup = false
) {
  let signedTxns;
  let txnsToValidate;
  try {
    if (localStorage.getItem("PeraWallet.Wallet") != null) {
      await peraWallet.reconnectSession();
      let multipleTxnGroups;
      if (isMultipleGroup) {
        multipleTxnGroups = groups.map((group) => {
          return group.map((txn) => {
            return { txn: txn, signers: [wallet] };
          });
        });
      } else {
        multipleTxnGroups = groups.map((txn) => {
          return { txn: txn, signers: [wallet] };
        });
      }
      if (multipleTxnGroups.length === 0) {
        throw new Error("Transaction signing failed!");
      }
      if (isMultipleGroup) {
        signedTxns = await peraWallet.signTransaction(multipleTxnGroups);
      } else {
        signedTxns = await peraWallet.signTransaction([multipleTxnGroups]);
      }
      txnsToValidate = signedTxns.flat();
    } else {
      const myAlgoConnect = new MyAlgoConnect();
      signedTxns = await myAlgoConnect.signTransaction(
        groups.flat().map((txn) => txn.toByte())
      );
      txnsToValidate = signedTxns.flat().map((txn) => txn.blob);
    }
    if (txnsToValidate == null) {
      throw new Error("Transaction signing failed");
    }
    return txnsToValidate;
  } catch (error) {}
}

export function SignWithMnemonics(txnsArray, sk) {
  let signedTxns = [];
  for (let i = 0; i < txnsArray.length; i++) {
    signedTxns.push(signTransaction(txnsArray[i], sk).blob);
  }
  return signedTxns;
}

export async function createAssetConfigArray(data_for_txns, nodeURL, mnemonic) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
  for (let i = 0; i < data_for_txns.length; i++) {
    let tx = makeAssetConfigTxnWithSuggestedParamsFromObject({
      from: wallet,
      assetIndex: parseInt(data_for_txns[i].asset_id),
      note: new TextEncoder().encode(JSON.stringify(data_for_txns[i].note)),
      manager: wallet,
      reserve: wallet,
      freeze: undefined,
      clawback: undefined,
      suggestedParams: params,
      strictEmptyAddressChecking: false,
    });
    txnsArray.push(tx);
  }
  if (mnemonic !== "") {
    if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
    const { sk } = mnemonicToSecretKey(mnemonic);
    return SignWithMnemonics(txnsArray, sk);
  }
  let txnsToValidate = await signGroupTransactions(txnsArray, wallet);
  return txnsToValidate;
}

export async function createAssetMintArray(data_for_txns, nodeURL, mnemonic) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
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
        total: parseInt(data_for_txns[i].total_supply),
        decimals: parseInt(data_for_txns[i].decimals),
        reserve: wallet,
        freeze: data_for_txns[i].has_freeze === "Y" ? wallet : undefined,
        assetURL: data_for_txns[i].asset_url,
        suggestedParams: params,
        note: note,
        clawback: data_for_txns[i].has_clawback === "Y" ? wallet : undefined,
        strictEmptyAddressChecking: false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(MINT_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via Evil Tools | " + Math.random().toString(36).substring(2)
        ),
      });
      const groupID = computeGroupID([asset_create_tx, fee_tx]);
      asset_create_tx.group = groupID;
      fee_tx.group = groupID;
      txnsArray.push([asset_create_tx, fee_tx]);
    } catch (error) {}
  }
  if (mnemonic !== "") {
    if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
    const { sk } = mnemonicToSecretKey(mnemonic);
    return SignWithMnemonics(txnsArray.flat(), sk);
  }
  const txnsToValidate = await signGroupTransactions(txnsArray, wallet, true);
  return txnsToValidate;
}

export async function createARC3AssetMintArray(
  data_for_txns,
  nodeURL,
  token,
  mnemonic
) {
  const wallet = localStorage.getItem("wallet");
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  const client = new Web3Storage({ token: token });
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);
      const cid = await pinJSONToIPFS(client, jsonString);
      data_for_txns[i].asset_url_section = "ipfs://" + cid;
      let asset_create_tx = makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: wallet,
        manager: wallet,
        assetName: data_for_txns[i].asset_name,
        unitName: data_for_txns[i].unit_name,
        total: parseInt(data_for_txns[i].total_supply),
        decimals: parseInt(data_for_txns[i].decimals),
        reserve: wallet,
        freeze: data_for_txns[i].has_freeze === "Y" ? wallet : undefined,
        assetURL: data_for_txns[i].asset_url_section + "#arc3",
        suggestedParams: params,
        clawback: data_for_txns[i].has_clawback === "Y" ? wallet : undefined,
        strictEmptyAddressChecking: false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(MINT_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via Evil Tools | " + Math.random().toString(36).substring(2)
        ),
      });
      const groupID = computeGroupID([asset_create_tx, fee_tx]);
      asset_create_tx.group = groupID;
      fee_tx.group = groupID;
      txnsArray.push([asset_create_tx, fee_tx]);
      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {}
  }
  return txnsArray;
}

export async function createARC19AssetMintArray(data_for_txns, nodeURL, token) {
  const wallet = localStorage.getItem("wallet");
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  if (token === "" || token === undefined) {
    throw new Error("IPFS token not found");
  }
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  const client = new Web3Storage({ token: token });
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);
      const cid = await pinJSONToIPFS(client, jsonString);
      const { assetURL, reserveAddress } = createReserveAddressFromIpfsCid(cid);
      let asset_create_tx = makeAssetCreateTxnWithSuggestedParamsFromObject({
        from: wallet,
        manager: wallet,
        assetName: data_for_txns[i].asset_name,
        unitName: data_for_txns[i].unit_name,
        total: parseInt(data_for_txns[i].total_supply),
        decimals: parseInt(data_for_txns[i].decimals),
        reserve: reserveAddress,
        freeze: data_for_txns[i].has_freeze === "Y" ? wallet : undefined,
        assetURL: assetURL,
        suggestedParams: params,
        clawback: data_for_txns[i].has_clawback === "Y" ? wallet : undefined,
        strictEmptyAddressChecking: false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(MINT_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via Evil Tools | " + Math.random().toString(36).substring(2)
        ),
      });
      const groupID = computeGroupID([asset_create_tx, fee_tx]);
      asset_create_tx.group = groupID;
      fee_tx.group = groupID;
      txnsArray.push([asset_create_tx, fee_tx]);
      toast.info(`Asset ${i + 1} of ${data_for_txns.length} uploaded to IPFS`, {
        autoClose: 200,
      });
    } catch (error) {}
  }
  return txnsArray;
}

export async function updateARC19AssetMintArray(data_for_txns, nodeURL, token) {
  const wallet = localStorage.getItem("wallet");
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  if (token === "" || token === undefined) {
    throw new Error("IPFS token not found");
  }
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  const client = new Web3Storage({ token: token });
  let txnsArray = [];
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);
      const cid = await pinJSONToIPFS(client, jsonString);
      const { reserveAddress } = createReserveAddressFromIpfsCid(cid);

      let update_tx = makeAssetConfigTxnWithSuggestedParamsFromObject({
        from: wallet,
        assetIndex: parseInt(data_for_txns[i].asset_id),
        note: new TextEncoder().encode(JSON.stringify(data_for_txns[i].note)),
        manager: wallet,
        reserve: reserveAddress,
        //freeze: undefined,
        //clawback: undefined,
        suggestedParams: params,
        strictEmptyAddressChecking: false,
      });

      let fee_tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: MINT_FEE_WALLET,
        amount: algosToMicroalgos(UPDATE_FEE_PER_ASA),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via Evil Tools | " + Math.random().toString(36).substring(2)
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
  }
  return txnsArray;
}

export async function createAirdropTransactions(
  data_for_txns,
  nodeURL,
  assetDecimals,
  mnemonic
) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
  if (wallet === "" || wallet === undefined) {
    throw new Error(
      "You need to connect your wallet first, if using mnemonic too!"
    );
  }
  let nfd_wallets = [];
  let nfdDomains = {};
  for (let i = 0; i < data_for_txns.length; i++) {
    if (data_for_txns[i].receiver.endsWith(".algo")) {
      nfd_wallets.push(data_for_txns[i].receiver);
    }
  }
  if (nfd_wallets.length > 0) {
    nfdDomains = await getAddressesFromNFDomain(nfd_wallets);
  }
  const isHolder = await isWalletHolder(wallet);
  for (let i = 0; i < data_for_txns.length; i++) {
    try {
      let tx;
      data_for_txns[i].asset_id = parseInt(data_for_txns[i].asset_id);
      if (data_for_txns[i].receiver.endsWith(".algo")) {
        data_for_txns[i].receiver = nfdDomains[data_for_txns[i].receiver];
      }
      if (data_for_txns[i].asset_id === 1) {
        tx = makePaymentTxnWithSuggestedParamsFromObject({
          from: wallet,
          to: data_for_txns[i].receiver,
          amount: algosToMicroalgos(data_for_txns[i].amount * 1),
          suggestedParams: params,
          note: new TextEncoder().encode(
            isHolder
              ? data_for_txns[i].note.slice(0, 999)
              : "Sent using Evil Tools - A Thurstober Digital Studios Product! Free Tools for Algorand Creators and Collectors!  " +
                  Math.random().toString(36).substring(2)
          ),
        });
      } else {
        data_for_txns[i].decimals = assetDecimals[data_for_txns[i].asset_id];
        tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: wallet,
          to: data_for_txns[i].receiver,
          amount: parseInt(
            data_for_txns[i].amount * 10 ** data_for_txns[i].decimals
          ),
          assetIndex: parseInt(data_for_txns[i].asset_id),
          suggestedParams: params,
          note: new TextEncoder().encode(
            isHolder
              ? data_for_txns[i].note.slice(0, 999)
              : "Sent using Evil Tools - A Thurstober Digital Studios Product! Free Tools for Algorand Creators and Collectors!  " +
                  Math.random().toString(36).substring(2)
          ),
        });
      }
      txnsArray.push(tx);
    } catch (error) {
      toast.error("Error in creating transaction " + (i + 1));
    }
  }
  if (mnemonic !== "") {
    if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
    const { sk } = mnemonicToSecretKey(mnemonic);
    return SignWithMnemonics(txnsArray, sk);
  }
  let txnsToValidate = await signGroupTransactions(txnsArray, wallet);
  return txnsToValidate;
}

export async function createDonationTransaction(amount) {
  const algodClient = new Algodv2("", MAINNET_ALGONODE_NODE, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  const wallet = localStorage.getItem("wallet");
  const tx = makePaymentTxnWithSuggestedParamsFromObject({
    from: wallet,
    to: DONATE_WALLET_1,
    amount: algosToMicroalgos(amount / 2),
    suggestedParams: params,
    note: new TextEncoder().encode("Evil Tools Donation"),
  });

  const tx2 = makePaymentTxnWithSuggestedParamsFromObject({
    from: wallet,
    to: DONATE_WALLET_2,
    amount: algosToMicroalgos(amount / 2),
    suggestedParams: params,
    note: new TextEncoder().encode("Evil Tools Donation"),
  });

  const txnsArray = [tx, tx2];
  const groupID = computeGroupID(txnsArray);
  for (let i = 0; i < txnsArray.length; i++) txnsArray[i].group = groupID;
  let signedTxns;
  let txnsToValidate;
  try {
    if (localStorage.getItem("PeraWallet.Wallet") != null) {
      await peraWallet.reconnectSession();
      const multipleTxnGroups = [
        { txn: txnsArray[0], signers: [wallet] },
        { txn: txnsArray[1], signers: [wallet] },
      ];
      signedTxns = await peraWallet.signTransaction([multipleTxnGroups]);
      txnsToValidate = signedTxns.flat();
    } else {
      const myAlgoConnect = new MyAlgoConnect();
      signedTxns = await myAlgoConnect.signTransaction(
        txnsArray.map((txn) => txn.toByte())
      );
      txnsToValidate = signedTxns.flat().map((txn) => txn.blob);
    }
    if (txnsToValidate.length === 0) {
      throw new Error("Transaction signing failed");
    }
    return txnsToValidate;
  } catch (error) {}
}

export async function createAssetOptInTransactions(assets, nodeURL, mnemonic) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
  for (let i = 0; i < assets.length; i++) {
    const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: wallet,
      to: wallet,
      amount: 0,
      assetIndex: parseInt(assets[i]),
      suggestedParams: params,
      note: new TextEncoder().encode("via Evil Tools"),
    });
    txnsArray.push(tx);
  }
  if (mnemonic !== "") {
    if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
    const { sk } = mnemonicToSecretKey(mnemonic);
    return SignWithMnemonics(txnsArray, sk);
  }
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  try {
    const txnsToValidate = await signGroupTransactions(groups, wallet, true);
    return sliceIntoChunks(txnsToValidate, 16);
  } catch (error) {
    throw new Error("Transaction signing failed");
  }
}

export async function createClawbackTransactions(
  data_for_txns,
  nodeURL,
  mnemonic
) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
  for (let i = 0; i < data_for_txns.length; i++) {
    const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: wallet,
      to: wallet,
      revocationTarget: data_for_txns[i].addr,
      suggestedParams: params,
      assetIndex: parseInt(data_for_txns[i].index),
      amount: parseInt(data_for_txns[i].amount),
      note: new TextEncoder().encode("via Evil Tools"),
    });
    txnsArray.push(tx);
  }
  if (mnemonic !== "") {
    if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
    const { sk } = mnemonicToSecretKey(mnemonic);
    return SignWithMnemonics(txnsArray, sk);
  }
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  try {
    const txnsToValidate = await signGroupTransactions(groups, wallet, true);
    return sliceIntoChunks(txnsToValidate, 16);
  } catch (error) {
    throw new Error("Transaction signing failed");
  }
}

async function getAssetCreatorWallet(assetId, selectNetwork) {
  try {
    const url = getNodeURL(selectNetwork) + `/v2/assets/${assetId}`;
    const response = await axios.get(url);
    return response.data.params.creator;
  } catch (err) {
    return "";
  }
}

export async function createAssetOptoutTransactions(
  assets,
  nodeURL,
  networkType,
  mnemonic
) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
  for (let i = 0; i < assets.length; i++) {
    const creatorAddress = await getAssetCreatorWallet(assets[i], networkType);
    if (creatorAddress !== "") {
      const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: creatorAddress,
        amount: 0,
        assetIndex: parseInt(assets[i]),
        suggestedParams: params,
        closeRemainderTo: creatorAddress,
        note: new TextEncoder().encode("via Evil Tools"),
      });
      txnsArray.push(tx);
    }
  }
  if (mnemonic !== "") {
    if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
    const { sk } = mnemonicToSecretKey(mnemonic);
    return SignWithMnemonics(txnsArray, sk);
  }
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  try {
    const txnsToValidate = await signGroupTransactions(groups, wallet, true);
    return sliceIntoChunks(txnsToValidate, 16);
  } catch (error) {
    throw new Error("Transaction signing failed");
  }
}

export async function createAssetDeleteTransactions(assets, nodeURL, mnemonic) {
  const wallet = localStorage.getItem("wallet");
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  console.log(assets);
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  for (let i = 0; i < assets.length; i++) {
    try {
      let asset_create_tx = makeAssetDestroyTxnWithSuggestedParamsFromObject({
        from: wallet,
        suggestedParams: params,
        assetIndex: parseInt(assets[i]),
        note: new TextEncoder().encode(
          "via Evil Tools | " + Math.random().toString(36).substring(2)
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
  console.log(txnsArray);
  if (mnemonic !== "") {
    if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic!");
    const { sk } = mnemonicToSecretKey(mnemonic);
    return SignWithMnemonics(txnsArray.flat(), sk);
  }
  const txnsToValidate = await signGroupTransactions(txnsArray, wallet, true);
  return txnsToValidate;
}

export class Arc69 {
  async fetch(assetId, selectNetwork) {
    let url;
    if (selectNetwork === "mainnet") {
      url = `${MAINNET_ALGONODE_INDEXER}/v2/assets/${assetId}/transactions?tx-type=acfg`;
    } else {
      url = `${TESTNET_ALGONODE_INDEXER}/v2/assets/${assetId}/transactions?tx-type=acfg`;
    }

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

export async function getNfdDomain(wallet) {
  const nfdDomain = await fetch(
    "https://api.nf.domains/nfd/address?address=" +
      wallet +
      "&limit=1&view=tiny"
  );
  if (nfdDomain.status === 200) {
    const data = await nfdDomain.json();
    if (data.length > 0) {
      return data[0].name;
    } else {
      return "";
    }
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

export async function pinJSONToIPFS(client, json) {
  try {
    const cid = await client.put(
      [new Blob([json])],
      { wrapWithDirectory: false },
      { contentType: "application/json" }
    );
    return cid;
  } catch (error) {
    throw new Error("IPFS pinning failed");
  }
}

export function createReserveAddressFromIpfsCid(ipfsCid) {
  const decoded = CID.parse(ipfsCid);
  const version = decoded.version;
  const codec = codeToCodec(decoded.code);

  if (version === 0) {
    throw new Error("CID version 0 does not support directories");
  }

  const assetURL = `template-ipfs://{ipfscid:${version}:${codec}:reserve:sha2-256}`;

  const reserveAddress = encodeAddress(
    Uint8Array.from(Buffer.from(decoded.multihash.digest))
  );

  return { assetURL, reserveAddress };
}

export async function getAssetsFromAddress(address) {
  let threshold = 1000;
  let userAssets = await axios.get(
    `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${address}/assets`
  );
  while (userAssets.data.assets.length === threshold) {
    const nextAssets = await axios.get(
      `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${address}/assets?next=${userAssets.data["next-token"]}`
    );
    userAssets.data.assets = userAssets.data.assets.concat(
      nextAssets.data.assets
    );
    userAssets.data["next-token"] = nextAssets.data["next-token"];
    threshold += 1000;
  }
  return userAssets.data.assets
    .filter((asset) => asset.amount >= 1)
    .map((asset) => asset["asset-id"]);
}

export async function getCreatedAssets(address) {
  let threshold = 1000;
  let createdAssets = await axios.get(
    `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${address}/created-assets?limit=${threshold}`
  );
  while (createdAssets.data.assets.length === threshold) {
    const nextAssets = await axios.get(
      `${MAINNET_ALGONODE_INDEXER}/v2/accounts/${address}/created-assets?limit=1000&next=${createdAssets.data["next-token"]}`
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

async function isWalletHolder(wallet) {
  let createdAssets = [];
  for (let i = 0; i < CREATOR_WALLETS.length; i++) {
    createdAssets = createdAssets.concat(
      await getCreatedAssets(CREATOR_WALLETS[i])
    );
  }
  createdAssets = createdAssets.filter((asset) => {
    return PREFIXES.some((prefix) => asset.unit_name.startsWith(prefix));
  });
  createdAssets = createdAssets.map((asset) => asset.asset_id);
  const userAssets = await getAssetsFromAddress(wallet);
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
      const response = await axios.get(
        `https://api.nf.domains/nfd/address?${chunk}`
      );
      for (const domain of response.data) {
        nfdDomains[domain.owner] = domain.name;
      }
    } catch {
      continue;
    }
    counter += bulkSize;
    if (counter > uniqueWallets.length) {
      counter = uniqueWallets.length;
    }
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
        `https://api.nf.domains/nfd/${uniqueDomains[i]}?view=tiny`
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
