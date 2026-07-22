import axios from "axios";
import algosdk from "algosdk";
import { walletSign } from "../utils";
import { CID } from "multiformats/cid";
import * as mfsha2 from "multiformats/hashes/sha2";

function serializeUnixFS(content: Uint8Array): Uint8Array {
  const innerData = [];
  innerData.push(0x08, 0x02);
  
  innerData.push(0x12);
  pushVarint(innerData, content.length);
  for (let i = 0; i < content.length; i++) {
    innerData.push(content[i]);
  }
  
  innerData.push(0x18);
  pushVarint(innerData, content.length);
  
  const innerBytes = new Uint8Array(innerData);
  
  const outerData = [];
  outerData.push(0x0a);
  pushVarint(outerData, innerBytes.length);
  for (let i = 0; i < innerBytes.length; i++) {
    outerData.push(innerBytes[i]);
  }
  
  return new Uint8Array(outerData);
}

function pushVarint(arr: number[], value: number) {
  let val = value;
  while (val >= 0x80) {
    arr.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  arr.push(val & 0x7f);
}

export async function computeIpfsCidV0(content: Uint8Array): Promise<string> {
  const serialized = serializeUnixFS(content);
  const hashBytes = await mfsha2.sha256.digest(serialized);
  const cid = CID.createV0(hashBytes as any);
  return cid.toString();
}

export async function getAlgoFilePaymentRequirements(
  file: File | Blob | string,
  fileName: string,
  apiKey: string = "algofilerouteapi1y"
): Promise<{ requirements: any; cid: string }> {
  const formData = new FormData();
  let blobToUpload: Blob;

  if (typeof file === "string") {
    blobToUpload = new Blob([file], { type: "application/json" });
  } else {
    blobToUpload = file;
  }
  formData.append("file", blobToUpload, fileName);

  const endpoint = "/api/algofile";

  try {
    await axios.post(endpoint, formData, {
      headers: {
        "x-api-key": apiKey,
      },
    });
    throw new Error("Expected 402 payment challenge but upload succeeded without payment.");
  } catch (error: any) {
    if (error.response && error.response.status === 402) {
      const challengeDetails = error.response.data;
      const requirements = challengeDetails.requirements;
      if (!requirements) {
        throw new Error("Invalid payment challenge response from AlgoFile.");
      }
      
      const contentBytes = typeof file === "string" 
        ? new TextEncoder().encode(file) 
        : new Uint8Array(await blobToUpload.arrayBuffer());
      const cid = await computeIpfsCidV0(contentBytes);
      return { requirements, cid };
    }
    throw new Error(error.response?.data?.message || error.message || "Failed to get payment requirements from AlgoFile.");
  }
}

export async function completeAlgoFileUpload(
  file: File | Blob | string,
  fileName: string,
  signedTxnsB64: string[],
  paymentIndex: number,
  requirements: any,
  apiKey: string = "algofilerouteapi1y"
): Promise<string> {
  const formData = new FormData();
  let blobToUpload: Blob;

  if (typeof file === "string") {
    blobToUpload = new Blob([file], { type: "application/json" });
  } else {
    blobToUpload = file;
  }
  formData.append("file", blobToUpload, fileName);

  const endpoint = "/api/algofile";

  const paymentPayload = {
    x402Version: 2,
    network: requirements.network,
    payload: {
      paymentGroup: signedTxnsB64,
      paymentIndex: paymentIndex,
    },
    accepted: {
      payTo: requirements.payTo,
      price: {
        amount: requirements.amount.toString(),
        asset: Number(requirements.asset || 0),
      },
      network: requirements.network,
    },
    resource: { url: requirements.url || "https://api.algofile.io/api/algofile/upload" },
    extensions: {},
  };

  const paymentHeader = window.btoa(JSON.stringify(paymentPayload));

  const successResponse = await axios.post(endpoint, formData, {
    headers: {
      "x-api-key": apiKey,
      "x-x402-payment-payload": paymentHeader,
    },
  });

  if (successResponse.status === 200 || successResponse.status === 201) {
    if (successResponse.data && successResponse.data.cid) {
      return successResponse.data.cid;
    }
  }
  throw new Error("AlgoFile upload response did not return a valid CID.");
}

export async function uploadToAlgoFile(
  file: File | Blob | string,
  fileName: string,
  address: string,
  transactionSigner: algosdk.TransactionSigner,
  algodClient: algosdk.Algodv2,
  apiKey: string = "algofilerouteapi1y"
): Promise<string> {
  // Legacy fallback function
  const { requirements } = await getAlgoFilePaymentRequirements(file, fileName, apiKey);
  const assetId = Number(requirements.asset || 0);
  const amountMicro = BigInt(requirements.amount);
  const params = await algodClient.getTransactionParams().do();
  
  let txn: algosdk.Transaction;
  if (assetId === 0) {
    txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: address,
      to: requirements.payTo,
      amount: amountMicro,
      suggestedParams: params,
    });
  } else {
    txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: address,
      to: requirements.payTo,
      amount: amountMicro,
      assetIndex: assetId,
      suggestedParams: params,
    });
  }

  const signedTxns = await walletSign([txn], transactionSigner);
  if (!signedTxns || signedTxns.length === 0) {
    throw new Error("Payment transaction signature was rejected by user.");
  }

  let binary = "";
  const len = signedTxns[0].byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(signedTxns[0][i]);
  }
  const signedTxnB64 = window.btoa(binary);
  
  return completeAlgoFileUpload(file, fileName, [signedTxnB64], 0, requirements, apiKey);
}
