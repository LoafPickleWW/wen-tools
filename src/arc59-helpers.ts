/* Helper functions for sending to an arc59 contract */
import algosdk, { Transaction, Algodv2 } from "algosdk";
import { NetworkId } from "@txnlab/use-wallet-react";
import { Arc59Client } from "./clients/Arc59Client";
import { getIndexerURL, getTxnGroupFromATC } from "./utils";
import { ALGORAND_ZERO_ADDRESS } from "./constants";
import axios from "axios";
import * as algokit from "@algorandfoundation/algokit-utils";

type SenderType = {
  addr: string;
  signer: (
    txnGroup: algosdk.Transaction[],
    indexesToSign: number[]
  ) => Promise<Uint8Array[]>;
};

// TODO: make sure to add the correct singleton contract id depending on the network

export const createArc59GroupTxns = async (
  txn: Transaction[],
  sender: SenderType,
  activeAddress: string,
  algodClient: Algodv2,
  activeNetwork: NetworkId
) => {
  try {
    const appClient = new Arc59Client(
      {
        sender,
        resolveBy: "id",
        id: activeNetwork === "mainnet" ? 2449590623 : 643020148,
      },
      algodClient
    );

    const simSender = {
      addr: activeAddress,
      signer: algosdk.makeEmptyTransactionSigner(),
    };
    const simParams = {
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      fixSigners: true,
    };
    for (let i = 0; i < txn.length; i++) {
      const suggestedParams = await algodClient.getTransactionParams().do();
      const composer = appClient.compose();
      const appAddr = (await appClient.appClient.getAppReference()).appAddress;
      const receiver = algosdk.encodeAddress(txn[i].to.publicKey);
      const [
        itxns,
        mbr,
        routerOptedIn,
        _receiverOptedIn,
        receiverAlgoNeededForClaim,
      ] = (
        await appClient
          .compose()
          .arc59GetSendAssetInfo(
            {
              asset: txn[i].assetIndex,
              receiver: receiver,
            },
            {
              sender: {
                ...simSender,
                addr: activeAddress,
              },
            }
          )
          .simulate(simParams)
      ).returns[0];

      console.log("itxns: ", itxns);

      if (_receiverOptedIn) {
        console.log("Receiver is opted in");
      }
      if (mbr || receiverAlgoNeededForClaim) {
        // If the MBR is non-zero, send the MBR to the router
        const mbrPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          to: appAddr,
          from: activeAddress,
          suggestedParams,
          amount: Number(mbr + receiverAlgoNeededForClaim),
        });
        composer.addTransaction({
          txn: mbrPayment,
          signer: sender.signer,
        });
      }

      // If the router is not opted in, add a call to arc59OptRouterIn to do so
      if (!routerOptedIn) composer.arc59OptRouterIn({ asa: txn[i].assetIndex });

      // The transfer of the asset to the router
      txn[i].to = algosdk.decodeAddress(appAddr);

      // An extra itxn is if we are also sending ALGO for the receiver claim
      const totalItxns = itxns + (receiverAlgoNeededForClaim === 0n ? 0n : 1n);

      const fee = (
        algosdk.ALGORAND_MIN_TX_FEE * Number(totalItxns + 1n)
      ).microAlgos();
      const boxes = [algosdk.decodeAddress(receiver).publicKey];
      const inboxAddress = (
        await appClient
          .compose()
          .arc59GetInbox({ receiver: receiver }, { sender: simSender })
          .simulate(simParams)
      ).returns[0];

      const accounts = [receiver, inboxAddress];
      const assets = [Number(txn[i].assetIndex)];
      composer.arc59SendAsset(
        {
          axfer: txn[i],
          receiver: receiver,
          additionalReceiverFunds: receiverAlgoNeededForClaim,
        },
        { sendParams: { fee }, boxes, accounts, assets }
      );

      // get the atomic transaction composer
      const atc = await composer.atc();
      await atc.gatherSignatures();
      const result = await atc.submit(algodClient);
      console.log("result: ", result);
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
};

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
      addr: receiver,
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
    await algorand.account.getAssetInformation(claimer, assetId);
    claimerOptedIn = true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_: any) {
    // Do nothing
  }

  const simSender = {
    addr: claimer,
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
        from: claimer,
        to: claimer,
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
      sendParams: { fee: algokit.microAlgos(1000 * totalTxns) },
    }
  );

  const atc = await composer.atc();

  return getTxnGroupFromATC(atc);
};
