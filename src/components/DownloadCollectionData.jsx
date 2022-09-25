import { useState } from "react"
import { toast } from "react-toastify";
import axios from "axios";
import { Arc69 } from "../utils";

export function DownloadCollectionData() {
    const [creatorWallet, setCreatorWallet] = useState("");
    const [collectionData, setCollectionData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [counter, setCounter] = useState(0);

    const arc69 = new Arc69();

    async function getCollectionData() {
        if (creatorWallet) {
            if (creatorWallet.length != 58) {
                toast.error("Invalid wallet address!");
                return;
            }
            try {
                const url = `https://mainnet-idx.algonode.cloud/v2/accounts/${creatorWallet}?exclude=assets,apps-local-state,created-apps,none`;
                const response = await axios.get(url);
                setCollectionData(response.data.account["created-assets"]);
            } catch (error) {
                toast.error("Error getting collection data! Please try again.");
            }
        } else {
            toast.info("Please enter a wallet address");
        }
    };

    async function getAssetData(asset, data) {
        try {
            const metadata = await arc69.fetch(asset.index);
            const asset_data_csv = {
                index: asset.index,
                name: asset.params.name,
                "unit-name": asset.params["unit-name"],
                url: asset.params.url,
                metadata_description: metadata.description || "",
                metadata_external_url: metadata.external_url || "",
                metadata_mime_type: metadata.mime_type || "",
            };

            if (metadata.properties) {
                Object.entries(metadata.properties).map(
                    ([trait_type, value]) => {
                        asset_data_csv[`metadata_${trait_type}`] = value;
                    }
                );
            }
            if (metadata.attributes) {
                metadata.attributes.map(({ trait_type, value }) => {
                    asset_data_csv[`metadata_${trait_type}`] = value;
                });
            }
            return asset_data_csv;
        } catch (err) {
            //console.log(err);
        }
    }

    function convertToCSV(objArray) {
        var array = typeof objArray != 'object' ? JSON.parse(objArray) : objArray;
        var str = '';
        for (var i = 0; i < array.length; i++) {
            var line = '';
            for (var index in array[i]) {
                if (line != '') line += ','
                line += '"' + array[i][index] + '"';
            }
            str += line + '\r\n';
        }
        return str;
    }

    function exportCSVFile(headers, items, fileTitle) {
        if (headers) {
            items.unshift(headers);
        }
        var jsonObject = JSON.stringify(items);

        var csv = convertToCSV(jsonObject);
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        if (navigator.msSaveBlob) {
            navigator.msSaveBlob(blob, fileTitle);
        } else {
            var link = document.createElement("a");
            if (link.download !== undefined) {
                var url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", fileTitle);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
    }

    async function downloadCollectionDataAsCSV() {
        if (collectionData.length > 0) {
            setLoading(true);
            const data = [];
            let count = 0;
            for (const asset of collectionData) {
                const asset_data = await getAssetData(asset);
                count++;
                setCounter(count);
                data.push(asset_data);
            }
            const headers = data[0] ? Object.keys(data[0]) : [];
            exportCSVFile(
                headers ? headers : ["index", "name", "unit-name", "url", "metadata"],
                data,
                `${creatorWallet}-collection-data.csv`
            );
            setLoading(false);
            setCounter(0);
        } else {
            toast.info("Please get collection data first!");
        }
    };

    return (
        <div className="flex flex-col justify-center mb-4">
            <input
                type="text"
                id="creatorWallet"
                placeholder="Enter Creator Wallet Address"
                maxLength={58}
                className="text-center bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-64 mx-auto placeholder:text-center placeholder:text-sm"
                value={creatorWallet}
                onChange={(e) => setCreatorWallet(e.target.value)}
            />
            <button
                className="mb-2 bg-rose-500 hover:bg-rose-700 text-white text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                onClick={getCollectionData}
            >
                Get Collection Data
            </button>
            {collectionData.length > 0 && (
                <>
                    {(creatorWallet.length == 58 && collectionData) && (
                        <div className="flex flex-col justify-center items-center">
                            <p className="text-center text-sm text-slate-300">
                                {creatorWallet.substring(0, 4)}...{creatorWallet.substring(creatorWallet.length - 4, creatorWallet.length)} has <span className="text-slate-100 font-semibold text-base animate-pulse">{collectionData.length}</span> created assets
                            </p>
                        </div>
                    )}
                    {loading ? (
                        <div className="mx-auto flex flex-col">
                            <div
                                className="spinner-border animate-spin inline-block mx-auto mt-4 w-8 h-8 border-4 rounded-full"
                                role="status"
                            ></div>
                            Fetching data from blockchain...
                            <p className="text-center text-sm text-slate-300">
                                {counter}/{collectionData.length}
                            </p>
                            <button
                                className="bg-red-500 hover:bg-red-700 text-white text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                                onClick={() => {
                                    window.location.reload();
                                }
                                }
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={downloadCollectionDataAsCSV}
                            className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                        >
                            Download Data as CSV
                        </button>
                    )}
                </>
            )}
        </div>
    )
}