import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";

import { Meta } from "../components/Meta";
import AssetSendDialog from "../components/wallet/AssetSendDialog";
import useWalletAssetStore from "../store/walletAssetStore";
import {
  AssetAccountDataResponse,
  AssetMetadataResponse,
  SingleAssetDataResponse,
} from "../types/wallet";
import {
  ipfsToUrl,
  getAssetData,
  shortenAddress,
  getWalletDirectionUrl,
  getOwnerAddressOfAsset,
  getNfdDomain,
  findAssetFormat,
  getAssetTraitData,
  copyAssetIds,
  createAssetOptInTransactions,
  createAssetOptoutTransactions,
  sendSignedTransaction,
  getAccountAssetData,
  formatWithCommas,
  getIndexerUrl,
} from "../utils/wallet";
import { walletSign } from "../utils";

export default function WalletAssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const { activeAddress, algodClient, activeNetwork, transactionSigner } = useWallet();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [assetData, setAssetData] = useState<SingleAssetDataResponse>();
  const [assetUrl, setAssetUrl] = useState<string>("/images/wallet/loading.gif");
  const [holderAddress, setHolderAddress] = useState<string>("");
  const [isAssetOneToOne, setIsAssetOneToOne] = useState<boolean>(false);
  const [assetFormat, setAssetFormat] = useState<string>("");
  const [assetMetadata, setAssetMetadata] = useState<AssetMetadataResponse>({
    traits: [],
    filters: [],
  });
  const [accountAssetData, setAccountAssetData] = useState<AssetAccountDataResponse>({
    amount: 0,
    isOptedIn: false,
  });
  const [open, setOpen] = useState(false);

  const indexerUrl = getIndexerUrl(activeNetwork);

  const handleDialog = () => {
    setOpen(!open);
  };

  useEffect(() => {
    if (assetId && !checkAssetIsValidLocal(assetId)) {
      setIsLoading(false);
      return;
    }

    function checkAssetIsValidLocal(id: string) {
      const num = Number(id);
      return !isNaN(num) && num > 0 && Number.isInteger(num);
    }

    async function getData() {
      try {
        const stateData = useWalletAssetStore
          .getState()
          .assets.find((a) => a.index === Number(assetId));
        let url;

        if (stateData) {
          setAssetData(stateData);
          setAssetFormat(findAssetFormat(stateData.params.url));
          url = await ipfsToUrl(stateData.params.url, stateData.params.reserve, true);
          setAssetUrl(url);
          const traitData = await getAssetTraitData(stateData);
          setAssetMetadata(traitData);
          setIsAssetOneToOne(
            stateData.params.total === 1 && stateData.params.decimals === 0
          );
          if (stateData.params.total === 1 && stateData.params.decimals === 0) {
            const assetHolder = await getOwnerAddressOfAsset(Number(assetId), indexerUrl);
            if (assetHolder) {
              const nfd = await getNfdDomain(assetHolder);
              setHolderAddress(nfd);
            }
          }
        } else {
          const response = await getAssetData(Number(assetId), indexerUrl);
          setAssetData(response);
          useWalletAssetStore.getState().addAsset(response);
          url = await ipfsToUrl(response.params.url, response.params.reserve, true);
          setAssetFormat(findAssetFormat(response.params.url));
          setAssetUrl(url);
          setIsAssetOneToOne(
            response.params.total === 1 && response.params.decimals === 0
          );
          const traitData = await getAssetTraitData(response);
          setAssetMetadata(traitData);
          if (response.params.total === 1 && response.params.decimals === 0) {
            const assetHolder = await getOwnerAddressOfAsset(Number(assetId), indexerUrl);
            if (assetHolder) {
              const nfd = await getNfdDomain(assetHolder);
              setHolderAddress(nfd);
            }
          }
        }

        if (activeAddress) {
          const accData = await getAccountAssetData(
            Number(assetId),
            activeAddress,
            indexerUrl
          );
          setAccountAssetData(accData);
        } else {
          setAccountAssetData({ amount: 0, isOptedIn: false });
        }
      } catch (error) {
        console.error(error);
      }
      setIsLoading(false);
    }

    if (!assetId) return;
    getData();
  }, [assetId, activeAddress, indexerUrl]);

  const handleOptIn = async () => {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet!");
        return;
      }
      if (!assetData) return;
      const txns = await createAssetOptInTransactions([assetData.index], activeAddress, algodClient);
      const signedTxns = await walletSign(txns, transactionSigner);
      await toast.promise(sendSignedTransaction(signedTxns, algodClient), {
        pending: "Opting-in...",
        success: "Opted-in successfully 🎉",
      });
      const accData = await getAccountAssetData(assetData.index, activeAddress, indexerUrl);
      setAccountAssetData(accData);
    } catch (error: any) {
      toast.error(
        error.message?.split("TransactionPool.Remember:")[1] ||
          error.message ||
          "Something went wrong 😕"
      );
    }
  };

  const handleOptOut = async () => {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet!");
        return;
      }
      if (!assetData) return;
      const txns = await createAssetOptoutTransactions(
        [assetData.index],
        activeAddress,
        algodClient,
        indexerUrl
      );
      const signedTxns = await walletSign(txns, transactionSigner);
      await toast.promise(sendSignedTransaction(signedTxns, algodClient), {
        pending: "Opting-out...",
        success: "Opted-out successfully 🎉",
      });
      const accData = await getAccountAssetData(assetData.index, activeAddress, indexerUrl);
      setAccountAssetData(accData);
    } catch (error: any) {
      toast.error(
        error.message?.split("TransactionPool.Remember:")[1] ||
          error.message ||
          "Something went wrong 😕"
      );
    }
  };

  if (isLoading) {
    return (
      <article className="mx-auto text-white flex flex-col items-center justify-center min-h-[60vh] w-full px-6 pt-12">
        <img
          src="/images/wallet/loading.gif"
          alt="loading"
          className="w-48 h-48 mx-auto"
        />
        <p className="text-xl font-bold mt-4 text-slate-400 animate-pulse uppercase tracking-widest italic">
          Loading Asset Details...
        </p>
      </article>
    );
  }

  if (!assetData) {
    return (
      <article className="mx-auto text-white flex flex-col items-center justify-center min-h-[60vh] w-full px-6 pt-12 text-center">
        <h2 className="text-4xl font-black italic text-slate-300 uppercase mb-4">
          Asset Not Found
        </h2>
        <p className="text-slate-500 max-w-sm mb-6">
          The asset ID specified does not exist or could not be loaded from the indexer.
        </p>
        <Link
          to="/wallet"
          className="text-lg text-primary-orange hover:text-orange-400 underline transition-colors font-bold"
        >
          Go to Wallet Dashboard
        </Link>
      </article>
    );
  }

  return (
    <article className="mx-auto text-white mb-20 flex flex-col items-center max-w-7xl w-full px-6 pt-12 min-h-screen">
      <Meta
        title={`${assetData.params.name} (${assetId})`}
        description={`View traits, holder address, clawback, freeze, and configuration parameters for Algorand asset ${assetData.params.name} (${assetId}).`}
      />

      <header className="mb-10 border-b border-slate-800 pb-8 w-full max-w-3xl">
        <Link
          to="/wallet"
          className="text-sm text-slate-400 hover:text-primary-orange flex items-center gap-1.5 transition-colors mb-3"
        >
          ← Back to Wallet
        </Link>
        <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-2 bg-gradient-to-r from-white via-slate-400 to-slate-600 bg-clip-text text-transparent italic uppercase">
          Asset Information
        </h1>
      </header>

      <div className="bg-zinc-900/50 border border-zinc-800 p-6 md:p-8 text-white rounded-3xl w-full max-w-3xl shadow-xl">
        <h2 className="text-3xl font-black italic text-amber-400 uppercase mb-6 text-center tracking-wide break-all">
          {assetData.params.name}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <div className="space-y-4">
            <div className="w-full aspect-square bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden flex items-center justify-center p-2 relative group">
              <img
                alt={assetData.params.name}
                src={assetUrl || "/images/wallet/404.webp"}
                className="max-w-full max-h-full object-contain rounded-xl transition-transform duration-300 group-hover:scale-[1.02]"
                loading="lazy"
                onError={() => setAssetUrl("/images/wallet/404.webp")}
              />
            </div>
            
            <div className="flex justify-center gap-2">
              <button
                className="flex-1 text-xs bg-zinc-800 border border-zinc-700 text-slate-300 py-2.5 px-4 rounded-xl hover:bg-zinc-700 hover:text-white transition-all font-bold uppercase tracking-wider"
                onClick={() => copyAssetIds([Number(assetId)])}
              >
                Copy ID
              </button>
              {!accountAssetData.isOptedIn ? (
                <button
                  className="flex-1 text-xs bg-zinc-800 border border-zinc-700 text-slate-300 py-2.5 px-4 rounded-xl hover:bg-zinc-700 hover:text-white transition-all font-bold uppercase tracking-wider"
                  onClick={handleOptIn}
                >
                  Opt-in
                </button>
              ) : (
                <button
                  className="flex-1 text-xs bg-red-950/40 border border-red-800/40 text-red-400 py-2.5 px-4 rounded-xl hover:bg-red-900/40 hover:text-red-300 transition-all font-bold uppercase tracking-wider"
                  onClick={handleOptOut}
                >
                  Opt-out
                </button>
              )}
              {accountAssetData.isOptedIn && (
                <button
                  className="flex-1 text-xs bg-primary-orange text-black font-extrabold py-2.5 px-4 rounded-xl hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/10 uppercase tracking-wider"
                  onClick={() => handleDialog()}
                >
                  Send
                </button>
              )}
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 p-5 rounded-2xl space-y-3">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-zinc-800 pb-2">
                ASA Specs
              </h3>
              <div className="text-xs space-y-2.5 text-slate-300">
                <p className="flex justify-between">
                  <span className="text-slate-500">ASA ID:</span>
                  <span className="font-mono font-bold text-slate-200">{assetId}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Unit Name:</span>
                  <span className="font-bold text-slate-200">{assetData.params["unit-name"] || "-"}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Creator:</span>
                  <a
                    href={getWalletDirectionUrl(assetData.params.creator)}
                    className="underline text-amber-400 hover:text-amber-300 transition-all font-mono"
                  >
                    {shortenAddress(assetData.params.creator)}
                  </a>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Supply:</span>
                  <span className="font-bold text-slate-200">
                    {formatWithCommas(
                      assetData.params.total / Math.pow(10, assetData.params.decimals)
                    )}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Decimals:</span>
                  <span className="font-bold text-slate-200">{assetData.params.decimals}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Clawback:</span>
                  {assetData.params.clawback === "" ||
                  assetData.params.clawback?.startsWith(
                    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                  ) ? (
                    <span className="text-slate-500 font-medium">No</span>
                  ) : (
                    <a
                      href={getWalletDirectionUrl(assetData.params.clawback)}
                      className="underline text-amber-400 hover:text-amber-300 transition-all font-mono"
                    >
                      {shortenAddress(assetData.params.clawback)}
                    </a>
                  )}
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Freeze:</span>
                  {assetData.params.freeze === "" ||
                  assetData.params.freeze?.startsWith(
                    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                  ) ? (
                    <span className="text-slate-500 font-medium">No</span>
                  ) : (
                    <a
                      href={getWalletDirectionUrl(assetData.params.freeze)}
                      className="underline text-amber-400 hover:text-amber-300 transition-all font-mono"
                    >
                      {shortenAddress(assetData.params.freeze)}
                    </a>
                  )}
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Default Frozen:</span>
                  <span className="font-bold text-slate-200">{assetData.params["default-frozen"] ? "Yes" : "No"}</span>
                </p>
                <p className="flex justify-between border-t border-zinc-800 pt-2 font-semibold">
                  <span>Standard: {assetFormat}</span>
                  <a
                    href={assetUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline text-primary-orange hover:text-orange-400 transition-all"
                  >
                    View on IPFS
                  </a>
                </p>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800 p-5 rounded-2xl space-y-5">
            {isAssetOneToOne && holderAddress && (
              <div className="flex flex-col gap-1 border-b border-zinc-800 pb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Current Owner
                </span>
                <a
                  href={
                    holderAddress.endsWith(".algo")
                      ? `https://app.nf.domains/name/${holderAddress}`
                      : getWalletDirectionUrl(holderAddress)
                  }
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-amber-400 font-bold underline hover:text-amber-300 transition-all break-all text-sm font-mono"
                >
                  {holderAddress}
                </a>
              </div>
            )}

            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-zinc-800 pb-2 mb-3">
                Traits
              </h3>
              {assetMetadata.traits.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {assetMetadata.traits.map((trait: any) => {
                    if (
                      trait.category &&
                      typeof trait.category === "string" &&
                      trait.value &&
                      typeof trait.value === "string"
                    ) {
                      return (
                        <div
                          key={trait.category}
                          className="bg-zinc-950/40 border border-zinc-800/80 p-2.5 rounded-xl flex flex-col justify-between"
                        >
                          <span className="font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                            {trait.category.replace(/_/g, " ")}
                          </span>
                          {trait.category === "external_url" ? (
                            <a
                              href={
                                trait.value.toLowerCase().startsWith("http")
                                  ? trait.value
                                  : `https://${trait.value}`
                              }
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-amber-400 break-all hover:text-amber-300 transition-all font-semibold underline mt-1"
                            >
                              {trait.value}
                            </a>
                          ) : (
                            <span className="text-slate-200 break-all font-semibold mt-1">
                              {trait.value.length > 80 ? (
                                <span title={trait.value}>
                                  {trait.value.substring(0, 80)}...
                                </span>
                              ) : (
                                trait.value
                              )}
                            </span>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <span className="text-slate-600 text-3xl mb-2">✦</span>
                  <p className="text-xs text-slate-500 uppercase tracking-widest">No Traits Found</p>
                </div>
              )}
            </div>

            {assetMetadata.filters.length > 0 && (
              <div className="pt-2">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-zinc-800 pb-2 mb-3">
                  Filters
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {assetMetadata.filters.map((trait: any) => {
                    if (
                      trait.category &&
                      typeof trait.category === "string" &&
                      trait.value &&
                      typeof trait.value === "string"
                    ) {
                      return (
                        <div
                          key={trait.category}
                          className="bg-zinc-950/40 border border-zinc-800/80 p-2.5 rounded-xl flex flex-col justify-between"
                        >
                          <span className="font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                            {trait.category.replace(/_/g, " ")}
                          </span>
                          <span className="text-slate-200 break-all font-semibold mt-1">
                            {trait.value}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AssetSendDialog
        balance={accountAssetData.amount}
        asset={assetData}
        onClose={handleDialog}
        open={open}
      />
    </article>
  );
}
