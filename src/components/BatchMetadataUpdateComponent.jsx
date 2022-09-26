import { useState } from 'react';
import Papa from 'papaparse';
import ConnectButton from './ConnectButton';
import algosdk from "algosdk";
import { toast } from "react-toastify";
import { createAssetConfigArray } from '../utils';

export function BatchCollectionMetadataUpdate(props) {
    const [csvData, setCsvData] = useState(null);
    const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);


    function sliceIntoChunks(arr, chunkSize) {
        const res = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize);
            res.push(chunk);
        }
        return res;
    }

    const handleFileData = async () => {
        let headers;
        let data = [];
        for (let i = 0; i < csvData.length; i++) {
            if (i === 0) {
                headers = csvData[i];
            } else {
                let obj = {};
                for (let j = 0; j < headers.length; j++) {
                    if (headers[j].startsWith('metadata_')) {
                        obj[headers[j].replace('metadata_', '')] = csvData[i][j];
                    } else {
                        obj[headers[j]] = csvData[i][j];
                    }
                }
                data.push(obj);
            }
        }
        let data_for_txns = data;
        data_for_txns.forEach((item) => {
            let asset_note = {
                properties: {
                },
            };
            Object.keys(item).forEach((key) => {
                if (key != "index" && key != "description" && key != "mime_type" && key != "standard" && key != "external_url") {
                    asset_note.properties[key] = item[key];
                    delete item[key];
                }
                if (key == "external_url" || key == "standard" || key == "description" || key == "mime_type") {
                    asset_note[key] = item[key];
                    delete item[key];
                }
            });
            item.asset_id = parseInt(item.index);
            delete item.index;
            item.note = asset_note;
            if (!item.note.standard) {
                item.note.standard = "arc69";
            }
        });

        if (localStorage.getItem("wallet") === null || localStorage.getItem("wallet") === undefined) {
            toast.error("Wallet not found!");
            return;
        }
        try {
            toast.info("Please sign the transaction(s)!");
            const signedTxns = sliceIntoChunks(data_for_txns, 16);
            for (let i = 0; i < signedTxns.length; i++) {
                const nodeURL = props.selectNetwork == "mainnet" ? "https://node.algoexplorerapi.io/" : "https://node.testnet.algoexplorerapi.io/";
                const group = await createAssetConfigArray(signedTxns[i], nodeURL);
                const algodClient = new algosdk.Algodv2("", nodeURL, {
                    "User-Agent": "evil-tools",
                });
                toast.info("Sending transaction...", { autoClose: 4000 });
                const { txId } = await algodClient
                    .sendRawTransaction(group.map((txn) => txn.blob))
                    .do();
                await algosdk.waitForConfirmation(algodClient, txId, 2);
                toast.success(`Group ${i + 1} sent!`);
            }
            toast.success("All transactions sent!");
            setIsTransactionsFinished(true);
        } catch (error) {
            console.log(error);
        }
    };

    return (
        <div className='mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2'>
            <p>1- Connect Creator Wallet</p>
            <ConnectButton />
            <p>2- Upload CSV file</p>
            {csvData == null ? (
                <label htmlFor="dropzone-file" className="flex flex-col justify-center items-center w-[16rem] h-[8rem] px-4  rounded-lg border-2  border-dashed cursor-pointer hover:bg-bray-800 bg-gray-700  border-gray-600 hover:border-gray-500 hover:bg-gray-600">
                    <div className="flex flex-col justify-center items-center pt-5 pb-6">
                        <p className="mb-1 text-sm text-gray-400 font-bold">Click to upload file</p>
                        <p className="text-xs text-gray-400">(CSV,XLS,XLSX)</p>
                        <p className="text-xs text-gray-300">To be sure there is no empty row at the end of the file</p>
                    </div>
                    <input
                        className="hidden"
                        id="dropzone-file"
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={(e) => {
                            const file = e.target.files[0];
                            Papa.parse(file, {
                                complete: function (results) {
                                    setCsvData(results.data);
                                },
                            });
                        }}
                    />
                </label>
            ) : (
                <div className="flex flex-col justify-center items-center w-[16rem]">

                    {
                        isTransactionsFinished ? (
                            <>
                                <p className='pt-4 text-green-500 animate-pulse text-sm'>
                                    All transactions completed!<br />
                                </p>
                                <p className='pb-2 text-slate-400 text-xs'>You can reload the page if you want to use another tool.</p>
                            </>
                        ) : (
                            <>
                                <p className="mb-1 text-sm font-bold">File uploaded</p>
                                <p className="text-sm text-gray-400">{csvData.length - 1} assets found!</p>
                                <p>3- Sign Your Transactions</p>
                                <button
                                    id="approve-send"
                                    className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                                    onClick={handleFileData}
                                >
                                    Approve & Send
                                </button>
                                <p className='text-xs text-gray-400 max-w-[16rem] '>*MyAlgo Wallet can sign up to 16 transactions at once. So you need to sign multiple times (x/16) if you have more than 16 assets.</p>
                            </>
                        )
                    }
                </div>
            )}
        </div>
    )
}