import { ToolHero, TermSpinner } from "../components/cypher/ToolKit";
import { showDonationToast } from "../utils";
import { NetworkId, useWallet } from "@txnlab/use-wallet-react";
import algosdk, { Transaction } from "algosdk";
import axios from "axios";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
  generateARC59ClaimTxns,
  getAssetsInAssetInbox,
} from "../arc59-helpers";
import { TOOLS } from "../constants";
import { getIndexerURL, getNfdDomain } from "../utils";
import { EnhancedTable } from "../components/DataGrid";
import {
  ALGOXNFT_ADMIN,
  algoxCloseJob,
  appCancelJob,
  buildAlgoxClosePlan,
  buildAppCancelGroup,
  countClaimTxns,
  findAlgoxListings,
  findAppListings,
  nodeErrorMessage,
  signClaimJobs,
  simulateAlgoxClose,
  simulateAppCancel,
  submitClaimJobs,
  type AlgoxListing,
  type AppListing,
  type ClaimJob,
} from "../utils/algoxnft";
import InfinityModeComponent from "../components/InfinityModeComponent";
import { HeadCell } from "../types";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

interface Asset {
  assetId: number;
  amount: number;
  name: string;
  type: string;
  orgAmount:number;
  decimals:number;
  id: number;
}

const fetchNFDVaultAssets = async (nfd: string, activeNetwork: NetworkId) => {
  if (!nfd) return [];

  const { data } = await axios.get(
    `https://api.nf.domains/nfd/${nfd}?view=full`
  );
  if (!data.nfdAccount) return [];

  const vaultAddress = data.nfdAccount;
  try {
    const version = data.properties.internal.ver;
    const [major, minor] = version.split(".").map(Number);
    if (major < 2 || (major === 2 && minor < 6)) {
      toast.error(
        "To Claim NFD vault Assets Please Upgrade Your NFD version to greater than 2.6"
      );
      return [];
    }
  } catch (error: any) {
    toast.error(`Error fetching NFD vault assets: ${error.message}`);
    console.error("Error fetching NFD vault assets:", error);
    return [];
  }

  const indexerUrl = getIndexerURL(activeNetwork);
  let assets: any[] = [];
  let nextToken = null;

  do {
    const url: string = `${indexerUrl}/v2/accounts/${vaultAddress}/assets${
      nextToken ? `?next=${nextToken}` : ""
    }`;
    const { data: response } = await axios.get(url);
    assets = [...assets, ...response.assets];
    nextToken = response["next-token"];
  } while (nextToken);

  return assets
    .filter(
      (asset) => !asset["is-frozen"] && !asset.deleted && asset.amount > 0
    )
    .map((asset) => ({
      assetId: asset["asset-id"],
      amount: asset.amount,
      type: "vault",
    }));
};

const getAssetDetails = async (asset: any, indexerUrl: string) => {
  const { data } = await axios.get(`${indexerUrl}/v2/assets/${asset.assetId}`);
  return {
    id: asset.id,
    assetId: asset.assetId,
    amount: asset.amount / 10 ** data.asset.params.decimals,
    orgAmount:asset.amount,
    decimals:data.asset.params.decimals,
    name: data.asset.params.name,
    type: asset.type,
  };
};

const ALGOX_TYPE = "AlgoxNFT listing";

/** Short, human reason for a failed claim submission. */
const friendlyClaimError = (error?: string): string => {
  if (!error) return "unknown error";
  const auth = error.match(/should have been authorized by (\w{58})/);
  if (auth) return `this account is rekeyed; sign with the wallet that holds ${auth[1].slice(0, 6)}…${auth[1].slice(-4)}`;
  if (/txn dead|round outside/i.test(error)) return "the signing request expired, please try again";
  if (/overspend|below min/i.test(error)) return "not enough ALGO for fees and minimum balance";
  if (/already in ledger/i.test(error)) return "already claimed";
  if (/incomplete group/i.test(error)) return "transaction grouping error; please retry";
  return error.length > 160 ? error.slice(0, 160) + "…" : error;
};
const ALGOX_OPTIN_TYPE = "AlgoxNFT listing · opt-in";

const INITIAL_STEP = 0;
const COMPLETED = 1;

export const BlukClaimTool = () => {
  const { activeAddress, activeNetwork, algodClient, signTransactions } = useWallet();
  const [mnemonic, setMnemonic] = useState("");
  const [isLoadingAssets, setIsLoadingAssets] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nfd, setNFD] = useState("");
  const [processStep, setProcessStep] = useState(INITIAL_STEP);
  // AlgoxNFT escrow details for each table row id
  const [algoxListings, setAlgoxListings] = useState<Map<number, AlgoxListing>>(new Map());
  // Newer AlgoxNFT listings (Asalytic marketplace listing apps), by table row id
  const [appListings, setAppListings] = useState<Map<number, AppListing>>(new Map());
  // A source that could not be scanned (network/rate limit), so "nothing found" isn't claimed
  const [scanError, setScanError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Ignore results from a scan that was superseded (account switch, reconnect)
    let stale = false;
    const loadAssets = async () => {
      if (!activeAddress) {
        setIsLoadingAssets(false);
        return;
      }
      setIsLoadingAssets(true);
      setScanError(false);
      setAssets([]);
      let failed = false;

      try {
        const indexerUrl = getIndexerURL(activeNetwork);
        const [inboxAssets, userNfd, listings, marketListings] = await Promise.all([
          getAssetsInAssetInbox(activeAddress, algodClient, activeNetwork),
          getNfdDomain(activeAddress),
          // Isolated: a failure here must not hide inbox/vault assets
          findAlgoxListings(activeAddress, algodClient, indexerUrl).catch((e) => {
            console.error("AlgoxNFT listing scan failed:", e);
            failed = true;
            return [] as AlgoxListing[];
          }),
          findAppListings(activeAddress, algodClient, indexerUrl).catch((e) => {
            console.error("AlgoxNFT marketplace listing scan failed:", e);
            failed = true;
            return [] as AppListing[];
          }),
        ]);
        if (stale) return;

        setNFD(userNfd);
        const vaultAssets = await fetchNFDVaultAssets(userNfd, activeNetwork).catch((e) => {
          console.error("NFD vault scan failed:", e);
          failed = true;
          return [] as Awaited<ReturnType<typeof fetchNFDVaultAssets>>;
        });

        const algoxRows = [...listings, ...marketListings].map((l) => ({
          assetId: l.assetId,
          amount: 1,
          type: l.needsOptIn ? ALGOX_OPTIN_TYPE : ALGOX_TYPE,
        }));
        const combined = [...inboxAssets, ...vaultAssets, ...algoxRows];
        const allAssets = await Promise.all(
          combined.map((asset, index) => getAssetDetails({ ...asset, id: index }, indexerUrl))
        );
        if (stale) return;

        const byRow = new Map<number, AlgoxListing>();
        const firstAlgoxRow = inboxAssets.length + vaultAssets.length;
        listings.forEach((l, i) => byRow.set(firstAlgoxRow + i, l));
        setAlgoxListings(byRow);
        const byRowApp = new Map<number, AppListing>();
        marketListings.forEach((l, i) => byRowApp.set(firstAlgoxRow + listings.length + i, l));
        setAppListings(byRowApp);
        setAssets(allAssets);
        setScanError(failed);
      } catch (error) {
        console.error("Error loading assets:", error);
        if (!stale) setScanError(true);
      } finally {
        if (!stale) setIsLoadingAssets(false);
      }
    };

    loadAssets();
    return () => {
      stale = true;
    };
  }, [activeAddress, activeNetwork, algodClient, reloadKey]);

  /** Verifies (simulation) the selected marketplace listings and builds their cancel jobs. */
  const prepareAppJobs = async (rows: Asset[], params: algosdk.SuggestedParams): Promise<ClaimJob[]> => {
    if (!activeAddress || !rows.length) return [];
    const groups = rows
      .map((r) => appListings.get(r.id))
      .filter((l): l is AppListing => !!l)
      .map((listing) => ({ listing, txns: buildAppCancelGroup(listing, activeAddress, params) }));

    const sims = await Promise.all(groups.map((g) => simulateAppCancel(algodClient, g.txns)));
    const rejected = sims.filter((r) => r.status === "rejected").length;
    const accountIssue = sims.find((r) => r.status === "account");
    if (rejected) toast.warn(`${rejected} AlgoxNFT listing${rejected > 1 ? "s" : ""} couldn't be cancelled and ${rejected > 1 ? "were" : "was"} skipped`);
    if (accountIssue && accountIssue.status === "account") toast.error(accountIssue.message);
    return groups.filter((_, i) => sims[i].status === "ready").map((g) => appCancelJob(g.listing, g.txns));
  };

  /** Verifies (simulation) the selected escrow listings and builds their close jobs. */
  const prepareAlgoxJobs = async (rows: Asset[], params: algosdk.SuggestedParams): Promise<ClaimJob[]> => {
    if (!activeAddress || !rows.length) return [];
    const plans = rows
      .map((r) => algoxListings.get(r.id))
      .filter((l): l is AlgoxListing => !!l)
      .map((l) => buildAlgoxClosePlan(l, activeAddress, params));

    const sims = await Promise.all(plans.map((p) => simulateAlgoxClose(algodClient, p)));
    const rejected = sims.filter((r) => r.status === "rejected").length;
    const accountIssue = sims.find((r) => r.status === "account");
    if (rejected) {
      toast.warn(`${rejected} AlgoxNFT listing${rejected > 1 ? "s" : ""} can't be closed this way and ${rejected > 1 ? "were" : "was"} skipped`);
    }
    if (accountIssue && accountIssue.status === "account") toast.error(accountIssue.message);
    return plans.filter((_, i) => sims[i].status === "ready").map(algoxCloseJob);
  };

  const prepareVaultJob = async (asset: Asset): Promise<ClaimJob> => {
    const { data } = await axios.post(
      `https://api.nf.domains/nfd/vault/sendFrom/${nfd}`,
      {
        amount: asset.orgAmount,
        amountStr: asset.orgAmount.toString(),
        assets: [asset.assetId],
        receiver: activeAddress,
        receiverType: "account",
        sender: activeAddress,
        receiverCanSign: true,
        note:
          "via wen.tools - free tools for creators and collectors | " +
          Math.random().toString(36).substring(2),
      }
    );
    const txns: Transaction[] = JSON.parse(data).map((txn: string[]) =>
      algosdk.decodeUnsignedTransaction(Buffer.from(txn[1], "base64"))
    );
    return { assetId: asset.assetId, steps: [{ txns, userSigns: [...txns.keys()] }] };
  };

  const prepareInboxJob = async (asset: Asset): Promise<ClaimJob> => {
    const txns = await generateARC59ClaimTxns(BigInt(asset.assetId), activeAddress!, algodClient, activeNetwork);
    return { assetId: asset.assetId, steps: [{ txns, userSigns: [...txns.keys()] }] };
  };

  /** A job that can't be built is reported and skipped, never blocking the rest. */
  const tryPrepare = async (asset: Asset, build: (a: Asset) => Promise<ClaimJob>) => {
    try {
      return await build(asset);
    } catch (e: any) {
      console.error(`Could not prepare claim for ${asset.assetId}:`, e);
      toast.error(`Could not prepare ${asset.name || asset.assetId}: ${friendlyClaimError(nodeErrorMessage(e))}`, { autoClose: 8000 });
      return null;
    }
  };

  /**
   * Builds a transaction group for every selected asset, has the user sign
   * them all in one wallet prompt, then submits each group.
   */
  const handleClaimAssets = async (
    selected: Asset[],
    setDisabled: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (!activeAddress) {
      toast.error("Please connect your wallet");
      return;
    }
    if (mnemonic && mnemonic.trim().split(/\s+/).length !== 25) {
      toast.error("Invalid Mnemonic");
      return;
    }

    setDisabled(true);
    try {
      toast.info("Preparing claims…", { autoClose: 1500 });
      const params = await algodClient.getTransactionParams().do();
      const [appJobs, algoxJobs, vaultJobs, inboxJobs] = await Promise.all([
        prepareAppJobs(selected.filter((r) => appListings.has(r.id)), params),
        prepareAlgoxJobs(selected.filter((r) => algoxListings.has(r.id)), params),
        Promise.all(selected.filter((s) => s.type === "vault").map((a) => tryPrepare(a, prepareVaultJob))),
        Promise.all(selected.filter((s) => s.type === "inbox").map((a) => tryPrepare(a, prepareInboxJob))),
      ]);
      const jobs = [...appJobs, ...algoxJobs, ...vaultJobs, ...inboxJobs].filter((j): j is ClaimJob => !!j);
      if (!jobs.length) {
        toast.error("None of the selected assets can be claimed right now");
        return;
      }

      if (countClaimTxns(jobs) > 200 && !mnemonic) {
        toast.error("Please enter your mnemonic using Infinity Mode");
        return;
      }

      if (!mnemonic) toast.info(`Approve ${jobs.length} claim${jobs.length > 1 ? "s" : ""} in your wallet (one signature)…`);
      const signed = await signClaimJobs(
        jobs,
        mnemonic
          ? { sk: algosdk.mnemonicToSecretKey(mnemonic.trim()).sk }
          : { signer: (groups, indexes) => signTransactions(groups, indexes) }
      );
      toast.success("Signed! Submitting…", { autoClose: 1500 });

      const results = await submitClaimJobs(algodClient, signed, (done, total, assetId, ok, error) => {
        if (ok) toast.success(`Claimed ${assetId} (${done}/${total})`, { autoClose: 1200 });
        else toast.error(`Could not claim ${assetId} (${done}/${total}): ${friendlyClaimError(error)}`, { autoClose: 8000 });
      });

      const okCount = results.filter((r) => r.txId).length;
      if (!okCount) return;
      showDonationToast();
      if (okCount === selected.length) {
        toast.success(`All ${okCount} assets claimed`);
        setProcessStep(COMPLETED);
      } else {
        toast.success(`${okCount} of ${selected.length} assets claimed`);
        // Rescan so the table shows only what's still waiting
        setReloadKey((k) => k + 1);
      }
    } catch (error: any) {
      console.error("Claim error:", error);
      toast.error(`Failed to claim assets: ${friendlyClaimError(nodeErrorMessage(error))}`);
    } finally {
      setDisabled(false);
    }
  };


  const tableConfig = {
    headCells: [
      { id: "assetId", numeric: true, disablePadding: true, label: "Asset ID" },
      { id: "name", numeric: false, disablePadding: true, label: "Asset Name" },
      { id: "amount", numeric: true, disablePadding: true, label: "Amount" },
      {
        id: "type",
        numeric: false,
        disablePadding: true,
        label: "Asset Is In",
      },
    ] as HeadCell[],
    actions: [
      {
        tooltipTitle: "Claim",
        icon: <span>Claim</span>,
        onClick: handleClaimAssets,
      },
    ],
  };

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center w-full max-w-[40rem] gap-y-3 px-4 min-h-screen">
      <Meta 
        title="Bulk Claim Tool" 
        description="Consolidate and claim your Algorand assets from ARC-59 Asset Inboxes and NFD Vaults in a single session. Professional asset recovery for active collectors."
      />
      <ToolHero
        tag="bulk claim"
        title={TOOLS.find((tool) => tool.path === window.location.pathname)?.label || "Bulk Claim"}
        description="Claim your Algorand assets from ARC-59 asset inboxes, NFD vaults and old AlgoxNFT listings in a single session."
        meta={["ARC-59 inbox", "NFD vaults", "AlgoxNFT listings", "auto opt-in"]}
      />
      <ConnectButton inmain={true} />



      {!activeAddress && (
        <p className="font-mono text-xs text-slate-500">// connect a wallet to scan your inbox, vaults and old AlgoxNFT listings</p>
      )}

      {activeAddress &&
        !isLoadingAssets &&
        assets.length > 0 &&
        processStep === INITIAL_STEP && (
          <EnhancedTable
            actions={tableConfig.actions}
            data={assets}
            headCells={tableConfig.headCells}
            title="Claimable assets"
          />
        )}

      {activeAddress &&
        !isLoadingAssets &&
        assets.length > 0 &&
        processStep === COMPLETED && (
          <div className="flex flex-col justify-center items-center w-[16rem]">
            <p className="pt-4 text-green-500 text-sm">
              Assets Claimed successfully!
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
          </div>
        )}

      {activeAddress && !isLoadingAssets && scanError && (
        <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-left">
          <p className="font-mono text-xs text-amber-200">
            // some sources didn&apos;t respond (public node busy), so this list may be incomplete
          </p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="wt-btn wt-btn-ghost h-8 shrink-0 px-3 text-xs">
            Rescan
          </button>
        </div>
      )}

      {activeAddress && !isLoadingAssets && !assets.length && !scanError && (
        <p className="font-mono text-sm text-slate-400">// nothing waiting in your inbox, vaults or AlgoxNFT listings</p>
      )}

      {activeAddress && isLoadingAssets && (
        <div className="mx-auto mt-4 flex flex-col items-center gap-3">
          <TermSpinner />
          <p className="font-mono text-xs text-slate-400">scanning inbox, vaults &amp; AlgoxNFT listings…</p>
        </div>
      )}

      {/* Practitioner Section: Asset Recovery (ARC-59) */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      <section className="mt-16 pt-12 border-t border-slate-800 w-full text-left px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Asset Recovery (ARC-59)</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              ARC-59 introduces the concept of an "Asset Inbox", a decentralized mechanism for receiving assets without prior opt-ins. This tool scans your inbox and allows you to claim multiple assets in a single, coordinated operation. It is the gold standard for frictionless airdrops and community rewards, ensuring that your participation is rewarded without administrative overhead.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">The NFD Vault Ecosystem</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Non-Fungible Domains (NFDs) provide sophisticated vault infrastructure for asset management. Assets sent to an NFD vault are secure and easily accessible via this interface. By consolidating your claims, you maintain a unified view of your on-chain inventory, leveraging the synergy between the NFD protocol and modern Algorand logistics tools.
            </p>
          </div>
          <div className="space-y-4 md:col-span-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Old AlgoxNFT Listings</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              NFTs listed for sale on AlgoxNFT and never sold are still held on-chain. Bulk Claim finds both kinds of
              listing, checks each one on-chain before you sign, opts you back in to the asset if needed, and returns
              the NFT to you. Newer listings (Asalytic composable marketplace) are cancelled through the marketplace
              itself, which also refunds the listing&apos;s ALGO deposit to you. For older escrow listings you only sign
              a 0 ALGO permission transaction; as written in that contract, the escrow&apos;s leftover ALGO goes to{" "}
              <span className="font-mono text-slate-300">algoxnft.algo</span>
              <span className="sr-only"> ({ALGOXNFT_ADMIN})</span>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
