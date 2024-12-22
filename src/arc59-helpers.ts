/* Helper functions for sending to an arc59 contract */
import algosdk, { Transaction, Algodv2 } from "algosdk";
import { NetworkId } from "@txnlab/use-wallet-react";
import { Arc59Client } from "./clients/Arc59Client";

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
