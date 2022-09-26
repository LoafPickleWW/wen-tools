import { useState } from "react";
import { BatchCollectionMetadataUpdate } from "../components/BatchMetadataUpdateComponent";
import { DownloadCollectionData } from "../components/DownloadCollectionData";
import { SelectToolComponent } from "../components/SelectToolComponent";
import { toast } from "react-toastify";
import { createDonationTransaction } from "../utils";
import algosdk from "algosdk";
import ConnectButton from "../components/ConnectButton";

export default function Home() {
    const [selectTool, setSelectTool] = useState("batch_update"); // collection_data
    const [donationAmount, setDonationAmount] = useState(1);


    const sendDonation = async () => {
        if (donationAmount < 1) {
            toast.info("Please enter a donation amount greater than 0");
            return
        } else if (localStorage.getItem("wallet") === null) {
            toast.info("Please connect your wallet first");
            return
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
        <div className="bg-gray-900 text-white justify-center  min-h-screen">
            <header className="flex justify-center items-center p-4">
                <h1 className="text-2xl font-bold">
                    Evil Tools{" "}
                    <p className="italic font-thin text-center text-xl">(ARC69)</p>
                </h1>
            </header>
            <main className="flex flex-col justify-center items-center bg-gray-800 mx-4 md:mx-64  rounded-lg">
                <fieldset className="space-y-3 my-4 bg-rose-500/50 px-4 py-2 rounded-lg">
                    <SelectToolComponent
                        selectTool={selectTool}
                        setSelectTool={setSelectTool}
                    />
                </fieldset>
                {selectTool === "collection_data" ? (
                    <DownloadCollectionData />
                ) : (
                    <BatchCollectionMetadataUpdate />
                )}
            </main>
            <p className="text-center text-xs text-slate-400 py-2">
                ⚠️If you reload or close this page, you will lose your progress⚠️
                <br />
                You can reload the page if you want to stop/restart the process!
            </p>
            <div className="flex flex-wrap mx-auto my-16 items-center flex-col gap-1 pt-2 pb-3 rounded-2xl border-pink-500 border-2 max-w-[16rem]">
                <p className="text-center text-lg">Donate</p>
                <input className="border-pink-300 border-2 rounded-xl text-pink-700 text-center font-semibold transition max-w-[8rem] placeholder:text-center placeholder:text-pink-800/50"
                    placeholder="ALGO amount"
                    type="number"
                    min={1}
                    onChange={(e) => setDonationAmount(parseInt(e.target.value))}
                />
                <button
                    className="bg-rose-500/50 px-6 py-1 mt-1 rounded-lg hover:bg-rose-800/50 transition"
                    onClick={sendDonation}
                >
                    Send
                </button>
            </div>
            <footer className="py-4 px-4 sm:px-6 bg-gray-800 text-white w-full bottom-0 fixed">
                <div className="mx-auto">
                    <div className="flex justify-between items-center">
                        <span>
                            powered by&nbsp;
                            <a
                                className="font-semibold transition text-sm hover:text-pink-600"
                                href="https://twitter.com/Thurstobertay"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Stupid Horses
                            </a>
                        </span>
                        <span className="text-xxs">
                            developed by{" "}
                            <a
                                className="font-semibold transition text-xxs hover:text-pink-600"
                                href="https://twitter.com/cryptolews"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                bykewel
                            </a>
                        </span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
