import { useState } from "react";
import { toast } from "react-toastify";
import { createDonationTransaction } from "../utils";
import algosdk from "algosdk";
import MyAlgoConnect from "@randlabs/myalgo-connect";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { Web3Storage } from 'web3.storage';


export function UploadCollectionToIPFS() {
    const [token, setToken] = useState("");
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [donationAmount, setDonationAmount] = useState(1);
    const [collectionCid, setCollectionCid] = useState("");
    const [loading, setLoading] = useState(false);


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


    async function uploadFiles() {
        if (token == "") {
            toast.info("Please enter your token key!");
            return
        }
        if (selectedFiles.length == 0) {
            toast.info("Please select a file first!");
            return
        }
        const client = new Web3Storage({ token: token });
        try {
            setLoading(true);
            const cid = await client.put(selectedFiles, { wrapwithDirectory: true });
            setCollectionCid(cid);
            navigator.clipboard.writeText(cid);
            toast.success("Your cid copied to clipboard!");
            setSelectedFiles([]);
        } catch (error) {
            console.log(error)
            toast.error("Error uploading files!");
        }
        setLoading(false);
    }

    return (
        <div className="bg-gray-900 pt-5 pb-24 xl:pb-20 flex justify-center flex-col text-white">
            <Header />
            <main className="flex flex-col justify-center items-center bg-gray-800 mx-4 md:mx-64 py-4 rounded-lg">
                <p className="-mt-2 mb-2 text-lg text-slate-200 font-roboto">Upload Collection Images to IPFS</p>
                <label className=" font-roboto -mb-2 text-xs text-slate-400">Enter Web3Storage Token</label>
                <input
                    type="text"
                    id="token"
                    placeholder="token"
                    className="text-center bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-48 mx-auto placeholder:text-center placeholder:text-sm"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                />
                <p className="text-xs text-slate-400 font-roboto -mt-2 mb-2">you can get your token {" "}
                    <a href="https://web3.storage/docs/#get-an-api-token" target="_blank" className="text-blue-500 hover:text-blue-300 transition">
                        here
                    </a>
                </p>
                <label htmlFor="dropzone-file" className="flex flex-col justify-center items-center w-[16rem] h-[8rem] px-4  rounded-lg border-2  border-dashed cursor-pointer hover:bg-bray-800 bg-gray-700  border-gray-600 hover:border-gray-500 hover:bg-gray-600">
                    <div className="flex flex-col justify-center items-center pt-5 pb-6">
                        <div className="mb-1 text-sm text-gray-400 font-bold">
                            <p>{selectedFiles.length > 0 ? (
                                `${selectedFiles.length} files selected`
                            ) : ("Click to select a folder")}</p>

                        </div>
                    </div>
                    <input
                        className="hidden"
                        id="dropzone-file"
                        directory=""
                        webkitdirectory=""
                        type="file"
                        onChange={(e) => {
                            setSelectedFiles(e.target.files);
                            console.log(e);
                        }}
                    />
                </label>
                {!loading ? (
                    <button
                        id="upload-file"
                        className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-4 mx-auto mt-2 hover:scale-95 duration-700"
                        onClick={uploadFiles}
                    >
                        Upload
                    </button>
                ) : (
                    <div className="mx-auto flex flex-col">
                        <div
                            className="spinner-border animate-spin inline-block mx-auto mt-4 w-8 h-8 border-4 rounded-full"
                            role="status"
                        ></div>
                        Uploading...
                    </div>
                )}
                {collectionCid != "" && (
                    <div className="flex flex-col justify-center items-center">
                        <p className="text-xs text-gray-500 font-semibold">Your collection cid is:</p>
                        <p
                            onClick={
                                () => {
                                    navigator.clipboard.writeText(collectionCid);
                                    toast.success("Your cid copied to clipboard!");
                                }}
                            className="text-xs text-gray-300 hover:text-gray-100 transition font-semibold">{collectionCid}</p>
                        <p className="text-xs text-gray-500 font-semibold">You can use this cid when you mint your collection</p>
                    </div>
                )}
            </main>
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
    )
}
