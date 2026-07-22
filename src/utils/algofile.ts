import axios from "axios";
import algosdk from "algosdk";
import { walletSign } from "../utils";
import { toast } from "react-toastify";

export async function uploadToAlgoFile(
  file: File | Blob | string,
  fileName: string,
  address: string,
  transactionSigner: algosdk.TransactionSigner,
  algodClient: algosdk.Algodv2,
  apiKey: string = "algofilerouteapi1y"
): Promise<string> {
  if (!address) {
    throw new Error("Wallet address is not connected.");
  }
  if (!transactionSigner) {
    throw new Error("Wallet signer is not available.");
  }

  // 1. Prepare Form Data
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
    // Attempt initial upload to get challenge
    await axios.post(endpoint, formData, {
      headers: {
        "x-api-key": apiKey,
      },
    });
    
    throw new Error("Expected 402 payment challenge but request succeeded without payment.");
  } catch (error: any) {
    if (!error.response || error.response.status !== 402) {
      console.error("AlgoFile initial upload error:", error);
      throw new Error(error.response?.data?.message || error.message || "Failed to initiate upload to AlgoFile.");
    }

    const challengeDetails = error.response.data;
    const requirements = challengeDetails.requirements;
    if (!requirements) {
      throw new Error("Invalid payment challenge response from AlgoFile.");
    }

    const { payTo, amount, asset, network } = requirements;
    const assetId = Number(asset || 0);
    const amountMicro = BigInt(amount);

    const assetLabel = assetId === 0 ? "ALGO" : "USDC";
    toast.info(`AlgoFile requested payment: ${(Number(amountMicro) / 1_000_000).toFixed(6)} ${assetLabel}. Please sign payment transaction.`);

    // 2. Build transaction
    const params = await algodClient.getTransactionParams().do();
    let txn: algosdk.Transaction;

    if (assetId === 0) {
      txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: address,
        to: payTo,
        amount: amountMicro,
        suggestedParams: params,
      });
    } else {
      txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: address,
        to: payTo,
        amount: amountMicro,
        assetIndex: assetId,
        suggestedParams: params,
      });
    }

    // 3. Sign transaction
    const signedTxns = await walletSign([txn], transactionSigner);
    if (!signedTxns || signedTxns.length === 0) {
      throw new Error("Payment transaction signature was rejected by user.");
    }

    // 4. Base64 encode signed transaction
    let binary = "";
    const len = signedTxns[0].byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(signedTxns[0][i]);
    }
    const signedTxnB64 = window.btoa(binary);

    // 5. Construct x402 payment payload
    const paymentPayload = {
      x402Version: 2,
      network: network,
      payload: {
        paymentGroup: [signedTxnB64],
        paymentIndex: 0,
      },
      accepted: {
        payTo: payTo,
        price: {
          amount: amount.toString(),
          asset: assetId,
        },
        network: network,
      },
      resource: { url: endpoint },
      extensions: {},
    };

    const paymentHeader = window.btoa(JSON.stringify(paymentPayload));

    toast.info("Submitting payment payload to complete upload...");

    // 6. Retry upload with payment payload header
    const successResponse = await axios.post(endpoint, formData, {
      headers: {
        "x-api-key": apiKey,
        "x-x402-payment-payload": paymentHeader,
      },
    });

    if (successResponse.status === 200 || successResponse.status === 201) {
      if (successResponse.data && successResponse.data.cid) {
        toast.success("File uploaded to AlgoFile successfully!");
        return successResponse.data.cid;
      }
    }
    throw new Error("AlgoFile upload response did not return a valid CID.");
  }
}
