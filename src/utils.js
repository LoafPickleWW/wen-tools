import {
    Algodv2,
    algosToMicroalgos,
    makeAssetTransferTxnWithSuggestedParamsFromObject,
    makePaymentTxnWithSuggestedParamsFromObject,
    computeGroupID,
} from "algosdk";
import axios from "axios";


const DONATE_WALLET_1 = "BYKWLR65FS6IBLJO7SKBGBJ4C5T257LBL55OUY6363QBWX24B5QKT6DMEA";
const DONATE_WALLET_2 = "BYKWLR65FS6IBLJO7SKBGBJ4C5T257LBL55OUY6363QBWX24B5QKT6DMEA";

const algodClient = new Algodv2("", "https://node.testnet.algoexplorerapi.io", {
    "User-Agent": "evil-tools",
});

export async function createGameTransaction(wallet, amount) {
    const params = await algodClient.getTransactionParams().do();

    // const token_transaction_user =
    //     makeAssetTransferTxnWithSuggestedParamsFromObject({
    //         from: wallet,
    //         to: linxPoolWallet,
    //         amount: parseInt(amount),
    //         assetIndex: linxTokenAssetId,
    //         suggestedParams: params,
    //     });

    // const algo_tx_user = makePaymentTxnWithSuggestedParamsFromObject({
    //     from: wallet,
    //     to: linxPoolWallet,
    //     amount: algoFeeForTX,
    //     suggestedParams: params,
    // });

    // let txnsArray = [token_transaction_user, algo_tx_user];
    // const groupID = computeGroupID(txnsArray);
    // for (let i = 0; i < 2; i++) {
    //     txnsArray[i].group = groupID;
    // }

    //return txnsArray;
}

export class Arc69 {
    constructor() {
        this.algoExplorerApiBaseUrl = "https://algoindexer.algoexplorerapi.io";
        this.algonodeExplorerApiBaseUrl = "https://mainnet-idx.algonode.cloud";
    }

    async fetch(assetId) {
        const url = Math.round(Math.random()) == 1 ? `${this.algoExplorerApiBaseUrl}/v2/transactions?asset-id=${assetId}&tx-type=acfg`
            : `${this.algonodeExplorerApiBaseUrl}/v2/assets/${assetId}/transactions?tx-type=acfg`;
        let transactions;

        try {
            transactions = (await fetch(url).then((res) => res.json())).transactions;
        }
        catch (err) {
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
            }
            catch (err) {
                //console.log(err);
            }
        }
        return null;
    }
}
