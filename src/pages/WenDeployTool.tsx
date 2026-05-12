import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { CID } from "multiformats/cid";
import * as digest from "multiformats/hashes/digest";
import { WebContainer } from "@webcontainer/api";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || "";
const GITHUB_APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG || "";
const GITHUB_REDIRECT_URI = `${window.location.origin}/deploy`;

// Crust Algorand storage contract (mainnet)
const CRUST_APP_ID = 1275319623;

// IPFS gateway for resolving sites
const IPFS_GATEWAY = "https://ipfs.io/ipfs";
const IPFS_GATEWAY_FALLBACKS = [
  "https://gateway.pinata.cloud/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://w3s.link/ipfs",
];

// ARC-19 URL template for CIDv0 (dag-pb, sha2-256)
const ARC19_URL_TEMPLATE = "template-ipfs://{ipfscid:0:dag-pb:reserve:sha2-256}";

// Algorand node config
const ALGOD_SERVER = "https://mainnet-api.4160.nodely.dev";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  private: boolean;
}

interface DeployState {
  step:
    | "idle"
    | "connecting-github"
    | "selecting-repo"
    | "configuring"
    | "booting"
    | "installing"
    | "building"
    | "exporting"
    | "pinning"
    | "minting"
    | "updating"
    | "complete"
    | "error";
  message: string;
  progress: number;
  activeStepIndex: number;
}

const PIPELINE_STEPS = [
  { label: "Environment", sub: "Booting container", steps: ["booting"] },
  { label: "Install", sub: "Fetching deps", steps: ["installing"] },
  { label: "Build", sub: "Generating dist", steps: ["building", "exporting"] },
  { label: "IPFS", sub: "Pinning to Crust", steps: ["pinning"] },
  { label: "Blockchain", sub: "Minting ARC-19", steps: ["minting", "updating"] },
];

interface DeployConfig {
  repo: GitHubRepo | null;
  branch: string;
  buildCommand: string;
  outputDir: string;
  existingAsaId: number | null;
}

// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────

function reserveAddressToCID(reserveAddress: string): string {
  try {
    const decoded = algosdk.decodeAddress(reserveAddress);
    const sha256Code = 0x12;
    const hashDigest = digest.create(sha256Code, decoded.publicKey);
    const cid = CID.createV0(hashDigest);
    return cid.toString();
  } catch (e) {
    console.error("Failed to decode reserve address to CID:", e);
    return "";
  }
}

function cidToReserveAddress(cidStr: string): string {
  try {
    const cid = CID.parse(cidStr);
    const hashBytes = cid.multihash.digest;
    return algosdk.encodeAddress(hashBytes);
  } catch (e) {
    console.error("Failed to encode CID to reserve address:", e);
    return "";
  }
}

function openGitHubAuth(): Promise<string> {
  return new Promise((resolve, reject) => {
    // For GitHub Apps, we still use the OAuth authorize URL, 
    // but the permissions are controlled by the App settings.
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}`;

    const popup = window.open(authUrl, "github-auth", "width=600,height=700");
    if (!popup) {
      reject(new Error("Popup blocked. Please allow popups for this site."));
      return;
    }

    const interval = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(interval);
          reject(new Error("Authentication cancelled."));
          return;
        }
        const url = popup.location.href;
        if (url.includes("code=")) {
          const code = new URL(url).searchParams.get("code");
          popup.close();
          clearInterval(interval);
          if (code) resolve(code);
          else reject(new Error("No auth code received."));
        }
      } catch {
        // Cross-origin
      }
    }, 500);
  });
}

// Global WebContainer instance to prevent "Unable to create more instances" error
let webcontainerInstance: WebContainer | null = null;

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function WenDeployTool() {
  const [searchParams] = useSearchParams();
  const resolveAsaId = searchParams.get("resolve");

  if (resolveAsaId) {
    const asaId = parseInt(resolveAsaId, 10);
    return isNaN(asaId) ? (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-red-400">Invalid ASA ID</div>
    ) : (
      <SiteResolver asaId={asaId} />
    );
  }

  return <DeployView />;
}

// ─── RESOLVER ────────────────────────────────────────────────────────────────

function SiteResolver({ asaId }: { asaId: number }) {
  const [siteInfo, setSiteInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gatewayIndex, setGatewayIndex] = useState(0);

  useEffect(() => {
    async function resolve() {
      try {
        const algod = new algosdk.Algodv2("", ALGOD_SERVER, "");
        const assetInfo = await algod.getAssetByID(asaId).do();
        const params = assetInfo.params;

        if (!params.url?.startsWith("template-ipfs://")) {
          setError("This is not an ARC-19 site asset.");
          return;
        }

        const cid = reserveAddressToCID(params.reserve);
        setSiteInfo({ asaId, cid, name: params.name });
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    resolve();
  }, [asaId]);

  const currentGateway = [IPFS_GATEWAY, ...IPFS_GATEWAY_FALLBACKS][gatewayIndex % 4];
  const siteUrl = siteInfo ? `${currentGateway}/${siteInfo.cid}` : "";

  if (loading) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500 font-mono">RESOLVING...</div>;
  if (error) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-red-400 p-8">{error}</div>;

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950">
      <div className="border-b border-neutral-800 p-3 flex justify-between items-center bg-neutral-900/50">
        <div className="flex items-center gap-3">
          <a href="/deploy" className="text-orange-500 font-bold text-xs tracking-widest">WEN.DEPLOY</a>
          <span className="text-neutral-700 text-xs">|</span>
          <span className="text-neutral-400 text-xs font-mono">{siteInfo.name}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setGatewayIndex(i => i + 1)} className="text-[10px] px-2 py-1 bg-neutral-800 text-neutral-400 rounded-md hover:bg-neutral-700">Switch Gateway</button>
          <a href={siteUrl} target="_blank" rel="noreferrer" className="text-[10px] px-2 py-1 bg-neutral-800 text-neutral-400 rounded-md hover:bg-neutral-700">View Source</a>
        </div>
      </div>
      <iframe src={siteUrl} className="flex-1 w-full border-0" allow="cross-origin-isolated" />
    </div>
  );
}

// ─── DEPLOY VIEW ─────────────────────────────────────────────────────────────

function DeployView() {
  const { activeAddress, signTransactions } = useWallet();
  const [githubToken, setGithubToken] = useState<string | null>(() => sessionStorage.getItem("gh_token"));
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [config, setConfig] = useState<DeployConfig>({
    repo: null, branch: "", buildCommand: "npm run build", outputDir: "dist", existingAsaId: null
  });
  const [deployState, setDeployState] = useState<DeployState>({ step: "idle", message: "", progress: 0, activeStepIndex: -1 });
  const [showConsole, setShowConsole] = useState(false);
  const [result, setResult] = useState<{ cid: string; asaId: number } | null>(null);

  // Terminal & Container Refs
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);

  // ─── GitHub Auth ───
  const connectGitHub = async () => {
    try {
      setDeployState({ step: "connecting-github", message: "Connecting to GitHub...", progress: 0, activeStepIndex: -1 });
      const code = await openGitHubAuth();
      const res = await fetch("/api/github/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const { access_token } = await res.json();
      setGithubToken(access_token);
      sessionStorage.setItem("gh_token", access_token);
    } catch (e: any) {
      setDeployState({ step: "error", message: e.message, progress: 0, activeStepIndex: -1 });
    }
  };

  const installGitHubApp = () => {
    const installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
    window.open(installUrl, "_blank");
  };

  useEffect(() => {
    if (!githubToken) return;
    fetch("https://api.github.com/user/repos?per_page=100&sort=updated", { 
      headers: { Authorization: `Bearer ${githubToken}` } 
    })
      .then(async r => {
        if (r.status === 401) {
          sessionStorage.removeItem("gh_token");
          setGithubToken(null);
          throw new Error("GitHub session expired. Please reconnect.");
        }
        const data = await r.json();
        if (Array.isArray(data)) {
          setRepos(data);
        } else {
          console.error("Unexpected response from GitHub:", data);
          setRepos([]);
        }
      })
      .catch(err => {
        console.error(err);
        setRepos([]);
      });
  }, [githubToken]);

  // ─── WebContainer Init ───
  useEffect(() => {
    if (terminalRef.current && !terminalInstance.current) {
      const term = new Terminal({
        theme: { background: "#0a0a0a", foreground: "#facc15", cursor: "#facc15" },
        fontSize: 12,
        fontFamily: "JetBrains Mono, monospace",
        cursorBlink: true
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();
      terminalInstance.current = term;
    }
  }, [deployState.step]);

  // ─── DEPLOY PIPELINE ───
  const handleDeploy = async () => {
    if (!config.repo || !githubToken) return;

    try {
      // 1. Boot WebContainer
      setDeployState({ step: "booting", message: "Booting browser environment...", progress: 5, activeStepIndex: 0 });
      if (!webcontainerInstance) {
        webcontainerInstance = await WebContainer.boot();
      }
      const wc = webcontainerInstance;
      const term = terminalInstance.current;

      // 2. Fetch & Mount Repo via Proxy (needed for COEP/CORP)
      term?.writeln("\x1b[33m> Fetching repository tarball via proxy...\x1b[0m");
      const tarRes = await fetch(`/api/tarball?repo=${config.repo.full_name}&ref=${config.branch}`, {
        headers: { Authorization: `Bearer ${githubToken}` }
      });
      
      if (!tarRes.ok) {
        const errorData = await tarRes.json().catch(() => ({}));
        throw new Error(`Failed to fetch repository: ${errorData.error || tarRes.statusText}`);
      }

      const tarBuffer = await tarRes.arrayBuffer();
      await wc.fs.writeFile("/repo.tar.gz", new Uint8Array(tarBuffer));

      // 3. Extract (using native tar if available, or a reliable npx tool)
      term?.writeln("\x1b[33m> Extracting repository...\x1b[0m");
      // Use 'tar' directly as it's typically available in WebContainer's jsh
      const untar = await wc.spawn("tar", ["-xzf", "/repo.tar.gz", "-C", "/"]);
      untar.output.pipeTo(new WritableStream({ write(data) { term?.write(data); } }));
      if (await untar.exit !== 0) {
        term?.writeln("\x1b[31m> Tar failed, trying fallback extraction...\x1b[0m");
        const fallback = await wc.spawn("npx", ["-y", "extract-zip", "/repo.tar.gz", "/"]); // Note: GitHub gives tar.gz usually
        if (await fallback.exit !== 0) throw new Error("Failed to extract repository.");
      }

      // Find the extracted folder (it's owner-repo-hash)
      const rootEntries = await wc.fs.readdir("/");
      const repoFolder = rootEntries.find(e => e.includes("-") && e !== "repo.tar.gz");
      if (!repoFolder) throw new Error("Could not find repository folder.");

      // 4. Install
      setDeployState({ step: "installing", message: "Installing dependencies in browser...", progress: 20, activeStepIndex: 1 });
      term?.writeln(`\x1b[33m> Running npm install in /${repoFolder}...\x1b[0m`);
      const install = await wc.spawn("npm", ["install"], { cwd: repoFolder });
      install.output.pipeTo(new WritableStream({ write(data) { term?.write(data); } }));
      if (await install.exit !== 0) throw new Error("Installation failed.");

      // 5. Build
      setDeployState({ step: "building", message: "Running build command...", progress: 50, activeStepIndex: 2 });
      term?.writeln(`\x1b[33m> Running ${config.buildCommand}...\x1b[0m`);
      const build = await wc.spawn("npm", ["run", "build"], { cwd: repoFolder });
      build.output.pipeTo(new WritableStream({ write(data) { term?.write(data); } }));
      if (await build.exit !== 0) throw new Error("Build failed.");

      // 6. Export files for IPFS
      setDeployState({ step: "exporting", message: "Collecting build artifacts...", progress: 75, activeStepIndex: 2 });
      const outputPath = `/${repoFolder}/${config.outputDir}`;
      if (!(await wc.fs.readdir(`/${repoFolder}`)).includes(config.outputDir)) {
         throw new Error(`Output directory "${config.outputDir}" not found.`);
      }

      async function collectFiles(dir: string, base: string, list: any[] = []) {
        const entries = await wc.fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const path = `${dir}/${entry.name}`;
          const relPath = path.replace(base + "/", "");
          if (entry.isDirectory()) await collectFiles(path, base, list);
          else list.push({ path: relPath, content: await wc.fs.readFile(path) });
        }
        return list;
      }
      const files = await collectFiles(outputPath, outputPath);

      // 7. Pin to IPFS (via Crust API proxy or direct if CORS allows)
      setDeployState({ step: "pinning", message: "Pinning to Crust IPFS...", progress: 85, activeStepIndex: 3 });
      // For this, we'll use a multipart upload to a Crust gateway
      // In production, you'd use the hardcoded token from crust-auth.ts
      const crustToken = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
      
      const formData = new FormData();
      files.forEach(f => {
        formData.append("file", new Blob([f.content]), f.path);
      });

      const pinRes = await fetch("https://gw.crustfiles.app/api/v0/add?wrap-with-directory=true&cid-version=1", {
        method: "POST",
        headers: { Authorization: `Basic ${crustToken}` },
        body: formData
      });
      const pinText = await pinRes.text();
      const pinLines = pinText.trim().split("\n");
      const rootCid = JSON.parse(pinLines[pinLines.length - 1]).Hash;

      // 8. Mint/Update ASA
      setDeployState({ step: "minting", message: "Updating Algorand record...", progress: 95, activeStepIndex: 4 });
      const algod = new algosdk.Algodv2("", ALGOD_SERVER, "");
      const params = await algod.getTransactionParams().do();
      const reserveAddress = cidToReserveAddress(rootCid);
      
      let txn;
      if (config.existingAsaId) {
        await algod.getAssetByID(config.existingAsaId).do();
        txn = algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({
          from: activeAddress!,
          assetIndex: config.existingAsaId,
          manager: activeAddress!,
          reserve: reserveAddress,
          suggestedParams: params,
          strictEmptyAddressChecking: false
        });
      } else {
        txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
          from: activeAddress!,
          total: 1, decimals: 0, defaultFrozen: false,
          manager: activeAddress!,
          reserve: reserveAddress,
          unitName: "SITE",
          assetName: config.repo.name.slice(0, 32),
          assetURL: ARC19_URL_TEMPLATE,
          suggestedParams: params
        });
      }

      // Crust payment
      const payment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress!, to: algosdk.getApplicationAddress(CRUST_APP_ID),
        amount: 100000, suggestedParams: params
      });

      algosdk.assignGroupID([txn, payment]);
      const signed = await signTransactions([algosdk.encodeUnsignedTransaction(txn), algosdk.encodeUnsignedTransaction(payment)] as Uint8Array[]);
      const { txId } = await algod.sendRawTransaction(signed as Uint8Array[]).do();
      await algosdk.waitForConfirmation(algod, txId, 4);

      let finalAsaId = config.existingAsaId;
      if (!finalAsaId) {
        const info = await algod.pendingTransactionInformation(txId).do();
        finalAsaId = info["asset-index"];
      }

      setResult({ cid: rootCid, asaId: finalAsaId! });
      setDeployState({ step: "complete", message: "Deployment Successful!", progress: 100, activeStepIndex: 5 });

    } catch (e: any) {
      console.error(e);
      setDeployState({ step: "error", message: e.message, progress: 0, activeStepIndex: -1 });
    }
  };

  const getStepStatus = (index: number) => {
    if (deployState.activeStepIndex > index) return "complete";
    if (deployState.activeStepIndex === index) return "active";
    return "pending";
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-orange-500/30">
      <div className="max-w-4xl mx-auto px-6 py-16">
        
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-black tracking-tighter mb-2">
            <span className="text-orange-500">WEN</span>.DEPLOY <span className="text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded-full font-mono align-middle ml-2 tracking-normal">V2 WEBCONTAINER</span>
          </h1>
          <p className="text-neutral-500 text-sm font-mono tracking-tight">Zero-infrastructure build & deploy pipeline.</p>
        </div>

        {!activeAddress || !githubToken ? (
           <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-10 backdrop-blur-xl">
             <div className="flex flex-col items-center text-center space-y-6">
                <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center">
                  <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold">Connect your accounts</h2>
                <p className="text-neutral-500 text-sm max-w-xs">We need your wallet to sign deployments and a GitHub App installation to fetch your code securely.</p>
                <div className="flex flex-col w-full gap-3 max-w-xs">
                  {!activeAddress && <div className="text-xs text-yellow-500 bg-yellow-500/5 py-2 rounded-lg border border-yellow-500/20">Connect Wallet in Sidebar First</div>}
                  {activeAddress && !githubToken && (
                    <button onClick={connectGitHub} className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-neutral-200 transition-colors">
                      Connect GitHub
                    </button>
                  )}
                </div>
             </div>
           </div>
        ) : !config.repo ? (
           <div className="space-y-6">
             <div className="relative">
               <input 
                 type="text" 
                 placeholder="Search your repositories..." 
                 className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-1 ring-orange-500/50 transition-all"
                 value={repoSearch}
                 onChange={e => setRepoSearch(e.target.value)}
               />
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
               {Array.isArray(repos) && repos.filter(r => r.name.toLowerCase().includes(repoSearch.toLowerCase())).map(repo => (
                 <button 
                   key={repo.id}
                   onClick={() => setConfig(c => ({ ...c, repo, branch: repo.default_branch }))}
                   className="group text-left bg-neutral-900/30 border border-neutral-800 hover:border-orange-500/30 rounded-2xl p-5 transition-all"
                 >
                   <div className="font-bold text-sm mb-1 group-hover:text-orange-400 transition-colors">{repo.name}</div>
                   <div className="text-[10px] text-neutral-500 font-mono">{repo.language || "Unknown"} • {repo.default_branch}</div>
                 </button>
               ))}
               {repos.length === 0 && (
                 <div className="col-span-full py-12 text-center space-y-4">
                    <p className="text-neutral-500 text-sm">No repositories found.</p>
                    <button onClick={installGitHubApp} className="text-xs text-orange-500 font-bold hover:underline uppercase tracking-widest">
                      Install App or Manage Repositories
                    </button>
                 </div>
               )}
             </div>
           </div>
        ) : deployState.step === "idle" || deployState.step === "error" ? (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center font-bold text-orange-500">{config.repo.name[0].toUpperCase()}</div>
                  <div>
                    <div className="font-bold">{config.repo.name}</div>
                    <div className="text-[10px] text-neutral-500 font-mono tracking-tighter uppercase">{config.branch}</div>
                  </div>
                </div>
                <button onClick={() => setConfig(c => ({ ...c, repo: null }))} className="text-[10px] text-neutral-500 hover:text-neutral-300">CHANGE REPO</button>
             </div>

             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">Build Command</label>
                  <input type="text" value={config.buildCommand} onChange={e => setConfig(c => ({ ...c, buildCommand: e.target.value }))} className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-4 py-2 text-xs font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">Output Directory</label>
                  <input type="text" value={config.outputDir} onChange={e => setConfig(c => ({ ...c, outputDir: e.target.value }))} className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-4 py-2 text-xs font-mono" />
                </div>
             </div>

             <button 
               onClick={handleDeploy}
               className="w-full py-4 bg-orange-500 hover:bg-orange-400 text-black font-black text-sm rounded-2xl transition-all shadow-lg shadow-orange-500/10 active:scale-[0.98]"
             >
               BUILD & DEPLOY
             </button>
          </div>
        ) : deployState.step === "complete" ? (
          <div className="bg-green-500/5 border border-green-500/20 rounded-3xl p-10 text-center space-y-6">
             <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
               <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
               </svg>
             </div>
             <h2 className="text-2xl font-black tracking-tight">Deployment Successful</h2>
             <div className="space-y-2 max-w-xs mx-auto">
               <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">Site Address</div>
               <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs font-mono break-all text-green-400">
                 {window.location.origin}/deploy?resolve={result?.asaId}
               </div>
             </div>
             <div className="flex gap-3 justify-center">
                <a href={`/deploy?resolve=${result?.asaId}`} target="_blank" rel="noreferrer" className="px-6 py-3 bg-white text-black font-bold rounded-xl text-sm">View Site</a>
                <button onClick={() => { setDeployState({ step: "idle", message: "", progress: 0, activeStepIndex: -1 }); setConfig(c => ({ ...c, repo: null })); }} className="px-6 py-3 bg-neutral-900 text-neutral-400 font-bold rounded-xl text-sm border border-neutral-800">Deploy New</button>
             </div>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in duration-700">
             <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl">
                {/* Pipeline Stepper */}
                <div className="flex justify-between items-start mb-10 px-2">
                   {PIPELINE_STEPS.map((s, i) => {
                     const status = getStepStatus(i);
                     return (
                       <div key={i} className="flex flex-col items-center flex-1 relative group">
                         {/* Line */}
                         {i < PIPELINE_STEPS.length - 1 && (
                           <div className={`absolute top-4 left-1/2 w-full h-[2px] ${deployState.activeStepIndex > i ? 'bg-orange-500' : 'bg-neutral-800'} transition-colors duration-500`} />
                         )}
                         {/* Circle */}
                         <div className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                           status === 'complete' ? 'bg-orange-500 border-orange-500' :
                           status === 'active' ? 'border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]' :
                           'border-neutral-800 bg-neutral-900'
                         }`}>
                           {status === 'complete' ? (
                             <svg className="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                           ) : (
                             <span className={`text-[10px] font-bold ${status === 'active' ? 'text-orange-500' : 'text-neutral-600'}`}>{i + 1}</span>
                           )}
                         </div>
                         <div className="mt-3 text-center">
                           <div className={`text-[10px] font-black uppercase tracking-widest ${status === 'active' ? 'text-white' : 'text-neutral-500'}`}>{s.label}</div>
                           <div className="text-[8px] text-neutral-600 font-mono mt-0.5">{s.sub}</div>
                         </div>
                       </div>
                     );
                   })}
                </div>

                <div className="flex items-center gap-4 mb-4">
                  <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-neutral-300">{deployState.message}</div>
                  </div>
                  <div className="text-xl font-black text-orange-500">{deployState.progress}%</div>
                </div>
                <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                   <div className="h-full bg-orange-500 transition-all duration-500 ease-out" style={{ width: `${deployState.progress}%` }} />
                </div>
             </div>

             {/* Terminal View Toggle */}
             <div className="flex justify-center">
                <button 
                  onClick={() => setShowConsole(!showConsole)}
                  className="text-[10px] font-bold text-neutral-600 hover:text-orange-500 transition-colors uppercase tracking-widest flex items-center gap-2"
                >
                  {showConsole ? 'Hide' : 'Show'} Build Console
                  <svg className={`w-3 h-3 transition-transform ${showConsole ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
             </div>

             {showConsole && (
               <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl shadow-black/50 animate-in slide-in-from-top-2 duration-300">
                 <div className="bg-neutral-800/50 px-4 py-2 flex items-center gap-2 border-b border-neutral-800">
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-500/50" />
                      <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                      <div className="w-2 h-2 rounded-full bg-green-500/50" />
                    </div>
                    <div className="text-[10px] font-mono text-neutral-500 ml-2 uppercase">WEN.DEPLOY CONSOLE</div>
                 </div>
                 <div ref={terminalRef} className="p-4" />
               </div>
             )}
          </div>
        )}

        {/* Footer info */}
        <div className="mt-20 pt-8 border-t border-neutral-900 flex flex-col md:flex-row justify-between items-center gap-4 opacity-30 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-700">
          <div className="flex gap-6 items-center">
            <img src="/af_logo.svg" className="h-6" alt="Algorand" />
            <img src="/crust.png" className="h-5" alt="Crust" />
            <span className="text-[10px] font-black tracking-widest text-neutral-400">IPFS • ARC-19 • WEBCONTAINER</span>
          </div>
        </div>
      </div>
    </div>
  );
}
