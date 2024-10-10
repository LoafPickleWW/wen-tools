import * as algosdk from "algosdk";
import { MINT_FEE_PER_ASA, MINT_FEE_WALLET } from "./constants";
import axios from "axios";
import { isCrustAuth } from "./crust-auth";
import { createReserveAddressFromIpfsCid, getNodeURL, SignWithMnemonics } from "./utils";

export const appId = 1275319623;

/**
 *       const dryrunRequest = await createDryrun({
 *         client: algodClient,
 *         txns: [{ txn: txn2 }],
 *         apps: [{ id: appId }],
 *       });
 *
 *       const dryRunResult = await algodClient.dryrun(dryrunRequest).do();
 *       console.log('res', dryRunResult.txns[0])
 */
/**
 *       const txn = algosdk.makeApplicationNoOpTxn(
 *           generateAccount().addr,
 *           suggestedParams,
 *           appId,
 *           [new Uint8Array(Buffer.from("get_price")), algosdk.encodeUint64(10000),
 *             new Uint8Array([1])
 *           ],
 *           undefined,undefined,undefined,undefined,undefined,undefined,
 *       );
 * @param client
 * @param size
 * @returns {Promise<number>}
 */
export async function getPrice(client, size) {
  const appInfo = await client.getApplicationByID(appId).do()
  const state = appInfo.params['global-state'];

  console.log(state)
  const getStateValue = function (key) {
    const item = state.find((item) => Buffer.from(item.key, 'base64').toString() === key);
    return item ? item.value.uint : 0;
  };

  const basePrice = getStateValue('base_price');
  const bytePrice = getStateValue('byte_price');
  const serviceRate = getStateValue('service_rate');
  const cruPrice = getStateValue('cru_price');
  const algoPrice = getStateValue('algo_price');

  console.table(basePrice, bytePrice, serviceRate, cruPrice, algoPrice)

  let price = (basePrice + size * bytePrice / (1024) / (1024))
    * (serviceRate + (100)) / (100)
    * cruPrice / algoPrice / (10 ** 12);

  price *= 200;

  return Math.round(price);
}

export async function getRandomNode(client) {
  try {
    const boxesResponse = await client.getApplicationBoxes(appId).do();
    const boxNames = boxesResponse.boxes.map(box => box.name);

    const nodesBoxName = boxNames.find(name =>
      Buffer.from(name, 'base64').toString() === 'nodes'
    );

    if (!nodesBoxName) {
      console.log("Nodes box not found");
      return [];
    }

    const nodesBoxResponse = await client.getApplicationBoxByName(appId, nodesBoxName).do();
    const nodesData = nodesBoxResponse.value;

    const nodes = [];
    for (let i = 0; i < nodesData.length; i += 32) {
      const address = algosdk.encodeAddress(nodesData.slice(i, i + 32));
      nodes.push(address);
    }
    return nodes.filter((node, index) => nodes.indexOf(node) === index)[0];
  } catch (error) {
    console.error("Error fetching nodes:", error);
    return [];
  }
}

export const mnemonicSignerCreator = (mnemonic) => {
  return async (txnGroup, indexesToSign) => {
    const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
    const signedTxns = SignWithMnemonics(
      txnGroup,
      sk
    );

    return Promise.resolve(signedTxns);
  };
};

/**
 * peraWalletSignerCreator return a peraWallet signer
 * @param {*} peraWallet 
 * @param {*} wallet 
 * @returns 
 */
export const peraWalletSignerCreator = (peraWallet, wallet) => {
  return async (txnGroup, indexesToSign) => {
    await peraWallet.reconnectSession();

    const groups = [txnGroup];

    const multipleTxnGroups = groups.map((group) => {
      return group.map((txn) => {
        return { txn: txn, signers: [wallet] };
      });
    });
    if (multipleTxnGroups.length === 0) {
      throw new Error("Transaction signing failed!");
    }

    const signedTxns = await peraWallet.signTransaction(multipleTxnGroups);

    return Promise.resolve(signedTxns);
  };
};

/**
 * buildAssetMintAtomicTransactionComposer
 * @param {*} atc The AtomicTransactionComposer will be used to build the transaction
 * @param {*} type type is the type of transaction, 'arc3' | 'arc19'
 * @param {*} txSigner  txSigner is the transaction signer, maybe peraWallet/deflyWallet or others?
 * @param {*} data_for_txn data for each transaction
 * @param {*} suggestedParams 
 * @param {*} cid ipfs cid
 */
export async function buildAssetMintAtomicTransactionComposer(
  atc,
  type,
  txSigner,
  data_for_txn,
  suggestedParams,
  cid,
) {
  const wallet = localStorage.getItem("wallet");
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  data_for_txn.asset_url_section = "ipfs://" + cid;
  let assetURL = "", reserveAddress = "";
  if (type === "ARC3") {
    assetURL = data_for_txn.asset_url_section + "#arc3";
    reserveAddress = wallet;
  } else if (type === "ARC19") {
    const ret = createReserveAddressFromIpfsCid(cid);
    assetURL = ret.assetURL;
    reserveAddress = ret.reserveAddress;
  }

  let asset_create_tx = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    from: wallet,
    manager: wallet,
    assetName: data_for_txn.asset_name,
    unitName: data_for_txn.unit_name,
    total:
      parseInt(data_for_txn.total_supply) *
      10 ** parseInt(data_for_txn.decimals),
    decimals: parseInt(data_for_txn.decimals),
    reserve: reserveAddress,
    freeze: data_for_txn.has_freeze === "Y" ? wallet : undefined,
    assetURL,
    suggestedParams,
    clawback: data_for_txn.has_clawback === "Y" ? wallet : undefined,
    defaultFrozen: data_for_txn.default_frozen === "Y" ? true : false,
    strictEmptyAddressChecking: false,
  });

  let fee_tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: wallet,
    to: MINT_FEE_WALLET,
    amount: algosdk.algosToMicroalgos(MINT_FEE_PER_ASA),
    suggestedParams,
    note: new TextEncoder().encode(
      "via wen.tools - free tools for creators and collectors | " +
      Math.random().toString(36).substring(2)
    ),
  });

  atc.addTransaction({ txn: asset_create_tx, signer: txSigner });
  atc.addTransaction({ txn: fee_tx, signer: txSigner });
  atc.addMethodCall(await makeCrustPinTx(cid, txSigner));
}

export async function pinJSONToCrust(
  token,
  json,
  version = "",
  cidCodec = "",
  endpoint = ""
) {
  if (!isCrustAuth()) {
    throw new Error("Crust: authBasic Token not found, please login and try again.");
  }
  if (endpoint === "") {
    endpoint = getDefaultCrustAuthIpfsEndpoint();
  }

  try {
    let response;
    if (cidCodec === "raw" || cidCodec === "") {
      const blob = new Blob([json], { type: "application/json" });
      const data = new FormData();
      data.append("file", blob);
      const response = await axios.post(
        `${endpoint}/api/v0/add`,
        data,
        {
          headers: {
            Authorization: `Bearer ${token.trim()}`,
          },
          params: { pin: true, 'cid-version': version === "" ? 1 : parseInt(version), },
        },
      );

      if (response.status === 200 && response.data && response.data.Hash) {
        return response.data.Hash;
      } else {
        throw new Error(response.data ? response.data.Error : `pinJSONToCrust post failed, cidCodec=${cidCodec}`);
      }
    } else {
      response = await axios.post(
        `${endpoint}/api/v0/add`,
        json,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token.trim()}`,
          },
        }
      );
      if (response.status === 200 && response.data && response.data.Hash) {
        return response.data.Hash;
      } else {
        throw new Error(response.data ? response.data.Error : `pinJSONToCrust post failed, cidCodec=${cidCodec}`);
      }
    }
  } catch (error) {
    throw new Error("IPFS pinning failed");
  }
}

export async function pinImageToCrust(token, image, endpoint = "") {
  if (!isCrustAuth()) {
    throw new Error("Crust: authBasic Token not found, please login and try again.");
  }

  if (endpoint === "") {
    endpoint = getDefaultCrustAuthIpfsEndpoint();
  }

  try {
    const data = new FormData();
    data.append("file", image);
    const response = await axios.post(
      `${endpoint}/api/v0/add`,
      data,
      {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
        params: { pin: true, 'cid-version': 1, },
      },
    );

    if (response.status === 200 && response.data && response.data.Hash) {
      return response.data.Hash;
    } else {
      throw new Error(response.data ? response.data.Error : `pinJSONToCrust post failed`);
    }
  } catch (error) {
    console.log("pinImageToCrust fail: ", error)
    throw new Error("IPFS pinning failed");
  }
}

export async function makeCrustPinTx(cid, signer) {
  const wallet = localStorage.getItem("wallet");
  if (wallet === "" || wallet === undefined) {
    throw new Error("Wallet not found");
  }

  const nodeURL = getNodeURL();

  const algodClient = new algosdk.Algodv2("", nodeURL, {
    "User-Agent": "evil-tools",
  });

  const price = await getPrice(algodClient, 10000)
  let suggestedParams = await algodClient.getTransactionParams().do();
  suggestedParams.flatFee = true;
  suggestedParams.fee = 2000 * 4; // set fee

  const node = await getRandomNode(algodClient);

  const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    type: 'pay',
    from: wallet,
    to: algosdk.getApplicationAddress(appId),
    receiver: algosdk.getApplicationAddress(appId),
    amount: price,
    closeRemainderTo: undefined,
    note: undefined,
    suggestedParams
  });

  const method = algosdk.ABIMethod.fromSignature('place_order(pay,account,string,uint64,bool)void');

  let txSigner = null;
  if (signer) {
    txSigner = signer;
  } else {
    throw new Error("makeCrustPinTx: txSigner is not defined");
  }

  return {
    appID: appId,
    method,
    note: new TextEncoder().encode("via wen.tools - free tools for creators and collectors | " + Math.random().toString(36).substring(2)),
    methodArgs: [
      { txn: paymentTxn, signer: txSigner },
      node,
      cid,
      10000,
      true
    ],
    sender: wallet,
    signer: txSigner,
    suggestedParams,
    boxes: [
      { appIndex: appId, name: algosdk.decodeAddress(node).publicKey },
      { appIndex: appId, name: new TextEncoder().encode("nodes") }
    ]
  }
}

// Returns the default Crust Auth IPFS endpoint
export function getDefaultCrustAuthIpfsEndpoint() {
  return createCrustAuthIpfsEndpoints()[0].value;
}

// Definitions here are with the following values -
//   info: the name of a logo as defined in ../ui/logos, specifically in namedLogos
//   text: the IPFS endpoint name
//   value: the IPFS endpoint domain
//   location: IPFS gateway location
// Returns an array of objects
// {
//   text?: string;
//   value: string;
//   location?: string;
//   group?: string
// }
export function createCrustAuthIpfsEndpoints() {
  return [
    {
      location: '️Shanghai',
      text: '️⚡ Thunder Gateway',
      value: 'https://gw.crustfiles.net',
      // group: "Thunder Gateway"
    },
    {
      location: 'Singapore',
      text: 'DCF',
      value: 'https://crustipfs.xyz',
      // group: "Public Gateway"
    },
    {
      location: 'United States',
      text: 'Crust Network',
      value: 'https://ipfs-gw.decloud.foundation',
      // group: "Public Gateway"
    },
    {
      location: 'Henan',
      text: '️Crust IPFS GW',
      value: 'https://gw.w3ipfs.cn:10443'
    },
    {
      location: 'Los Angeles',
      text: '️Crust IPFS GW',
      value: 'https://gw.smallwolf.me'
    },
    {
      location: 'Henan',
      text: '️Crust IPFS GW',
      value: 'https://gw.w3ipfs.com:7443'
    },
    {
      location: 'Henan Unicom',
      text: '️Crust IPFS GW',
      value: 'https://gw.w3ipfs.net:7443'
    },
    {
      location: 'Helsinki',
      text: '️crust-fans',
      value: 'https://crust.fans'
    },
    {
      location: 'Phoenix',
      text: '️crustgateway',
      value: 'https://crustgateway.com'
    },
    {
      location: 'Germany',
      text: '️crustgateway-de',
      value: 'https://crustgateway.online'
    },
    {
      location: 'Los Angeles',
      text: '️Crust IPFS GW',
      value: 'https://gw.w3ipfs.org.cn'
    },
    {
      location: 'Shanghai',
      text: 'Area51-GW',
      value: 'https://223.111.148.195'
    },
    {
      location: 'Shanghai',
      text: 'Crato-GW',
      value: 'https://223.111.148.196'
    }
  ];
}