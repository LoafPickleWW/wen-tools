import { useState } from "react";
import { toast } from "react-toastify";
//import MyAlgoConnect from "@randlabs/myalgo-connect";
import { Web3Storage } from "web3.storage/dist/bundle.esm.min.js";
import { PeraWalletConnect } from "@perawallet/connect";
import { TOOLS } from "../utils";

export function UploadCollectionToIPFS() {
  const [token, setToken] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [collectionCid, setCollectionCid] = useState("");
  const [loading, setLoading] = useState(false);


  async function uploadFiles() {
    if (token == "") {
      toast.info("Please enter your token key!");
      return;
    }
    if (selectedFiles.length == 0) {
      toast.info("Please select a file first!");
      return;
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
      //console.log(error)
      toast.error("Error uploading files!");
    }
    setLoading(false);
  }

  return (
    <div className="bg-gray-900 pt-5 pb-24 xl:pb-20 flex justify-center flex-col text-white">
      <main className="flex flex-col justify-center items-center bg-gray-800 mx-4 md:mx-64 py-4 rounded-lg">
      <p className="text-2xl font-bold mt-1">{TOOLS.find((tool) => tool.path ===  window.location.pathname).label}</p>

        <label className=" font-roboto -mb-2 text-xs text-slate-400">
          Enter Web3Storage Token
        </label>
        <input
          type="text"
          id="token"
          placeholder="token"
          className="text-center bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-48 mx-auto placeholder:text-center placeholder:text-sm"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <p className="text-xs text-slate-400 font-roboto -mt-2 mb-2">
          you can get your token{" "}
          <a
            href="https://web3.storage/docs/#get-an-api-token"
            target="_blank"
            className="text-blue-500 hover:text-blue-300 transition"
            rel="noreferrer"
          >
            here
          </a>
        </p>
        <label
          htmlFor="dropzone-file"
          className="flex flex-col justify-center items-center w-[16rem] h-[8rem] px-4  rounded-lg border-2  border-dashed cursor-pointer hover:bg-bray-800 bg-gray-700  border-gray-600 hover:border-gray-500 hover:bg-gray-600"
        >
          <div className="flex flex-col justify-center items-center pt-5 pb-6">
            <div className="mb-1 text-sm text-gray-400 font-bold">
              <p>
                {selectedFiles.length > 0
                  ? `${selectedFiles.length} files selected`
                  : "Click to select a folder"}
              </p>
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
            <p className="text-xs text-gray-500 font-semibold">
              Your collection cid is:
            </p>
            <p
              onClick={() => {
                navigator.clipboard.writeText(collectionCid);
                toast.success("Your cid copied to clipboard!");
              }}
              className="text-xs text-gray-300 hover:text-gray-100 transition font-semibold"
            >
              {collectionCid}
            </p>
            <p className="text-xs text-gray-500 font-semibold">
              You can use this cid when you mint your collection
            </p>
          </div>
        )}
        <p className="text-center text-xs text-slate-400 py-2">
          ⚠️If you reload or close this page, you will lose your progress⚠️
          <br />
          You can reload the page if you want to stop/restart the process!
        </p>
      </main>
    </div>
  );
}
