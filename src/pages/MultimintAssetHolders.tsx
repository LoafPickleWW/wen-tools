import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { TOOLS } from "../constants";
import {
  getNfDomainsInBulk,
  getRandListingAsset,
  getIndexerURL,
  getParticipationStatusOfWallet,
} from "../utils";
import { useWallet } from "@txnlab/use-wallet-react";

export function MultimintAssetHolders() {
  const [assetId, setAssetId] = useState("");
  const [assetHolders, setAssetHolders] = useState([] as any[]);
  const [assetOwnersLoading, setAssetOwnersLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [checkOptin, setCheckOptin] = useState(false);
  const [checkNfdOnly, setCheckNfdOnly] = useState(false);
  const [checkVerifiedOnly, setCheckVerifiedOnly] = useState(false);
  const [checkRunningNode, setCheckRunningNode] = useState(false);
  const [checkRandSupport, setCheckRandSupport] = useState(false);
  const { activeNetwork, algodClient } = useWallet();
  const [headers, setHeaders] = useState([] as string[]);

  async function getAssetOwners(asset_id: number) {
    const isOptin = checkOptin;
    const indexerURL = getIndexerURL(activeNetwork);
    let threshold = 1000;
    const assetData: any = {
      asset_id: asset_id,
    };
    try {
      const assetDataResponse = await axios.get(
        `${indexerURL}/v2/assets/${asset_id}`
      );
      assetData.asset_name = assetDataResponse.data.asset.params.name;
      assetData.decimals = assetDataResponse.data.asset.params.decimals;
    } catch (err) {
      console.error(err);
      toast.error(`${asset_id} is not a valid asset id!`);
      throw Error(`${asset_id} is not a valid asset id!`);
    }
    try {
      const response = await axios.get(
        `${indexerURL}/v2/assets/${asset_id}/balances` +
          (!isOptin ? "?currency-greater-than=0" : "")
      );
      while (
        response.data["next-token"] &&
        response.data.balances.length === threshold
      ) {
        const nextResponse = await axios.get(
          `${indexerURL}/v2/assets/${asset_id}/balances` +
            (!isOptin
              ? `?currency-greater-than=0&next=${response.data["next-token"]}`
              : `?next=${response.data["next-token"]}`)
        );
        response.data.balances = response.data.balances.concat(
          nextResponse.data.balances
        );
        response.data["next-token"] = nextResponse.data["next-token"];
        threshold += 1000;
      }
      assetData.holders = response.data.balances.map((holder: any) => {
        return {
          address: holder.address,
          amount: (holder.amount / Math.pow(10, assetData.decimals)).toFixed(
            assetData.decimals
          ),
        };
      });
      return assetData;
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong!");
    }
  }

  async function getAssetHolders() {
    setAssetHolders([]);
    let assetIDs = assetId
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    assetIDs = [...new Set(assetIDs)];
    try {
      if (assetId) {
        const assetBalances = [];
        setAssetOwnersLoading(true);
        for (const asset_id of assetIDs) {
          try {
            const asset_owners = await getAssetOwners(Number(asset_id));
            assetBalances.push(asset_owners);
          } catch (err: any) {
            console.error(err);
          }
        }

        setAssetHolders(assetBalances);
        setAssetOwnersLoading(false);

        setLoading(true);
        setLoadingMessage("Fetching NFDomains...");
        let data: any[] = [];
        for (let i = 0; i < assetBalances.length; i++) {
          const asset = assetBalances[i];
          const assetHolderWallets = asset.holders.map(
            (holder: any) => holder.address
          );
          const nfdDomains = await getNfDomainsInBulk(assetHolderWallets, 20);
          for (let j = 0; j < asset.holders.length; j++) {
            const holder = asset.holders[j];
            data.push({
              wallet: holder.address,
              nfdomain: nfdDomains[holder.address] || "",
              asset_id: asset.asset_id,
              amount: holder.amount,
            });
          }
        }
        let headers = ["wallet", "nfdomain", "asset_id", "amount"];
        if (checkNfdOnly) {
          data = data.filter((item) => item.nfdomain !== "");
        }
        if (checkVerifiedOnly) {
          setLoadingMessage("Fetching NFDs' socials...");
          toast.info("Fetching NFDs' socials...");
          data = data.filter((item) => item.nfdomain !== "");
          const nfdDomains = data.map((item) => item.nfdomain);
          const nfdSocials = await getNFDsSocials(nfdDomains);
          data = data.map((item) => {
            return {
              ...item,
              twitter: nfdSocials[item.nfdomain].twitter,
              discord: nfdSocials[item.nfdomain].discord,
            };
          });
          data = data.filter(
            (item) => item.twitter !== "" || item.discord !== ""
          );
          headers = [...headers, "twitter", "discord"];
        }
        if (checkRandSupport) {
          setLoadingMessage("Fetching RandGallery listings...");
          toast.info("Fetching RandGallery listings...");
          let assetIds = assetBalances.map((item) => item.asset_id);
          assetIds = [...new Set(assetIds)];
          for (let i = 0; i < assetIds.length; i++) {
            const assetId = assetIds[i];
            const randListing = await getRandListingAsset(assetId);
            if (randListing.length > 0) {
              for (let j = 0; j < randListing.length; j++) {
                const sellerAddress = randListing[j].sellerAddress;
                const escrowAddress = randListing[j].escrowAddress;
                const index = data.findIndex(
                  (item) =>
                    item.wallet === escrowAddress && item.asset_id === assetId
                );
                if (index !== -1) {
                  data[index].listed_on_rand = "YES";
                  data[index].wallet = sellerAddress;
                }
              }
            }
          }
          headers = [...headers, "listed_on_rand"];
        }
        if (checkRunningNode) {
          setLoadingMessage("Checking participation status of wallets...");
          toast.info("Checking participation status of wallets");
          const uniqueWallets = Array.from(new Set(data.map((a) => a.wallet)));
          const participatedWallets: any[] = [];
          for (let i = 0; i < uniqueWallets.length; i++) {
            const participationStatus = await getParticipationStatusOfWallet(
              uniqueWallets[i],
              algodClient
            );
            if (participationStatus) {
              participatedWallets.push(uniqueWallets[i]);
            }
            if (i % 50 === 0 && i !== 0) {
              toast.info(`Checked ${i}/${uniqueWallets.length} wallets.`);
            }
          }
          data = data.filter((item) =>
            participatedWallets.includes(item.wallet)
          );
        }

        const assetBalancesWithFiltered = assetBalances.map((asset) => {
          console.log(asset);
          const assetFilteredHolders = data.filter(
            (item) => item.asset_id === asset.asset_id
          );
          return { ...asset, assetFilteredHolders };
        });
        console.log(assetBalancesWithFiltered);
        setAssetHolders(assetBalancesWithFiltered);
        setHeaders(headers);
        setLoading(false);
        setLoadingMessage("");
      } else {
        toast.info("Please enter at least one asset id!");
      }
    } catch (err: any) {
      console.error(err);
    }
  }

  function convertToCSV(headers: string[], objArray: any[]) {
    const array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
    let str = "";
    let row = "";

    for (const index in headers) {
      row += headers[index] + ",";
    }
    str += row + "\r";
    for (let i = 0; i < array.length; i++) {
      let line = "";
      for (const index in headers) {
        if (line !== "") line += ",";
        line += array[i][headers[index]] || "";
      }
      str += line + "\r";
    }

    return str;
  }

  function exportCSVFile(headers: string[], items: any[], fileTitle: string) {
    const csv = convertToCSV(headers, items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", fileTitle);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  async function getNFDsSocials(nfdomains: any[]) {
    const nfdSocials: any = {};
    nfdomains = [...new Set(nfdomains)];
    for (let i = 0; i < nfdomains.length; i++) {
      const nfdomain = nfdomains[i].toLowerCase();
      const url = `https://api.nf.domains/nfd/${nfdomain}?view=full&poll=false&nocache=false`;
      try {
        const response = await axios.get(url);
        const twitter = response.data.properties.verified.twitter || "";
        const discord = response.data.properties.verified.discord || "";
        nfdSocials[nfdomain] = { twitter, discord };
      } catch (err) {
        console.error(err);
        nfdSocials[nfdomain] = { twitter: "", discord: "" };
      }
      if (i % 10 === 0) {
        toast.info(`Fetching NFDomains' socials... ${i}/${nfdomains.length}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return nfdSocials;
  }

  async function downloadAssetHoldersDataAsCSV() {
    if (assetHolders.length > 0) {
      const allFilteredData = [];
      for (let i = 0; i < assetHolders.length; i++) {
        const asset = assetHolders[i];
        const assetFilteredHolders = asset.assetFilteredHolders;
        allFilteredData.push(...assetFilteredHolders);
      }
      exportCSVFile(headers, allFilteredData, "asset_holders.csv");
      toast.success("Downloaded successfully!");
      toast.info("You can support by donating :)");
    } else {
      toast.info("Please get collection data first!");
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center min-h-screen">
      <h1 className="text-2xl font-bold mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </h1>
      <input
        type="text"
        id="asset_id_list"
        placeholder="Enter asset ids"
        className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-64 text-sm mx-auto placeholder:text-center placeholder:text-sm"
        value={assetId}
        onChange={(e) => setAssetId(e.target.value)}
      />
      <p className="text-center text-xs mb-2 text-slate-300">
        Separate multiple asset ids with commas.
      </p>
      <div className="flex flex-col items-start text-sm py-2 bg-black/20 px-4 rounded-xl">
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            id="check_optin"
            className="mr-2"
            checked={checkOptin}
            onChange={(e) => setCheckOptin(e.target.checked)}
          />
          <label htmlFor="check_optin" className="text-slate-300">
            Check Optin (with 0 balances too)
          </label>
        </div>
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            id="check_running_node"
            className="mr-2"
            checked={checkRunningNode}
            onChange={(e) => setCheckRunningNode(e.target.checked)}
          />
          <label htmlFor="check_running_node" className="text-slate-300">
            Node runners only
          </label>
        </div>
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            id="nfd_only"
            className="mr-2"
            checked={checkNfdOnly}
            onChange={(e) => setCheckNfdOnly(e.target.checked)}
          />
          <label htmlFor="nfd_only" className="text-slate-300">
            NFD wallets only
          </label>
        </div>
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            id="nfd_verified_only"
            className="mr-2"
            checked={checkVerifiedOnly}
            onChange={(e) => setCheckVerifiedOnly(e.target.checked)}
          />
          <label htmlFor="nfd_verified_only" className="text-slate-300">
            Verified with NFD's Twitter or Discord only
          </label>
        </div>
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            id="check_rand"
            className="mr-2"
            checked={checkRandSupport}
            onChange={(e) => setCheckRandSupport(e.target.checked)}
          />
          <label htmlFor="check_rand" className="text-slate-300">
            RandGallery listing support
          </label>
        </div>
      </div>
      <button
        className={`mb-2 bg-secondary-orange/80 hover:bg-secondary-orange text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700 ${
          assetOwnersLoading || loading ? "opacity-50 cursor-not-allowed" : ""
        }`}
        onClick={getAssetHolders}
        disabled={assetOwnersLoading || loading}
      >
        Get Asset Holders
      </button>
      {assetOwnersLoading && (
        <div className="mx-auto flex flex-col">
          <div
            className="spinner-border animate-spin inline-block mx-auto mt-4 mb-2 w-8 h-8 border-4 rounded-full"
            role="status"
          ></div>
          Fetching asset holders from blockchain...
        </div>
      )}
      {assetHolders.length > 0 && (
        <>
          {loading ? (
            <div className="mx-auto flex flex-col">
              <div
                className="spinner-border animate-spin inline-block mx-auto mt-4 w-8 h-8 border-4 rounded-full"
                role="status"
              ></div>
              {loadingMessage}
            </div>
          ) : (
            <>
              {assetHolders.map((assetHolder, index) => (
                <div key={index} className="w-full">
                  <p className="text-center text-sm text-slate-300">
                    <span className="font-semibold">
                      {assetHolder.asset_name} ({assetHolder.asset_id})
                    </span>{" "}
                    asset has{" "}
                    <span className="animate-pulse font-semibold">
                      {assetHolder.assetFilteredHolders.length}
                    </span>{" "}
                    Holders.
                  </p>
                </div>
              ))}
              <button
                onClick={downloadAssetHoldersDataAsCSV}
                className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-2 hover:scale-95 duration-700"
              >
                Download Asset {checkOptin ? "Opted-in " : "Holders"}
              </button>
            </>
          )}
        </>
      )}
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
    </div>
  );
}
