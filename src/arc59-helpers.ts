/* Helper functions for sending to an arc59 contract */
import algosdk, { Transaction, Algodv2 } from "algosdk";
import { NetworkId } from "@txnlab/use-wallet-react";
import { Arc59Client } from "./clients/Arc59Client";
import { getIndexerURL, getTxnGroupFromATC } from "./utils";
import { ALGORAND_ZERO_ADDRESS } from "./constants";
import axios from "axios";
import * as algokit from "@algorandfoundation/algokit-utils";

/** algosdk v3 dropped ALGORAND_MIN_TX_FEE */
const MIN_TXN_FEE = 1000;

type SenderType = {
  addr: string;
  signer: (
    txnGroup: algosdk.Transaction[],
    indexesToSign: number[]
  ) => Promise<Uint8Array[]>;
};

export type LogDataType = {
  account: string;
  innerTxns: number;
  mbr: number;
  routerOptedIn: boolean;
  routerOptedInCost: number;
  receiverOptedIn: boolean;
  receiverAlgoNeededForClaim: number;
  txnFees: number;
  totalAmount: number;
  txnID: string;
};

export type TxnInfoType = {
  atomicTxns: algosdk.AtomicTransactionComposer[];
  logDataArray: LogDataType[];
  grandTotal: number;
  csv: string;
};

export const createArc59GroupTxns = async (
  txn: Transaction[],
  sender: SenderType,
  activeAddress: string,
  algodClient: Algodv2,
  activeNetwork: NetworkId
) => {
  const txnInfo: TxnInfoType = {
    atomicTxns: [],
    logDataArray: [],
    grandTotal: 0,
    csv: "",
  };

  // const atomicTxns: algosdk.AtomicTransactionComposer[] = [];
  const logDataArray: LogDataType[] = [];
  const appId = activeNetwork === "mainnet" ? 2449590623 : 643020148;
  const suggestedParams = await algodClient.getTransactionParams().do();

  try {
    const appClient = new Arc59Client(
      {
        sender: { addr: algosdk.Address.fromString(sender.addr), signer: sender.signer },
        resolveBy: "id",
        id: appId,
      },
      algodClient
    );

    const simSender = {
      addr: algosdk.Address.fromString(activeAddress),
      signer: algosdk.makeEmptyTransactionSigner(),
    };
    const simParams = {
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      fixSigners: true,
    };
    for (let i = 0; i < txn.length; i++) {
      const logData: LogDataType = {} as LogDataType;
      const assetTransfer = txn[i].assetTransfer!;
      const assetIndex = Number(assetTransfer.assetIndex);
      const receiver = assetTransfer.receiver.toString();
      logData.account = receiver;

      const composer = appClient.compose();
      const appAddr = (await appClient.appClient.getAppReference()).appAddress;
      const [
        itxns,
        mbr,
        routerOptedIn,
        receiverOptedIn,
        receiverAlgoNeededForClaim,
      ] = (
        await appClient
          .compose()
          .arc59GetSendAssetInfo(
            {
              asset: assetIndex,
              receiver: receiver,
            },
            {
              sender: {
                ...simSender,
                addr: algosdk.Address.fromString(activeAddress),
              },
            }
          )
          .simulate(simParams)
      ).returns[0];

      if (receiverOptedIn) {
        console.log("Receiver is opted in");
        const atc = new algosdk.AtomicTransactionComposer();
        atc.addTransaction({ txn: txn[i], signer: sender.signer });
        atc.buildGroup();

        // push data to the arrays
        txnInfo.atomicTxns.push(atc);

        // update the logDataArray
        logDataArray.push({
          ...logData,
          txnFees: MIN_TXN_FEE,
          innerTxns: 0,
          receiverOptedIn: true,
          mbr: 0,
          receiverAlgoNeededForClaim: 0,
          routerOptedIn: routerOptedIn,
          totalAmount: MIN_TXN_FEE,
          txnID: "",
        });
      } else {
        logData.txnFees = 0;

        // log the inner txns plus the txn fee
        logData.innerTxns = Number(itxns) * MIN_TXN_FEE;
        logData.txnFees += MIN_TXN_FEE;

        let amount = 0;
        logData.receiverOptedIn = receiverOptedIn;

        logData.mbr = Number(mbr) || 0;
        logData.receiverAlgoNeededForClaim =
          Number(receiverAlgoNeededForClaim) || 0;

        if (mbr || receiverAlgoNeededForClaim) {
          // If the MBR is non-zero, send the MBR to the router
          const mbrPayment =
            algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              receiver: appAddr,
              sender: activeAddress,
              suggestedParams,
              amount: Number(mbr + receiverAlgoNeededForClaim),
            });

          // add the MBR payment to the atomic transaction plus the txn fee
          amount +=
            Number(mbr + receiverAlgoNeededForClaim) +
            MIN_TXN_FEE;

          logData.txnFees += MIN_TXN_FEE;

          // add the MBR payment to the atomic transaction
          composer.addTransaction({
            txn: mbrPayment,
            signer: sender.signer,
          });
        }

        // If the router is not opted in, add a call to arc59OptRouterIn to do so
        if (!routerOptedIn) {
          composer.arc59OptRouterIn({ asa: assetIndex });

          // opt-in txn fee
          amount += MIN_TXN_FEE;
          logData.txnFees += MIN_TXN_FEE;
        }
        logData.routerOptedIn = routerOptedIn;

        // The transfer of the asset to the router
        // (algosdk v3 transactions are immutable, so rebuild it with the router as receiver)
        const original = txn[i];
        txn[i] = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: original.sender,
          receiver: appAddr,
          amount: assetTransfer.amount,
          assetIndex,
          note: original.note,
          suggestedParams: {
            fee: original.fee,
            flatFee: true,
            firstValid: original.firstValid,
            lastValid: original.lastValid,
            genesisHash: original.genesisHash,
            genesisID: original.genesisID,
            minFee: MIN_TXN_FEE,
          },
        });

        // An extra itxn is if we are also sending ALGO for the receiver claim
        const totalItxns =
          itxns + (receiverAlgoNeededForClaim === 0n ? 0n : 1n);

        amount += MIN_TXN_FEE * Number(totalItxns + 1n);

        const fee = (
          MIN_TXN_FEE * Number(totalItxns + 1n)
        ).microAlgos();
        const boxes = [algosdk.decodeAddress(receiver).publicKey];
        const inboxAddress = (
          await appClient
            .compose()
            .arc59GetInbox({ receiver: receiver }, { sender: simSender })
            .simulate(simParams)
        ).returns[0];

        const accounts = [receiver, inboxAddress];
        const assets = [assetIndex];
        composer.arc59SendAsset(
          {
            axfer: txn[i],
            receiver: receiver,
            additionalReceiverFunds: receiverAlgoNeededForClaim,
          },
          { sendParams: { fee: fee as any }, boxes, accounts, assets }
        );
        // asset send txn fee
        amount += MIN_TXN_FEE;
        logData.txnFees += MIN_TXN_FEE;
        logData.totalAmount = amount;
        logData.txnID = ""; // empty txnID

        // get the atomic transaction composer
        const atc = await composer.atc();

        // Adjust the app call to 1000 rounds instead of 10 rounds
        const originalTxns = atc.clone().buildGroup();
        const unsignedTxn = originalTxns.map((txn) => {
          // lastValid is readonly in algosdk v3's types but a plain field at runtime
          (txn.txn as { lastValid: bigint }).lastValid = txn.txn.firstValid + 1000n;
          txn.txn.group = undefined;
          return txn.txn;
        });

        const newATC = new algosdk.AtomicTransactionComposer();
        unsignedTxn.forEach((txn) => {
          newATC.addTransaction({ txn: txn, signer: sender.signer });
        });

        newATC.buildGroup();
        // push data to the arrays
        txnInfo.atomicTxns.push(newATC);
        logDataArray.push(logData);
      }
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
  // Create CSV file for txn logs
  txnInfo.csv = await convertToCSV(logDataArray);
  txnInfo.grandTotal = logDataArray
    .map((logData) => logData.totalAmount)
    .reduce((a, b) => a + b, 0);

  console.log("Grand Total: ", txnInfo.grandTotal);
  txnInfo.logDataArray = logDataArray;
  return txnInfo;
};

export async function convertToCSV(logData: LogDataType[]) {
  const array = [Object.keys(logData[0])].concat(
    logData.map((item) => Object.values(item).map(String))
  );

  return array
    .map((row) => {
      return Object.values(row).toString();
    })
    .join("\n");
}

export const getAssetsInAssetInbox = async (
  receiver: string,
  algodClient: Algodv2,
  activeNetwork: NetworkId
): Promise<{ assetId: number; amount: number; type: string }[]> => {
  try {
    const appClient = new Arc59Client(
      {
        resolveBy: "id",
        id: activeNetwork === "mainnet" ? 2449590623 : 643020148,
      },
      algodClient
    );

    const simSender = {
      addr: algosdk.Address.fromString(receiver),
      signer: algosdk.makeEmptyTransactionSigner(),
    };
    const simParams = {
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      fixSigners: true,
    };

    const inboxAddress = (
      await appClient
        .compose()
        .arc59GetInbox({ receiver: receiver }, { sender: simSender })
        .simulate(simParams)
    ).returns[0];

    if (inboxAddress !== ALGORAND_ZERO_ADDRESS) {
      console.log(inboxAddress);

      const idx = getIndexerURL(activeNetwork);
      const url = `${idx}/v2/accounts/${inboxAddress}/assets`;

      let resp = await axios.get(url);
      let finalAssets = resp.data.assets;
      while (resp.data["next-token"]) {
        const next = resp.data["next-token"];
        const url = `${idx}/v2/accounts/${inboxAddress}/assets?next=${next}`;
        resp = await axios.get(url);
        finalAssets = finalAssets.concat(resp.data.assets);
      }

      const assets = [];

      for (let i = 0; i < finalAssets.length; i++) {
        const asset = finalAssets[i];
        if (
          asset["is-frozen"] == false &&
          asset["deleted"] == false &&
          asset.amount > 0
        ) {
          assets.push({
            assetId: asset["asset-id"],
            amount: asset.amount,
            type: "inbox",
          });
        }
      }

      return assets;
    } else {
      return [];
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
};

/**
 * Claim an asset from the ARC59 inbox
 *
 * @param appClient The ARC59 client generated by algokit
 * @param assetId The ID of the asset to claim
 * @param claimer The address of the account claiming the asset
 * @param algorand The AlgorandClient instance to use to send transactions
 */
export const generateARC59ClaimTxns = async (
  assetId: bigint,
  claimer: string,
  algodClient: Algodv2,
  activeNetwork: NetworkId
) => {
  const algorand = algokit.AlgorandClient.fromClients({ algod: algodClient });

  // Check if the claimer has opted in to the asset
  let claimerOptedIn = false;
  try {
    await algorand.asset.getAccountInformation(claimer, assetId);
    claimerOptedIn = true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_: any) {
    // Do nothing
  }

  const simSender = {
    addr: algosdk.Address.fromString(claimer),
    signer: algosdk.makeEmptyTransactionSigner(),
  };

  const simParams = {
    allowEmptySignatures: true,
    allowUnnamedResources: true,
    fixSigners: true,
  };

  const appClient = new Arc59Client(
    {
      sender: simSender,
      resolveBy: "id",
      id: activeNetwork === "mainnet" ? 2449590623 : 643020148,
    },
    algodClient
  );

  const inboxAddress = (
    await appClient
      .compose()
      .arc59GetInbox({ receiver: claimer }, { sender: simSender })
      .simulate(simParams)
  ).returns[0];

  const composer = appClient.compose();

  const totalTxns = 3;

  // If the claimer hasn't already opted in, add a transaction to do so
  if (!claimerOptedIn) {
    composer.addTransaction(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: claimer,
        receiver: claimer,
        assetIndex: Number(assetId),
        amount: 0,
        suggestedParams: await algodClient.getTransactionParams().do(),
        note: new TextEncoder().encode(
          "via wen.tools - free tools for creators and collectors | " +
            Math.random().toString(36).substring(2)
        ),
      })
    );
  }

  composer.arc59Claim(
    { asa: assetId },
    {
      note: new TextEncoder().encode(
        "via wen.tools - free tools for creators and collectors | " +
          Math.random().toString(36).substring(2)
      ),
      boxes: [algosdk.decodeAddress(claimer).publicKey],
      accounts: [claimer, inboxAddress],
      assets: [Number(assetId)],
      sendParams: { fee: algokit.microAlgos(3000 * totalTxns) as any },
    }
  );

  const atc = await composer.atc();

  return getTxnGroupFromATC(atc);
};
