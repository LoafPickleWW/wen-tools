import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { CID } from "multiformats/cid";
import * as digest from "multiformats/hashes/digest";
import { WebContainer } from "@webcontainer/api";
// fflate is used for client-side gzip decompression — run: npm install fflate
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
  const [consoleLog, setConsoleLog] = useState<string>("");

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

  // ─── Terminal: buffered log so output is never lost ───
  const logBuffer = useRef<string[]>([]);

  function termWrite(data: string) {
    if (terminalInstance.current) {
      terminalInstance.current.write(data);
    } else {
      logBuffer.current.push(data);
    }
  }
  function termWriteln(data: string) { termWrite(data + "\r\n"); }

  // Initialise terminal as soon as the ref div is in the DOM
  useEffect(() => {
    if (!terminalRef.current || terminalInstance.current) return;
    const term = new Terminal({
      theme: { background: "#0a0a0a", foreground: "#facc15", cursor: "#facc15" },
      fontSize: 12,
      fontFamily: "JetBrains Mono, monospace",
      cursorBlink: true,
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    terminalInstance.current = term;
    // Flush anything that was written before the terminal was ready
    if (logBuffer.current.length > 0) {
      logBuffer.current.forEach(d => term.write(d));
      logBuffer.current = [];
    }
  });

  // ─── DEPLOY PIPELINE ───
  const handleDeploy = async () => {
    if (!config.repo || !githubToken) return;

    try {
      setConsoleLog(""); 
      // 1. Boot WebContainer
      setDeployState({ step: "booting", message: "Booting browser environment...", progress: 5, activeStepIndex: 0 });
      if (!webcontainerInstance) {
        webcontainerInstance = await WebContainer.boot();
      }
      const wc = webcontainerInstance;

      // 2. Fetch tarball via server-side proxy (avoids codeload.github.com CORS)
      termWriteln("\x1b[33m> Fetching repository tarball...\x1b[0m");
      const tarRes = await fetch(
        `/api/tarball?repo=${encodeURIComponent(config.repo.full_name)}&ref=${encodeURIComponent(config.branch)}`,
        { headers: { Authorization: `Bearer ${githubToken}` } }
      );
      if (!tarRes.ok) throw new Error(`Failed to fetch tarball: ${tarRes.status} ${tarRes.statusText}`);
      const tarGzBuffer = new Uint8Array(await tarRes.arrayBuffer());

      // 3. Decompress gzip + parse tar entirely in JS — WebContainer has no guaranteed tar binary
      termWriteln("\x1b[33m> Extracting repository...\x1b[0m");

      // Dynamically import fflate
      const { decompress } = await import("fflate");
      const tarBytes: Uint8Array = await new Promise((res, rej) =>
        decompress(tarGzBuffer, (err, data) => err ? rej(new Error("Gzip decompress failed: " + err.message)) : res(data))
      );

      // Minimal tar parser → WebContainer FileSystemTree
      function parseTar(buf: Uint8Array): Record<string, any> {
        const tree: Record<string, any> = {};
        let off = 0;
        const dec = new TextDecoder();
        while (off + 512 <= buf.length) {
          const name = dec.decode(buf.slice(off, off + 100)).replace(/\0/g, "").trim();
          if (!name) break;
          const size = parseInt(dec.decode(buf.slice(off + 124, off + 136)).replace(/\0/g, "").trim() || "0", 8);
          const type = String.fromCharCode(buf[off + 156]);
          off += 512;
          // Drop the leading GitHub folder prefix (LoafPickleWW-wen-tools-abc123/)
          const parts = name.split("/").slice(1).filter(Boolean);
          if (parts.length && type !== "5") {
            let node = tree;
            for (const dir of parts.slice(0, -1)) {
              if (!node[dir]) node[dir] = { directory: {} };
              node = node[dir].directory;
            }
            const fname = parts[parts.length - 1];
            if (fname) node[fname] = { file: { contents: buf.slice(off, off + size) } };
          }
          off += Math.ceil(size / 512) * 512;
        }
        return tree;
      }

      const fileTree = parseTar(tarBytes);
      const topKeys = Object.keys(fileTree);
      if (topKeys.length === 0) throw new Error("Failed to extract repository: archive is empty.");

      // Log what the tar parser found
      termWriteln(`\x1b[32m> Parsed tar: top-level keys = ${JSON.stringify(topKeys.slice(0, 10))}\x1b[0m`);

      // Detect if package.json landed at root or one level down
      let mountTree = fileTree;
      const repoFolder = ".";
      if (!fileTree["package.json"] && topKeys.length === 1 && (fileTree[topKeys[0]] as any)?.directory) {
        // Everything is inside one wrapper folder — unwrap it
        mountTree = (fileTree[topKeys[0]] as any).directory;
        termWriteln(`\x1b[33m> Unwrapped extra folder: ${topKeys[0]}\x1b[0m`);
      } else if (!fileTree["package.json"]) {
        termWriteln(`\x1b[31m> WARNING: package.json not found at root. Keys: ${JSON.stringify(topKeys.slice(0, 20))}\x1b[0m`);
      }

      termWriteln(`\x1b[32m> Mounting ${Object.keys(mountTree).length} entries into WebContainer...\x1b[0m`);
      await wc.mount(mountTree);

      // 4. Install
      setDeployState({ step: "installing", message: "Installing dependencies in browser...", progress: 20, activeStepIndex: 1 });
      termWriteln(`\x1b[33m> Running npm install --legacy-peer-deps...\x1b[0m`);

      let installLog = "";
      const install = await wc.spawn("npm", ["install", "--legacy-peer-deps", "--prefer-offline"], { cwd: repoFolder });
      install.output.pipeTo(new WritableStream({
        write(data) {
          installLog += data;
          termWrite(data);
          setConsoleLog(prev => prev + data);
        }
      }));
      const installExit = await install.exit;
      if (installExit !== 0) {
        setConsoleLog(prev => prev + "\n\n--- INSTALL FAILED ---\n" + installLog);
        throw new Error(`Installation failed (exit ${installExit}). See log below.`);
      }

      // 5. Build
      setDeployState({ step: "building", message: "Running build command...", progress: 50, activeStepIndex: 2 });
      termWriteln(`\x1b[33m> Running ${config.buildCommand}...\x1b[0m`);
      let buildLog = "";
      const build = await wc.spawn("npm", ["run", "build"], { cwd: repoFolder });
      build.output.pipeTo(new WritableStream({
        write(data) {
          buildLog += data;
          termWrite(data);
          setConsoleLog(prev => prev + data);
        }
      }));
      const buildExit = await build.exit;
      if (buildExit !== 0) {
        setConsoleLog(prev => prev + "\n\n--- BUILD FAILED ---\n" + buildLog);
        throw new Error(`Build failed (exit ${buildExit}):\n${buildLog.slice(-2000)}`);
      }

      // 6. Export files for IPFS
      setDeployState({ step: "exporting", message: "Collecting build artifacts...", progress: 75, activeStepIndex: 2 });
      const outputPath = `/${config.outputDir}`;
      if (!(await wc.fs.readdir("/")).includes(config.outputDir)) {
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

      // 7. Pin to IPFS
      setDeployState({ step: "pinning", message: "Pinning to Crust IPFS...", progress: 85, activeStepIndex: 3 });
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
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-orange-500/30 overflow-x-hidden">
      <div className="max-w-4xl mx-auto px-6 py-16">
        
        {/* Header */}
        <div className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-4xl font-black tracking-tighter mb-2">
              <span className="text-orange-500">WEN</span>.DEPLOY <span className="text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded-full font-mono align-middle ml-2 tracking-normal">DECENTRALIZED CI/CD</span>
            </h1>
            <p className="text-neutral-500 text-sm font-mono tracking-tight max-w-lg">Zero-infrastructure browser-based pipeline. Your code, your container, your blockchain.</p>
          </div>
          <div className="hidden md:flex gap-2">
            <div className="px-3 py-1 bg-neutral-900 border border-neutral-800 rounded-full text-[10px] font-bold text-neutral-500 uppercase tracking-widest">WebContainer V2</div>
            <div className="px-3 py-1 bg-neutral-900 border border-neutral-800 rounded-full text-[10px] font-bold text-neutral-500 uppercase tracking-widest">ARC-19</div>
          </div>
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <div className="bg-neutral-900/30 border border-neutral-800 rounded-2xl p-5 hover:border-orange-500/20 transition-all group">
            <div className="w-8 h-8 bg-orange-500/10 rounded-lg flex items-center justify-center mb-3 text-orange-500 group-hover:scale-110 transition-transform">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <h3 className="text-xs font-black uppercase tracking-widest mb-1 text-neutral-200">Zero Infrastructure</h3>
            <p className="text-[10px] text-neutral-500 leading-relaxed font-mono">No servers. The entire build happens inside a secure sandbox in your browser. Pure decentralized compute.</p>
          </div>
          <div className="bg-neutral-900/30 border border-neutral-800 rounded-2xl p-5 hover:border-orange-500/20 transition-all group">
            <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center mb-3 text-blue-500 group-hover:scale-110 transition-transform">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-10.726C5.023 12.724 5 13.517 5 14.5c0 3.403.884 6.591 2.444 9.356M12 11c1.744 2.772 2.753 5.994 2.753 9.571m-3.44-10.726c1.789-2.23 4.192-3.726 6.944-4.226m-9.722 13.582c.162.313.33.62.503.918" /></svg>
            </div>
            <h3 className="text-xs font-black uppercase tracking-widest mb-1 text-neutral-200">Immutable Storage</h3>
            <p className="text-[10px] text-neutral-500 leading-relaxed font-mono">Every deployment is pinned to IPFS and indexed via an Algorand ASA. Your site is permanent and tamper-proof.</p>
          </div>
          <div className="bg-neutral-900/30 border border-neutral-800 rounded-2xl p-5 hover:border-orange-500/20 transition-all group">
            <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center mb-3 text-green-500 group-hover:scale-110 transition-transform">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            </div>
            <h3 className="text-xs font-black uppercase tracking-widest mb-1 text-neutral-200">Self-Sovereign</h3>
            <p className="text-[10px] text-neutral-500 leading-relaxed font-mono">You own the deployment keys. You own the metadata. No centralized registrar can take your site down.</p>
          </div>
        </div>

        {!activeAddress || !githubToken ? (
           <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-10 backdrop-blur-xl relative overflow-hidden group">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500/0 via-orange-500/50 to-orange-500/0 opacity-30" />
             <div className="flex flex-col items-center text-center space-y-6 relative z-10">
                <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center animate-pulse">
                  <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-2">Connect Your Workflow</h2>
                  <p className="text-neutral-500 text-sm max-w-sm mx-auto">We use your GitHub App installation to pull code and your Algorand wallet to sign the immutable record.</p>
                </div>
                <div className="flex flex-col w-full gap-3 max-w-xs">
                  {!activeAddress && <div className="text-[10px] font-black uppercase tracking-widest text-yellow-500 bg-yellow-500/5 py-3 rounded-xl border border-yellow-500/20">Connect Wallet in Sidebar</div>}
                  {activeAddress && !githubToken && (
                    <button onClick={connectGitHub} className="group relative w-full py-4 bg-white text-black font-black text-sm rounded-xl hover:bg-neutral-200 transition-all overflow-hidden active:scale-95">
                      <span className="relative z-10">CONNECT GITHUB</span>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                    </button>
                  )}
                </div>
             </div>
           </div>
        ) : !config.repo ? (
           <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="relative">
               <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                 <svg className="w-4 h-4 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
               </div>
               <input 
                 type="text" 
                 placeholder="Search repositories..." 
                 className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl pl-12 pr-6 py-5 text-sm focus:outline-none focus:ring-1 ring-orange-500/50 transition-all placeholder:text-neutral-700"
                 value={repoSearch}
                 onChange={e => setRepoSearch(e.target.value)}
               />
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[440px] overflow-y-auto pr-2 custom-scrollbar">
               {Array.isArray(repos) && repos.filter(r => r.name.toLowerCase().includes(repoSearch.toLowerCase())).map(repo => (
                 <button 
                   key={repo.id}
                   onClick={() => setConfig(c => ({ ...c, repo, branch: repo.default_branch }))}
                   className="group text-left bg-neutral-900/30 border border-neutral-800 hover:border-orange-500/40 rounded-2xl p-5 transition-all hover:bg-neutral-900/50"
                 >
                   <div className="flex justify-between items-start mb-2">
                     <div className="font-bold text-sm group-hover:text-orange-400 transition-colors truncate max-w-[180px]">{repo.name}</div>
                   </div>
                   <div className="text-[10px] text-neutral-500 font-mono flex items-center gap-2">
                     <span className="w-1.5 h-1.5 rounded-full bg-orange-500/40" />
                     {repo.language || "Web"} • {repo.default_branch}
                   </div>
                 </button>
               ))}
               {repos.length === 0 && (
                 <div className="col-span-full py-16 text-center space-y-4 bg-neutral-900/20 rounded-3xl border border-dashed border-neutral-800">
                    <p className="text-neutral-600 text-xs font-mono">No repositories available.</p>
                    <button onClick={installGitHubApp} className="text-[10px] text-orange-500 font-black hover:text-orange-400 uppercase tracking-[0.2em] border-b border-orange-500/30 pb-0.5">
                      Install GitHub App
                    </button>
                 </div>
               )}
             </div>
           </div>
        ) : deployState.step === "idle" || deployState.step === "error" ? (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-10 space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
             {deployState.step === "error" && consoleLog && (
               <div className="bg-neutral-950 border border-red-500/20 rounded-2xl p-6 space-y-3 animate-in slide-in-from-top-2">
                 <div className="text-[10px] font-black text-red-400 uppercase tracking-[0.2em] flex items-center gap-2">
                   <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                   Build Log (last run)
                 </div>
                 <pre className="text-[10px] font-mono text-neutral-400 whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed p-4 bg-black/40 rounded-xl custom-scrollbar">
                   {consoleLog.replace(new RegExp("\x1b\\[[0-9;]*m", "g"), "").slice(-3000)}
                 </pre>
               </div>
             )}
             
             <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center font-black text-black shadow-lg shadow-orange-500/10 transform -rotate-3">{config.repo.name[0].toUpperCase()}</div>
                  <div>
                    <div className="font-bold text-lg">{config.repo.name}</div>
                    <div className="text-[10px] text-orange-500/70 font-black tracking-widest uppercase flex items-center gap-1.5">
                      {config.branch}
                    </div>
                  </div>
                </div>
                <button onClick={() => setConfig(c => ({ ...c, repo: null }))} className="text-[10px] font-black tracking-widest text-neutral-600 hover:text-neutral-400 transition-colors uppercase">Change Target</button>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] text-neutral-500 font-black uppercase tracking-[0.2em] ml-1">Build Command</label>
                  <input type="text" value={config.buildCommand} onChange={e => setConfig(c => ({ ...c, buildCommand: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-5 py-3 text-xs font-mono text-orange-400 focus:outline-none focus:border-orange-500/50 transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-neutral-500 font-black uppercase tracking-[0.2em] ml-1">Output Dir</label>
                  <input type="text" value={config.outputDir} onChange={e => setConfig(c => ({ ...c, outputDir: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-5 py-3 text-xs font-mono text-orange-400 focus:outline-none focus:border-orange-500/50 transition-all" />
                </div>
             </div>

             <button 
               onClick={handleDeploy}
               className="group relative w-full py-5 bg-orange-500 hover:bg-orange-400 text-black font-black text-sm rounded-2xl transition-all shadow-xl shadow-orange-500/20 active:scale-[0.98] overflow-hidden"
             >
               <span className="relative z-10">INITIATE DECENTRALIZED DEPLOY</span>
               <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
             </button>
          </div>
        ) : deployState.step === "complete" ? (
          <div className="bg-green-500/5 border border-green-500/20 rounded-3xl p-12 text-center space-y-8 animate-in zoom-in-95 duration-500">
             <div className="w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(34,197,94,0.15)]">
               <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
               </svg>
             </div>
             <h2 className="text-3xl font-black tracking-tighter mb-2 text-green-400 uppercase">Deployed to Eternity</h2>
             
             <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 text-left space-y-4 max-w-sm mx-auto">
               <div>
                 <div className="text-[10px] text-neutral-600 font-black uppercase tracking-widest mb-1.5">Universal Site Resolver</div>
                 <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-[10px] font-mono break-all text-green-500/80 leading-relaxed">
                   {window.location.origin}/deploy?resolve={result?.asaId}
                 </div>
               </div>
             </div>

             <div className="flex gap-4 justify-center">
                <a href={`/deploy?resolve=${result?.asaId}`} target="_blank" rel="noreferrer" className="px-8 py-4 bg-white text-black font-black rounded-xl text-xs hover:scale-105 transition-transform active:scale-95">VIEW LIVE SITE</a>
                <button onClick={() => { setDeployState({ step: "idle", message: "", progress: 0, activeStepIndex: -1 }); setConfig(c => ({ ...c, repo: null })); }} className="px-8 py-4 bg-neutral-900 text-neutral-400 font-black rounded-xl text-xs border border-neutral-800 hover:bg-neutral-800 transition-colors">NEW DEPLOY</button>
             </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-1000">
             <div className="bg-neutral-900 border border-neutral-800 rounded-[32px] p-10 shadow-2xl relative overflow-hidden">
                {/* Pipeline Stepper */}
                <div className="flex justify-between items-start mb-12 px-2 relative z-10">
                   {PIPELINE_STEPS.map((s, i) => {
                     const status = getStepStatus(i);
                     return (
                       <div key={i} className="flex flex-col items-center flex-1 relative group">
                         {i < PIPELINE_STEPS.length - 1 && (
                           <div className={`absolute top-4 h-[2px] ${deployState.activeStepIndex > i ? 'bg-orange-500' : 'bg-neutral-800'} transition-all duration-700`} style={{left:'calc(50% + 1.25rem)', right:'calc(-50% + 1.25rem)'}} />
                         )}
                         <div className={`relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                           status === 'complete' ? 'bg-orange-500 border-orange-500 scale-90' :
                           status === 'active' ? 'border-orange-500 shadow-[0_0_25px_rgba(249,115,22,0.3)] bg-neutral-900' :
                           'border-neutral-800 bg-neutral-950'
                         }`}>
                           {status === 'complete' ? (
                             <svg className="w-5 h-5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                           ) : (
                             <span className={`text-[10px] font-black ${status === 'active' ? 'text-orange-500' : 'text-neutral-700'}`}>{i + 1}</span>
                           )}
                         </div>
                         <div className="mt-4 text-center">
                           <div className={`text-[10px] font-black uppercase tracking-widest ${status === 'active' ? 'text-white' : 'text-neutral-600'}`}>{s.label}</div>
                           <div className="text-[8px] text-neutral-600 font-mono mt-0.5 opacity-50">{s.sub}</div>
                         </div>
                       </div>
                     );
                   })}
                </div>

                <div className="relative z-10">
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-3 h-3 bg-orange-500 rounded-full animate-ping" />
                    <div className="flex-1">
                      <div className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1">Status Report</div>
                      <div className="text-sm font-bold text-neutral-200">{deployState.message}</div>
                    </div>
                    <div className="text-3xl font-black text-orange-500 drop-shadow-sm">{deployState.progress}%</div>
                  </div>
                  <div className="w-full h-2 bg-neutral-950 border border-neutral-800/50 rounded-full overflow-hidden p-0.5">
                     <div className="h-full bg-gradient-to-r from-orange-600 to-orange-400 rounded-full transition-all duration-700 ease-out shadow-[0_0_15px_rgba(249,115,22,0.2)]" style={{ width: `${deployState.progress}%` }} />
                  </div>
                </div>
             </div>

             <div className="flex justify-center">
                <button 
                  onClick={() => setShowConsole(!showConsole)}
                  className="group px-6 py-2.5 bg-neutral-900 border border-neutral-800 rounded-full text-[10px] font-black text-neutral-500 hover:text-orange-500 transition-all uppercase tracking-[0.2em] flex items-center gap-3 active:scale-95"
                >
                  {showConsole ? 'CLOSE' : 'MONITOR'} BUILD STREAM
                  <svg className={`w-3 h-3 transition-transform duration-300 ${showConsole ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
             </div>

             <div className={`bg-neutral-900 border border-neutral-800 rounded-[32px] overflow-hidden shadow-2xl shadow-black/80 transition-all duration-500 ${showConsole ? 'opacity-100 max-h-[500px] translate-y-0' : 'opacity-0 max-h-0 translate-y-4 border-0'}`}>
               <div className="bg-neutral-800/40 px-6 py-3 flex items-center justify-between border-b border-neutral-800">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500/30" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/30" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500/30" />
                    </div>
                    <div className="text-[10px] font-black font-mono text-neutral-500 uppercase tracking-widest ml-2">WEN.DEPLOY Runtime Logs</div>
                  </div>
               </div>
               <div ref={terminalRef} className="p-6 custom-terminal" />
             </div>
          </div>
        )}

        {/* Use Cases */}
        {deployState.step === "idle" && (
          <div className="mt-20 space-y-8 animate-in fade-in duration-1000 delay-300">
            <h2 className="text-[10px] font-black text-neutral-600 uppercase tracking-[0.4em] text-center">Use Case Scenarios</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-8 bg-neutral-900/10 border border-neutral-900 rounded-[32px] space-y-4">
                <div className="text-orange-500/50">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                </div>
                <h4 className="font-bold">Decentralized Manifestos</h4>
                <p className="text-xs text-neutral-500 leading-relaxed font-mono">Publish high-stakes content that cannot be altered or removed by any centralized authority.</p>
              </div>
              <div className="p-8 bg-neutral-900/10 border border-neutral-900 rounded-[32px] space-y-4">
                <div className="text-blue-500/50">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 21h6l-.75-4M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </div>
                <h4 className="font-bold">Immutable DApps</h4>
                <p className="text-xs text-neutral-500 leading-relaxed font-mono">Deploy the frontend for your smart contracts. Ensure that the interface is as immutable as the code on-chain.</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-24 pt-8 border-t border-neutral-900/50 flex flex-col md:flex-row justify-between items-center gap-6 opacity-40 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-1000">
          <div className="flex gap-8 items-center">
            <img src="/af_logo.svg" className="h-5" alt="Algorand" />
            <img src="/crust.png" className="h-4" alt="Crust" />
          </div>
          <div className="flex gap-4 text-[9px] font-black tracking-widest text-neutral-500 uppercase">
            <span>Browser OS</span>
            <span className="w-1 h-1 bg-neutral-800 rounded-full mt-1" />
            <span>IPFS Overlay</span>
            <span className="w-1 h-1 bg-neutral-800 rounded-full mt-1" />
            <span>ARC-19 Mainnet</span>
          </div>
        </div>
      </div>
      
      {/* Dynamic Background Elements */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none -z-10 opacity-20">
        <div className="absolute top-[10%] left-[5%] w-[40%] h-[40%] bg-orange-500/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[10%] right-[5%] w-[30%] h-[30%] bg-blue-500/10 blur-[100px] rounded-full animate-pulse delay-700" />
      </div>
    </div>
  );
}
