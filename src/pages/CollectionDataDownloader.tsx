import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { Arc69, getIndexerURL, getARC19AssetMetadataData } from "../utils";
import { IPFS_ENDPOINT } from "../constants";
import { useWallet } from "@txnlab/use-wallet-react";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

export function CollectionDataDownloader() {
  const [creatorWalletsInput, setCreatorWalletsInput] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [resolvingMetadata, setResolvingMetadata] = useState(false);
  const [assets, setAssets] = useState([] as any[]);
  const [progress, setProgress] = useState(0);

  // Statistics
  const [stats, setStats] = useState({
    total: 0,
    arc19: 0,
    arc69: 0,
    arc3: 0,
    asa: 0,
  });

  const { activeNetwork } = useWallet();

  const arc69 = new Arc69();

  // Parse wallets input
  const parseWallets = (input: string) => {
    return input
      .split(/[\s,]+/)
      .map((w) => w.trim())
      .filter((w) => w.length === 58);
  };

  // Fetch created assets for all wallets
  async function fetchAssets() {
    const wallets = parseWallets(creatorWalletsInput);
    if (wallets.length === 0) {
      toast.error("Please enter at least one valid Algorand wallet address (58 characters).");
      return;
    }

    setLoadingAssets(true);
    setAssets([]);
    setStats({ total: 0, arc19: 0, arc69: 0, arc3: 0, asa: 0 });
    const allAssets: any[] = [];
    const host = getIndexerURL(activeNetwork);

    try {
      for (const wallet of wallets) {
        toast.info(`Fetching assets created by ${wallet.substring(0, 6)}...`);
        let nextToken = "";
        let hasMore = true;

        while (hasMore) {
          const url = `${host}/v2/assets?creator=${wallet}&limit=1000${
            nextToken ? `&next=${nextToken}` : ""
          }`;
          const response = await axios.get(url);
          if (response.data && response.data.assets) {
            allAssets.push(...response.data.assets);
          }
          if (response.data && response.data["next-token"]) {
            nextToken = response.data["next-token"];
          } else {
            hasMore = false;
          }
        }
      }

      if (allAssets.length === 0) {
        toast.warning("No created assets found for the specified wallets.");
      } else {
        setAssets(allAssets);
        // Do preliminary standard categorization based on URL/Reserve
        let arc19Count = 0;
        let arc3Count = 0;
        let otherCount = 0;

        allAssets.forEach((asset) => {
          const url = asset.params.url || "";
          if (url.includes("template-ipfs:")) {
            arc19Count++;
          } else if (url.includes("#arc3")) {
            arc3Count++;
          } else {
            otherCount++;
          }
        });

        setStats({
          total: allAssets.length,
          arc19: arc19Count,
          arc3: arc3Count,
          arc69: 0, // will resolve during detailed extraction
          asa: otherCount,
        });

        toast.success(`Found ${allAssets.length} total created assets!`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Error fetching creator assets. Please try again.");
    } finally {
      setLoadingAssets(false);
    }
  }

  // Resolve metadata and detect standard
  async function resolveAsset(asset: any) {
    const assetId = asset.index;
    const params = asset.params;
    const url = params.url || "";
    const reserve = params.reserve || "";
    const name = params.name || "";
    const unitName = params["unit-name"] || "";

    let standard = "ASA";
    let metadata: any = {};

    try {
      if (url.includes("template-ipfs:")) {
        standard = "ARC-19";
        metadata = await getARC19AssetMetadataData(url, reserve);
      } else if (url.includes("#arc3")) {
        standard = "ARC-3";
        let fetchUrl = url;
        if (url.startsWith("ipfs://")) {
          fetchUrl = IPFS_ENDPOINT + url.replace("ipfs://", "").replace("#arc3", "");
        } else {
          fetchUrl = url.replace("#arc3", "");
        }
        const res = await axios.get(fetchUrl);
        metadata = res.data;
      } else {
        // Check for ARC-69
        try {
          metadata = await arc69.fetch(assetId, activeNetwork);
          if (metadata && (metadata.description || metadata.properties || metadata.attributes)) {
            standard = "ARC-69";
          }
        } catch (_e) {
          metadata = {};
        }
      }
    } catch (_e) {
      // Fallback
    }

    return {
      assetId,
      name,
      unitName,
      standard,
      url,
      reserve,
      metadata,
    };
  }

  // Flatten resolved details to CSV friendly structure
  function flattenAssetData(resolved: any) {
    const { assetId, name, unitName, standard, url, reserve, metadata } = resolved;
    const flat: any = {
      asset_id: assetId,
      name: name,
      unit_name: unitName,
      detected_standard: standard,
      url: url,
      reserve: reserve,
      description: metadata.description || "",
      image: metadata.image || "",
      external_url: metadata.external_url || "",
    };

    // Flatten properties/traits
    if (metadata.properties) {
      Object.entries(metadata.properties).forEach(([key, val]) => {
        if (key === "traits" && typeof val === "object" && val !== null) {
          Object.entries(val).forEach(([tKey, tVal]) => {
            flat[`trait_${tKey}`] = tVal;
          });
        } else if (key === "filters" && typeof val === "object" && val !== null) {
          Object.entries(val).forEach(([fKey, fVal]) => {
            flat[`filter_${fKey}`] = fVal;
          });
        } else if (key === "extras" && typeof val === "object" && val !== null) {
          Object.entries(val).forEach(([eKey, eVal]) => {
            flat[`extra_${eKey}`] = eVal;
          });
        } else {
          if (typeof val === "object" && val !== null) {
            Object.entries(val).forEach(([subKey, subVal]) => {
              flat[`trait_${key}_${subKey}`] = subVal;
            });
          } else {
            flat[`trait_${key}`] = val;
          }
        }
      });
    }

    // Flatten attributes (ARC-3/ARC-69 style array)
    if (Array.isArray(metadata.attributes)) {
      metadata.attributes.forEach((attr: any) => {
        if (attr && attr.trait_type) {
          flat[`trait_${attr.trait_type}`] = attr.value;
        }
      });
    }

    return flat;
  }

  function convertToCSV(objArray: any[]) {
    if (objArray.length === 0) return "";
    
    // Gather all encountered keys
    const allKeysSet = new Set<string>();
    objArray.forEach((item) => {
      Object.keys(item).forEach((key) => allKeysSet.add(key));
    });
    const headers = Array.from(allKeysSet);

    let str = headers.map((h) => `"${h}"`).join(",") + "\r\n";

    for (let i = 0; i < objArray.length; i++) {
      let line = "";
      for (let j = 0; j < headers.length; j++) {
        if (line !== "") line += ",";
        const val = objArray[i][headers[j]];
        line += val !== undefined ? `"${String(val).replace(/"/g, '""')}"` : '""';
      }
      str += line + (i !== objArray.length - 1 ? "\r\n" : "");
    }
    return str;
  }

  async function downloadCSV() {
    if (assets.length === 0) {
      toast.info("Please fetch collection data first.");
      return;
    }

    setResolvingMetadata(true);
    setProgress(0);

    const flattenedData: any[] = [];
    let count = 0;
    let resolvedArc19 = 0;
    let resolvedArc69 = 0;
    let resolvedArc3 = 0;
    let resolvedAsa = 0;

    for (const asset of assets) {
      const resolved = await resolveAsset(asset);
      const flat = flattenAssetData(resolved);
      flattenedData.push(flat);

      // Track standard stats dynamically
      if (resolved.standard === "ARC-19") resolvedArc19++;
      else if (resolved.standard === "ARC-69") resolvedArc69++;
      else if (resolved.standard === "ARC-3") resolvedArc3++;
      else resolvedAsa++;

      setStats((prev) => ({
        ...prev,
        arc19: resolvedArc19,
        arc69: resolvedArc69,
        arc3: resolvedArc3,
        asa: resolvedAsa,
      }));

      count++;
      setProgress(count);
      
      // Throttle slightly to prevent UI locking and gateway rate-limiting
      if (count % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    try {
      const csvContent = convertToCSV(flattenedData);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `collection-data-export.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      toast.success("CSV file exported successfully!");
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate CSV file.");
    } finally {
      setResolvingMetadata(false);
    }
  }

  const progressPercentage = assets.length > 0 ? Math.round((progress / assets.length) * 100) : 0;

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center min-h-screen px-4 max-w-5xl">
      <Meta
        title="Auto Detect Collection Data Downloader"
        description="Paste creator wallets to automatically detect asset standards (ARC-19, ARC-69, ARC-3, ASA) and download full consolidated CSV files."
      />
      <h1 className="text-3xl font-extrabold mt-8 bg-gradient-to-r from-primary-yellow to-secondary-orange bg-clip-text text-transparent">
        Auto Detect Collection Data Downloader
      </h1>
      <p className="text-slate-400 mt-2 text-sm max-w-xl">
        Enter one or more creator wallet addresses. The tool automatically audits all created assets, discovers their metadata standards, flattens the traits, and exports a unified CSV.
      </p>
      
      <div className="w-full mt-6">
        <ConnectButton inmain={true} />
      </div>

      <div className="w-full mt-8 bg-slate-900/60 border border-slate-700/50 backdrop-blur-md rounded-2xl p-6 shadow-2xl flex flex-col items-center">
        <label className="text-slate-300 text-sm font-semibold mb-2 self-start">
          Creator Wallets (Comma, space, or newline separated)
        </label>
        <textarea
          placeholder="Paste creator wallet addresses here..."
          className="bg-slate-950/80 text-white placeholder-slate-500 border border-slate-800 rounded-xl p-4 w-full h-32 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-sm leading-relaxed"
          value={creatorWalletsInput}
          onChange={(e) => setCreatorWalletsInput(e.target.value)}
          disabled={loadingAssets || resolvingMetadata}
        />

        <button
          onClick={fetchAssets}
          disabled={loadingAssets || resolvingMetadata}
          className="mt-4 px-8 py-3 bg-gradient-to-r from-primary-yellow to-secondary-orange hover:from-primary-yellow/90 hover:to-secondary-orange/90 text-black font-bold rounded-xl transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:scale-95 duration-200"
        >
          {loadingAssets ? "Scanning Creator Wallets..." : "Scan Creator Wallets"}
        </button>
      </div>

      {stats.total > 0 && (
        <div className="w-full mt-8 grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 backdrop-blur-sm">
            <p className="text-xs uppercase text-slate-500 font-bold">Total Assets</p>
            <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 backdrop-blur-sm">
            <p className="text-xs uppercase text-slate-500 font-bold">ARC-19 Detected</p>
            <p className="text-2xl font-bold text-primary-yellow mt-1">{stats.arc19}</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 backdrop-blur-sm">
            <p className="text-xs uppercase text-slate-500 font-bold">ARC-69 Detected</p>
            <p className="text-2xl font-bold text-cyan-400 mt-1">{stats.arc69}</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 backdrop-blur-sm">
            <p className="text-xs uppercase text-slate-500 font-bold">ARC-3 Detected</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.arc3}</p>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 backdrop-blur-sm">
            <p className="text-xs uppercase text-slate-500 font-bold">ASA / Tokens</p>
            <p className="text-2xl font-bold text-slate-300 mt-1">{stats.asa}</p>
          </div>
        </div>
      )}

      {assets.length > 0 && (
        <div className="w-full mt-8 bg-slate-900/60 border border-slate-700/50 backdrop-blur-md rounded-2xl p-6 shadow-2xl flex flex-col items-center">
          {resolvingMetadata ? (
            <div className="w-full">
              <p className="text-sm font-semibold text-slate-300 mb-2">
                Resolving and downloading metadata: {progress} / {assets.length} ({progressPercentage}%)
              </p>
              <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-primary-yellow to-secondary-orange h-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={downloadCSV}
              className="px-10 py-4 bg-emerald-500 hover:bg-emerald-600 text-black font-extrabold text-lg rounded-xl transition shadow-lg hover:scale-95 duration-200"
            >
              Export and Download Consolidated CSV
            </button>
          )}
        </div>
      )}

      <p className="text-slate-500 text-xs mt-6 max-w-md">
        ⚠️ Leaving or reloading this page will discard scanned data. Auto-detection queries IPFS nodes and on-chain notes which may take a few seconds per asset.
      </p>

      {/* Practitioner Section */}
      <section className="mt-20 pt-12 border-t border-slate-850 w-full text-left">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Multi-Standard Detection</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Algorand has evolved multiple standards for NFT metadata representation. Rather than running separate extraction passes for ARC-19, ARC-69, and ARC-3 assets, this tool dynamically detects standard markers in real-time. This simplifies cataloging, auditing, and backup operations for legacy creators.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Audit and Preservation</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Preserving local data tables of on-chain collections is a recommended practice. The CSV flattening engine parses arbitrary traits, rarity metrics, and media links into a single rectangular table structure, ready for import into spreadsheets, analysis software, or secondary marketplaces.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
