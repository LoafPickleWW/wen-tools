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

  const x402Network = (requirements.network || "").includes("mainnet") || (requirements.network || "").includes("wGHE2") ? "mainnet" : "testnet";
  const paymentPayload = {
    x402Version: 2,
    network: x402Network,
    payload: {
      paymentGroup: signedTxnsB64,
      paymentIndex: paymentIndex,
    },
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

async function runWithConcurrencyLimit<T>(
  limit: number,
  tasks: (() => Promise<T>)[]
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<any>[] = [];
  for (const task of tasks) {
    const p = task().then((res) => {
      executing.splice(executing.indexOf(p), 1);
      return res;
    });
    results.push(p as any);
    if (limit <= tasks.length) {
      executing.push(p);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

export async function getAlgoFileBatchPaymentRequirements(
  items: { fileName: string; sizeBytes: number; contentType: string }[],
  apiKey: string = "algofilerouteapi1y"
): Promise<any> {
  const endpoint = "/api/algofile/upload/bulk-presigned";
  try {
    await axios.post(
      endpoint,
      { items },
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
      }
    );
    throw new Error("Expected 402 payment challenge but bulk-presigned request succeeded without payment.");
  } catch (error: any) {
    if (error.response && error.response.status === 402) {
      const challengeDetails = error.response.data;
      const requirements = challengeDetails.requirements;
      if (!requirements) {
        throw new Error("Invalid payment challenge response from AlgoFile.");
      }
      return requirements;
    }
    throw new Error(error.response?.data?.message || error.message || "Failed to get batch payment requirements.");
  }
}

export async function completeAlgoFileBatchUpload(
  items: { fileName: string; sizeBytes: number; contentType: string }[],
  signedTxnsB64: string[],
  paymentIndex: number,
  requirements: any,
  apiKey: string = "algofilerouteapi1y"
): Promise<{ bucketName: string; items: any[] }> {
  const endpoint = "/api/algofile/upload/bulk-presigned";

  const x402Network = (requirements.network || "").includes("mainnet") || (requirements.network || "").includes("wGHE2") ? "mainnet" : "testnet";
  const paymentPayload = {
    x402Version: 2,
    network: x402Network,
    payload: {
      paymentGroup: signedTxnsB64,
      paymentIndex: paymentIndex,
    },
  };

  const paymentHeader = window.btoa(JSON.stringify(paymentPayload));

  const successResponse = await axios.post(
    endpoint,
    { items },
    {
      headers: {
        "x-api-key": apiKey,
        "x-x402-payment-payload": paymentHeader,
        "Content-Type": "application/json",
      },
    }
  );

  if (successResponse.status === 200 || successResponse.status === 201) {
    return successResponse.data;
  }
  throw new Error("AlgoFile bulk-presigned call failed.");
}

export async function uploadFilesToS3(
  files: { file: File | Blob; uploadUrl: string; contentType: string }[],
  onProgress?: (index: number, progressPercent: number) => void
): Promise<void> {
  const limit = 15;
  const tasks = files.map((item, index) => {
    return async () => {
      await axios.put(item.uploadUrl, item.file, {
        headers: {
          "Content-Type": item.contentType,
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(index, percent);
          }
        },
      });
    };
  });

  await runWithConcurrencyLimit(limit, tasks);
}

export async function confirmAlgoFileBatch(
  bucketName: string,
  items: { key: string; originalName: string; sizeBytes: number }[],
  apiKey: string = "algofilerouteapi1y"
): Promise<{ success: boolean; items: any[] }> {
  const endpoint = "/api/algofile/upload/confirm-bulk";
  const res = await axios.post(
    endpoint,
    { bucketName, items },
    {
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    }
  );
  if (res.status === 200 || res.status === 201) {
    return res.data;
  }
  throw new Error("AlgoFile batch confirmation failed.");
}
