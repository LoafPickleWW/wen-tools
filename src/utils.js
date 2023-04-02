import {
  Algodv2,
  computeGroupID,
  makeAssetConfigTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
  algosToMicroalgos,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makeAssetCreateTxnWithSuggestedParamsFromObject,
} from "algosdk";
import MyAlgoConnect from "@randlabs/myalgo-connect";
import { PeraWalletConnect } from "@perawallet/connect";
import axios from "axios";

const peraWallet = new PeraWalletConnect({ shouldShowSignTxnToast: true });

const DONATE_WALLET_1 =
  "O2ZPSV6NJC32ZXQ7PZ5ID6PXRKAWQE2XWFZK5NK3UFULPZT6OKIOROEAPU";
const DONATE_WALLET_2 =
  "BYKWLR65FS6IBLJO7SKBGBJ4C5T257LBL55OUY6363QBWX24B5QKT6DMEA";

const MINT_FEE_WALLET =
  "RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ";
const MINT_FEE_PER_ASA = 0.1;

export const TOOLS = [
  {
    id: "collection_data",
    label: "⬇️ Download Collection Data",
    description: "Download all the data for a collection in CSV format.",
    path: "/download-collection-data",
  },
  {
    id: "collection_snapshot",
    label: "🔎 Find Collection Holders",
    description: "Download all the holders for a collection in CSV format.",
    path: "/find-collection-holders",
  },
  {
    id: "batch_update",
    label: "⬆️ Collection Metadata Update",
    description: "Update the metadata for a collection in bulk.",
    path: "/batch-metadata-update",
  },
  {
    id: "batch_mint",
    label: "🖨️ Collection Mint",
    description: "Mint a collection in bulk.",
    path: "/batch-collection-mint",
  },

  {
    id: "batch_optin",
    label: "➕ Asset Add",
    description: "Optin assets in bulk.",
    path: "/batch-optin",
  },
  {
    id: "batch_optout",
    label: "➖ Asset Remove",
    description: "Optout assets in bulk.",
    path: "/batch-optout",
  },
  {
    id: "airdrop_tool",
    label: "🪂 Asset Send/Airdrop",
    description: "Airdrop assets/ALGO to a list of addresses.",
    path: "/airdrop",
  },
  {
    id: "ipfs_upload",
    label: "📁 IPFS Collection Upload",
    description: "Upload a collection images to IPFS.",
    path: "/ipfs-upload",
  },
  {
    id: "wallet_holdings",
    label: "💼 Wallet Holdings",
    description: "View the assets data of a wallet in CSV format.",
    path: "/wallet-holdings",
  },
];

export function sliceIntoChunks(arr, chunkSize) {
  const res = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize);
    res.push(chunk);
  }
  return res;
}

async function signGroupTransactions(groups, wallet, isMultipleGroup = false) {
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
  } catch (error) {
    //console.log(error);
  }
}

export async function createAssetConfigArray(data_for_txns, nodeURL) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
  for (let i = 0; i < data_for_txns.length; i++) {
    let tx = makeAssetConfigTxnWithSuggestedParamsFromObject({
      from: wallet,
      assetIndex: data_for_txns[i].asset_id,
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
  const groups = sliceIntoChunks(txnsArray, 16);
  for (let i = 0; i < groups.length; i++) {
    const groupID = computeGroupID(groups[i]);
    for (let j = 0; j < groups[i].length; j++) {
      groups[i][j].group = groupID;
    }
  }
  try {
    const txnsToValidate = await signGroupTransactions(groups, wallet, true);
    return txnsToValidate;
  } catch (error) {
    throw new Error("Transaction signing failed");
  }
}

export async function createAssetMintArray(data_for_txns, nodeURL) {
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
  const txnsToValidate = await signGroupTransactions(txnsArray, wallet, true);
  return txnsToValidate;
}

export async function createAirdropTransactions(
  data_for_txns,
  nodeURL,
  assetDecimals
) {
  const algodClient = new Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });
  const params = await algodClient.getTransactionParams().do();
  let txnsArray = [];
  const wallet = localStorage.getItem("wallet");
  for (let i = 0; i < data_for_txns.length; i++) {
    var tx;
    if (data_for_txns[i].asset_id === 1) {
      tx = makePaymentTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: data_for_txns[i].receiver,
        amount: algosToMicroalgos(data_for_txns[i].amount * 1),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via Evil Tools | " + Math.random().toString(36).substring(2)
        ),
      });
    } else {
      data_for_txns[i].decimals = assetDecimals[data_for_txns[i].asset_id];
      tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: wallet,
        to: data_for_txns[i].receiver,
        amount: data_for_txns[i].amount * 10 ** data_for_txns[i].decimals,
        assetIndex: parseInt(data_for_txns[i].asset_id),
        suggestedParams: params,
        note: new TextEncoder().encode(
          "via Evil Tools | " + Math.random().toString(36).substring(2)
        ),
      });
    }
    txnsArray.push(tx);
  }
  const txnsToValidate = await signGroupTransactions(txnsArray, wallet);
  return txnsToValidate;
}

export async function createDonationTransaction(amount) {
  const algodClient = new Algodv2("", "https://node.algoexplorerapi.io", {
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
  } catch (error) {
    //console.log(error);
  }
}

export async function createAssetOptInTransactions(assets, nodeURL) {
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
    var url;
    if (selectNetwork === "mainnet") {
      url =
        Math.round(Math.random()) === 1
          ? `https://node.algoexplorerapi.io/v2/assets/${assetId}`
          : `https://mainnet-api.algonode.cloud/v2/assets/${assetId}`;
    } else {
      url =
        Math.round(Math.random()) === 1
          ? `https://node.testnet.algoexplorerapi.io/v2/assets/${assetId}`
          : `https://testnet-api.algonode.cloud/v2/assets/${assetId}`;
    }
    const response = await axios.get(url);
    return response.data.params.creator;
  } catch (err) {
    return "";
  }
}

export async function createAssetOptoutTransactions(
  assets,
  nodeURL,
  networkType
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

export class Arc69 {
  constructor() {
    this.algoExplorerApiBaseUrl = "https://algoindexer.algoexplorerapi.io";
    this.algonodeExplorerApiBaseUrl = "https://mainnet-idx.algonode.cloud";
    this.algoExplorerTestnetApiBaseUrl =
      "https://algoindexer.testnet.algoexplorerapi.io";
    this.algonodeTestnetExplorerApiBaseUrl =
      "https://testnet-idx.algonode.cloud";
  }

  async fetch(assetId, selectNetwork) {
    let url;
    if (selectNetwork === "mainnet") {
      url =
        Math.round(Math.random()) === 1
          ? `${this.algoExplorerApiBaseUrl}/v2/transactions?asset-id=${assetId}&tx-type=acfg`
          : `${this.algonodeExplorerApiBaseUrl}/v2/assets/${assetId}/transactions?tx-type=acfg`;
    } else {
      url =
        Math.round(Math.random()) === 1
          ? `${this.algoExplorerTestnetApiBaseUrl}/v2/transactions?asset-id=${assetId}&tx-type=acfg`
          : `${this.algonodeTestnetExplorerApiBaseUrl}/v2/assets/${assetId}/transactions?tx-type=acfg`;
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
