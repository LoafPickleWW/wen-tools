import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import {
  createAssetOptInTransactions,
  SignWithMnemonic,
  sliceIntoChunks,
  walletSign,
} from "../utils";

import { TOOLS } from "../constants";

import { useSearchParams } from "react-router-dom";
import InfinityModeComponent from "../components/InfinityModeComponent";
import FaqSectionComponent from "../components/FaqSectionComponent";
import { useWallet } from "@txnlab/use-wallet-react";

export function BatchOptin() {
  const [csvData, setCsvData] = useState(null as null | any);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [assetIds, setAssetIds] = useState("");
  const [searchParams] = useSearchParams();
  const { activeAddress, algodClient, transactionSigner } = useWallet();

  useEffect(() => {
    if (searchParams.has("ids")) {
      setAssetIds(searchParams.get("ids")!);
    }
  }, [searchParams]);

  const handleFileData = async () => {
    const assets: number[] = [];
    for (let i = 0; i < csvData.length; i++) {
      if (i !== 0) {
        assets.push(parseInt(csvData[i][0]));
      }
    }
    if (assets.length === 0) {
      toast.error("No assets found in the file!");
      return;
    }
    if (activeAddress === null || activeAddress === undefined) {
      toast.error("Wallet not found!");
      return;
    }

    try {
      try {
        if (mnemonic === "") toast.info("Please sign the transactions!");
        const groups = await createAssetOptInTransactions(
          assets,
          activeAddress,
          algodClient
        );
        let signedTransactions = [];
        if (mnemonic !== "") {
          signedTransactions = SignWithMnemonic(groups.flat(), mnemonic);
        } else {
          const flat = await walletSign(groups, transactionSigner);
          signedTransactions = sliceIntoChunks(flat, 16);
        }
        setTxSendingInProgress(true);
        for (let i = 0; i < signedTransactions.length; i++) {
          try {
            await algodClient.sendRawTransaction(signedTransactions[i]).do();
            if (i % 5 === 0) {
              toast.success(
                `Transaction ${i + 1} of ${
                  signedTransactions.length
                } confirmed!`,
                {
                  autoClose: 1000,
                }
              );
            }
          } catch (err) {
            console.error(err);
            toast.error(
              `Transaction ${i + 1} of ${signedTransactions.length} failed!`,
              {
                autoClose: 1000,
              }
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        setIsTransactionsFinished(true);
        setTxSendingInProgress(false);
        toast.success("All transactions confirmed!");
        toast.info("You can support by donating :)");
      } catch (err) {
        console.error(err);
        setTxSendingInProgress(false);
        toast.error("Something went wrong! Please check your file!");
        return;
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setTxSendingInProgress(false);
    }
  };

  return (
    <div className="mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 mx-auto text-white min-h-screen">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </p>
      {/* mnemonic */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      {/* end mnemonic */}
      <p>Enter Assets</p>
      {csvData == null ? (
        <div>
          <div>
            {/*<p className="text-center text-xs text-slate-300 py-1">or</p>*/}
            <div className="flex flex-col items-center">
              <textarea
                id="asset_id_list"
                placeholder="Asset IDs, one per line or comma separated"
                className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
                style={{ width: "10rem", height: "8rem" }}
                value={assetIds}
                onChange={(e) => {
                  setAssetIds(e.target.value);
                }}
              />
              <button
                id="confirm-input"
                className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-1 w-fit px-4 mx-auto mt-1 hover:scale-95 duration-700"
                onClick={() => {
                  // split with comma or newline
                  const splittedAssetIds: any = assetIds.split(/[\n,]/);
                  for (let i = 0; i < splittedAssetIds.length; i++) {
                    splittedAssetIds[i] = [splittedAssetIds[i].trim()];
                  }
                  splittedAssetIds.unshift(["asset_id"]);
                  setCsvData(splittedAssetIds);
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col justify-center items-center w-[16rem]">
          {isTransactionsFinished ? (
            <>
              <p className="pt-4 text-primary-orange animate-pulse text-sm">
                All transactions completed!
                <br />
              </p>
              <p className="pb-2 text-slate-400 text-xs">
                You can reload the page if you want to use again.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">
                {csvData.length - 1} assets found!
              </p>
              <p>3- Sign Your Transactions</p>
              {!txSendingInProgress ? (
                <button
                  id="approve-send"
                  className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                  onClick={handleFileData}
                >
                  Approve & Send
                </button>
              ) : (
                <div className="mx-auto flex flex-col">
                  <div
                    className="spinner-border animate-spin inline-block mx-auto w-8 h-8 border-4 rounded-full"
                    role="status"
                  ></div>
                  Please wait... Transactions are sending to the network.
                </div>
              )}
            </>
          )}
        </div>
      )}
      <button
        id="copy-link"
        className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-1 w-fit px-4 mx-auto mt-1 hover:scale-95 duration-700"
        onClick={() => {
          navigator.clipboard.writeText(
            window.location.href.split("?")[0] +
              "?ids=" +
              assetIds.replaceAll("\n", ",")
          );
          toast.success("Link copied!");
        }}
      >
        Copy link 🔗
      </button>
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
      <FaqSectionComponent
        faqData={[
          {
            question: "What is Opting into an Asset?",
            answer:
              "On Algorand, you can not receive an Asset unless your wallet gives permission to receive it. This prevents people from sending unwanted assets to your account.",
          },
          {
            question: "How much does it cost to Opt into an Asset?",
            answer:
              "There is a Minimum Balance Requirement of 0.1A per Asset and it is locked up until you opt out of an asset.",
          },
        ]}
      />
    </div>
  );
}
