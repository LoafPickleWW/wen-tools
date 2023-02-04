import { useEffect, useState } from "react";
import { BatchCollectionMetadataUpdate } from "../pages/BatchMetadataUpdateComponent";
import { DownloadCollectionData } from "../pages/DownloadCollectionData";
import { CollectionSnapshot } from "../pages/CollectionSnapshotComponent";
import { SelectToolComponent } from "../components/SelectToolComponent";
import { AirdropTool } from "../pages/AirdropTool";
import { toast } from "react-toastify";
import { createDonationTransaction } from "../utils";
import algosdk from "algosdk";
import MyAlgoConnect from "@randlabs/myalgo-connect";
import { Footer } from "../components/footer";
import { Header } from "../components/header";

export default function Home() {
    const [selectTool, setSelectTool] = useState("collection_data");
    const [selectNetwork, setSelectNetwork] = useState("mainnet");
    const [donationAmount, setDonationAmount] = useState(5);

    const updateNetworkType = (networkType) => {
        localStorage.setItem("networkType", networkType);
        setSelectNetwork(networkType);
    };

    useEffect(() => {
        if (localStorage.getItem("networkType") !== null) {
            updateNetworkType(localStorage.getItem("networkType"));
        } else {
            updateNetworkType("mainnet");
        }
    }, []);


    const sendDonation = async () => {
        if (donationAmount < 1) {
            toast.info("Please enter a donation amount greater than 0");
            return
        } else if (localStorage.getItem("wallet") === null) {
            toast.info("Please connect your wallet first");
            try {
                const myAlgoConnect = new MyAlgoConnect();
                const wallet = await myAlgoConnect.connect({
                    shouldSelectOneAccount: true,
                });
                localStorage.setItem("wallet", wallet[0].address);
                window.location.reload();
            } catch (e) {
                toast.error("Ooops! Something went wrong! Did you allow pop-ups?");
            }
        }
        else {
            try {
                const group = await createDonationTransaction(donationAmount);
                const algodClient = new algosdk.Algodv2("", "https://node.algoexplorerapi.io", {
                    "User-Agent": "evil-tools",
                });
                toast.info("Sending transaction...");
                const { txId } = await algodClient
                    .sendRawTransaction(group.map((txn) => txn.blob))
                    .do();
                await algosdk.waitForConfirmation(algodClient, txId, 3);
                toast.success("Thank you for your donation!");
            } catch (error) {
                toast.error("Error sending donation!");
            }
        }
    }

    return (
        <div className="bg-gray-900 pt-5 pb-24 xl:pb-20 flex justify-center flex-col text-white">
            <Header />
            <main className="flex flex-col justify-center items-center bg-gray-800 mx-4 md:mx-64  rounded-lg">
                <fieldset className="space-y-3 my-4 bg-rose-500/50 px-4 py-2 rounded-lg">
                    <SelectToolComponent
                        selectTool={selectTool}
                        setSelectTool={setSelectTool}
                    />
                </fieldset>
                {SelectNetworkComponent(selectNetwork, updateNetworkType)}
                {selectTool === "collection_data" && <DownloadCollectionData selectNetwork={selectNetwork} />}
                {selectTool === "collection_snapshot" && <CollectionSnapshot selectNetwork={selectNetwork} />}
                {selectTool === "batch_update" && <BatchCollectionMetadataUpdate selectNetwork={selectNetwork} />}
                {selectTool === "airdrop_tool" && <AirdropTool selectNetwork={selectNetwork} />}
            </main>
            <p className="text-center text-xs text-slate-400 py-2">
                ⚠️If you reload or close this page, you will lose your progress⚠️
                <br />
                You can reload the page if you want to stop/restart the process!
            </p>
            <p className="text-center text-lg text-pink-200">
                <a
                    className="hover:text-pink-400 transition"
                    href="https://loafpickle.medium.com/evil-tools-arc69-made-easy-c7913885cfd2"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    GUIDE & FAQ
                </a>
            </p>
            <div className="flex flex-col mx-auto mt-4 items-center gap-1 pt-2 pb-3 rounded-2xl border-pink-500 border-2 w-[16rem]">
                <p className="text-center text-lg">Donate</p>
                <input className="border-pink-300 border-2 rounded-xl text-pink-700 text-center font-semibold transition max-w-[8rem] placeholder:text-center placeholder:text-pink-800/50"
                    placeholder="ALGO amount"
                    type="number"
                    value={donationAmount}
                    min={1}
                    onChange={(e) => setDonationAmount(parseInt(e.target.value))}
                    inputMode="numeric"
                />
                <button
                    className="bg-rose-500/50 px-6 py-1 mt-1 rounded-lg hover:bg-rose-800/50 transition"
                    onClick={sendDonation}
                >
                    Send
                </button>
            </div>
            <p className="font-bold text-slate-300 text-xs mt-1 text-center">
                supported by {" "}
                <a
                    className="text-green-300 hover:text-green-500 transition"
                    href="https://www.algoverify.me" target="_blank" rel="noopener noreferrer"
                >
                    AlgoVerify
                </a>
            </p>
            <Footer />
        </div>
    );
}

function SelectNetworkComponent(selectNetwork, updateNetworkType) {
    return <fieldset className=" bg-rose-500/50 px-4 py-2 rounded-lg">

        <p className="text-sm font-medium text-center text-orange-300">
            Select Network
        </p>
        <div className="flex flex-row gap-x-2">
            <div className="inline-flex items-center space-x-1">
                <input
                    id="mainnet-select"
                    type="radio"
                    checked={selectNetwork === "mainnet"}
                    onChange={() => updateNetworkType("mainnet")}
                    className="rounded-full border-gray-300 text-rose-600 transition focus:ring-rose-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:opacity-75" />
                <label
                    htmlFor="mainnet-select"
                    className="truncate text-sm font-medium text-slate-200"
                >
                    Mainnet
                </label>
            </div>
            <div className="inline-flex items-center space-x-1">
                <input
                    id="testnet-select"
                    type="radio"
                    checked={selectNetwork === "testnet"}
                    onChange={() => updateNetworkType("testnet")}
                    className="rounded-full border-gray-300 text-rose-600 transition focus:ring-rose-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:opacity-75" />
                <label
                    htmlFor="testnet-select"
                    className="truncate text-sm font-medium text-slate-200"
                >
                    Testnet
                </label>
            </div>
        </div>

    </fieldset>;
}

