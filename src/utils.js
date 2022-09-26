import {
    Algodv2,
    computeGroupID,
    makeAssetConfigTxnWithSuggestedParamsFromObject,
    makePaymentTxnWithSuggestedParamsFromObject,
    algosToMicroalgos
} from "algosdk";
import MyAlgoConnect from "@randlabs/myalgo-connect";


const DONATE_WALLET_1 = "O2ZPSV6NJC32ZXQ7PZ5ID6PXRKAWQE2XWFZK5NK3UFULPZT6OKIOROEAPU";
const DONATE_WALLET_2 = "BYKWLR65FS6IBLJO7SKBGBJ4C5T257LBL55OUY6363QBWX24B5QKT6DMEA";

const algodClient = new Algodv2("", "https://node.algoexplorerapi.io", {
    "User-Agent": "evil-tools",
});

export async function createAssetConfigArray(data_for_txns) {
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
            strictEmptyAddressChecking: false
        });
        txnsArray.push(tx);
    }
    const groupID = computeGroupID(txnsArray);
    for (let i = 0; i < txnsArray.length; i++) {
        txnsArray[i].group = groupID;
    }
    const myAlgoConnect = new MyAlgoConnect();
    const signedTxns = await myAlgoConnect.signTransaction(txnsArray.map(txn => txn.toByte()));
    return signedTxns;
}

export async function createDonationTransaction(amount) {
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
    const myAlgoConnect = new MyAlgoConnect();
    const signedTxns = await myAlgoConnect.signTransaction(
        txnsArray.map((txn) => txn.toByte())
    );
    return signedTxns;
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
