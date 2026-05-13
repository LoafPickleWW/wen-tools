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

// Keywords to trigger "Crypto Dep" warning
const BLOCKCHAIN_KEYWORDS = ["algo", "eth", "web3", "wallet", "contract", "noble", "cipher", "crypto", "beacon", "sign", "ledger", "perawallet", "defly", "daffi"];

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
  { label: "Prepare", sub: "Fetching build", steps: ["booting"] },
  { label: "Artifact", sub: "Getting files", steps: ["installing"] },
  { label: "Unpack", sub: "Reading dist", steps: ["building", "exporting"] },
  { label: "IPFS", sub: "Pinning to Crust", steps: ["pinning"] },
  { label: "Blockchain", sub: "Minting ARC-19", steps: ["minting", "updating"] },
];

interface DeployConfig {
  repo: GitHubRepo | null;
  branch: string;
  buildCommand: string;
  outputDir: string;
  existingAsaId: number | null;
  detectedPkgManager: string | null;
  hasBlockchainDeps: boolean;
}

// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
}

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

function openGitHubAuth(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}`;

    if (isMobile()) {
      sessionStorage.setItem("gh_oauth_pending", "true");
      window.location.href = authUrl;
      resolve(null);
      return;
    }

    const popup = window.open(authUrl, "github-auth", "width=600,height=700,left=200,top=100");
    if (!popup) {
      sessionStorage.setItem("gh_oauth_pending", "true");
      window.location.href = authUrl;
      resolve(null);
      return;
    }

    const start = Date.now();
    const interval = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(interval);
          reject(new Error("Authentication cancelled."));
          return;
        }
        
        if (Date.now() - start > 300000) {
          popup.close();
          clearInterval(interval);
          reject(new Error("Authentication timed out."));
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
      } catch { /* cross-origin */ }
    }, 300);
  });
}

let webcontainerInstance: WebContainer | null = null;

// ─── EMBEDDED WORKFLOW ───────────────────────────────────────────────────────
const WEN_DEPLOY_WORKFLOW = `name: Build & Upload Artifact

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Detect package manager
        id: pm
        run: |
          if [ -f "pnpm-lock.yaml" ]; then
            echo "manager=pnpm" >> $GITHUB_OUTPUT
          elif [ -f "yarn.lock" ]; then
            echo "manager=yarn" >> $GITHUB_OUTPUT
          else
            echo "manager=npm" >> $GITHUB_OUTPUT
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Setup pnpm
        if: steps.pm.outputs.manager == 'pnpm'
        uses: pnpm/action-setup@v3
        with:
          version: latest

      - name: Install dependencies
        run: |
          if [ "\${{ steps.pm.outputs.manager }}" = "pnpm" ]; then
            pnpm install --no-frozen-lockfile
          elif [ "\${{ steps.pm.outputs.manager }}" = "yarn" ]; then
            yarn install
          else
            npm install --legacy-peer-deps
          fi

      - name: Build
        run: |
          if [ "\${{ steps.pm.outputs.manager }}" = "pnpm" ]; then
            pnpm run build
          elif [ "\${{ steps.pm.outputs.manager }}" = "yarn" ]; then
            yarn build
          else
            npm run build
          fi

      # ── Upload build output as artifact ──────────────────────────────────────
      # WEN.DEPLOY will automatically detect and use this artifact,
      # skipping the in-browser build step for much faster deploys.
      - name: Upload build artifact
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 7
`;

const WEN_DEPLOY_AI_PROMPT = `You are helping set up WEN.DEPLOY for this repository.

WEN.DEPLOY is a decentralized deployment tool that pins static sites to IPFS and mints them as Algorand ARC-19 NFTs. To enable fast, reliable deploys it needs a GitHub Actions workflow that builds the project and uploads the output as an artifact.

Please do the following:
1. Create the file \`.github/workflows/wen-deploy.yml\` with this exact content:

\`\`\`yaml
${WEN_DEPLOY_WORKFLOW}
\`\`\`

2. Check the project's build output directory. The workflow above assumes \`dist/\` — if this project outputs to a different directory (e.g. \`build/\`, \`out/\`, \`.next/\`, \`public/\`) update the \`path:\` line in the "Upload build artifact" step accordingly.

3. Make sure the workflow's install and build commands match what this project uses.

4. Commit and push the workflow file. Once the first Actions run completes successfully, WEN.DEPLOY will automatically use the pre-built artifact for near-instant deploys.`;

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

function DeployView() {
  const { activeAddress, signTransactions } = useWallet();
  const [searchParams] = useSearchParams();
  const [githubToken, setGithubToken] = useState<string | null>(() => sessionStorage.getItem("gh_token"));
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [config, setConfig] = useState<DeployConfig>({
    repo: null, branch: "", buildCommand: "npm run build", outputDir: "dist", existingAsaId: null, detectedPkgManager: null, hasBlockchainDeps: false
  });
  const [deployState, setDeployState] = useState<DeployState>({ step: "idle", message: "", progress: 0, activeStepIndex: -1 });
  const [showConsole, setShowConsole] = useState(false);
  const [result, setResult] = useState<{ cid: string; asaId: number } | null>(null);
  const [consoleLog, setConsoleLog] = useState<string>("");
  const [deployMode, setDeployMode] = useState<"actions" | "webcontainer" | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);

  // ─── GITHUB AUTH FLOW ───
  const exchangeCodeForToken = async (code: string) => {
    try {
      const res = await fetch("/api/github/token", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ code }) 
      });
      const { access_token } = await res.json();
      if (!access_token) throw new Error("Authentication failed: No token received.");
      setGithubToken(access_token);
      sessionStorage.setItem("gh_token", access_token);
      sessionStorage.removeItem("gh_oauth_pending");
    } catch (e: any) {
      setDeployState({ step: "error", message: e.message, progress: 0, activeStepIndex: -1 });
    }
  };

  useEffect(() => {
    const code = searchParams.get("code");
    const pending = sessionStorage.getItem("gh_oauth_pending");
    if (code && pending) {
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
      exchangeCodeForToken(code);
    }
  }, [searchParams]);

  const connectGitHub = async () => {
    try {
      setDeployState({ step: "connecting-github", message: "Connecting to GitHub...", progress: 0, activeStepIndex: -1 });
      const code = await openGitHubAuth();
      if (code) await exchangeCodeForToken(code);
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
        if (Array.isArray(data)) setRepos(data);
        else setRepos([]);
      })
      .catch(() => setRepos([]));
  }, [githubToken]);

  const logBuffer = useRef<string[]>([]);
  function termWrite(data: string) {
    if (terminalInstance.current) terminalInstance.current.write(data);
    else logBuffer.current.push(data);
  }
  function termWriteln(data: string) { termWrite(data + "\r\n"); }

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
    if (logBuffer.current.length > 0) {
      logBuffer.current.forEach(d => term.write(d));
      logBuffer.current = [];
    }
  });

  const handleDeploy = async () => {
    if (!config.repo || !githubToken) return;

    try {
      setConsoleLog("");
      let files: { path: string; content: Uint8Array }[] | null = null;

      // ── FAST PATH: GitHub Actions artifact ──────────────────────────────────
      if (deployMode !== "webcontainer") {
        setDeployState({ step: "booting", message: "Checking for pre-built artifact...", progress: 5, activeStepIndex: 0 });
        termWriteln("\x1b[36m> Checking GitHub Actions for a pre-built artifact...\x1b[0m");

        try {
          const runsRes = await fetch(
            `https://api.github.com/repos/${config.repo.full_name}/actions/runs?status=success&per_page=10&branch=${encodeURIComponent(config.branch)}`,
            { headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" } }
          );
          if (runsRes.ok) {
            const runs: any[] = (await runsRes.json()).workflow_runs || [];
            for (const run of runs) {
              const artRes = await fetch(
                `https://api.github.com/repos/${config.repo.full_name}/actions/runs/${run.id}/artifacts`,
                { headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" } }
              );
              const artifacts: any[] = (await artRes.json()).artifacts || [];
              const preferred = ["dist", "build", "out", "public", config.outputDir];
              const match = artifacts.find((a: any) => preferred.some((p: string) => a.name.toLowerCase().includes(p))) ?? artifacts[0];
              if (match) {
                termWriteln(`\x1b[32m> Found artifact: "${match.name}" (run #${run.run_number})\x1b[0m`);
                const zipRes = await fetch("/api/artifact", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: match.archive_download_url, token: githubToken })
                });
                if (zipRes.ok) {
                  const { unzip } = await import("fflate");
                  const zipBytes = new Uint8Array(await zipRes.arrayBuffer());
                  const unzipped: Record<string, Uint8Array> = await new Promise((res, rej) =>
                    unzip(zipBytes, (err, data) => err ? rej(err) : res(data))
                  );
                  const zipKeys = Object.keys(unzipped).filter((k: string) => !k.endsWith("/"));
                  const topDirs = new Set(zipKeys.map((k: string) => k.split("/")[0]));
                  const stripPrefix = topDirs.size === 1 ? [...topDirs][0] + "/" : "";
                  files = zipKeys.map((k: string) => ({
                    path: stripPrefix ? k.slice(stripPrefix.length) : k,
                    content: unzipped[k]
                  })).filter((f: any) => f.path);
                  termWriteln(`\x1b[32m> Unpacked ${files.length} files from artifact — skipping build step\x1b[0m`);
                }
                break;
              }
            }
          }
        } catch (_artifactErr) {
          termWriteln(`\x1b[33m> No artifact available, falling back to WebContainer build\x1b[0m`);
        }
      }

      // ── SLOW PATH: WebContainer build ────────────────────────────────────────
      if (!files) {
        if (deployMode === "actions") throw new Error("No GitHub Action artifact found. Please push your workflow or use In-Browser Build.");

        setDeployState({ step: "booting", message: "Booting browser environment...", progress: 8, activeStepIndex: 0 });
        if (!webcontainerInstance) webcontainerInstance = await WebContainer.boot();
        const wc = webcontainerInstance;

        termWriteln("\x1b[33m> Fetching repository tarball...\x1b[0m");
        const tarRes = await fetch(`/api/tarball?repo=${encodeURIComponent(config.repo.full_name)}&ref=${encodeURIComponent(config.branch)}`, { headers: { Authorization: `Bearer ${githubToken}` } });
        if (!tarRes.ok) throw new Error(`Failed to fetch tarball: ${tarRes.status}`);
        const tarGzBuffer = new Uint8Array(await tarRes.arrayBuffer());

        termWriteln("\x1b[33m> Extracting repository...\x1b[0m");
        const { decompress } = await import("fflate");
        const tarBytes: Uint8Array = await new Promise((res, rej) => decompress(tarGzBuffer, (err, data) => err ? rej(err) : res(data)));

        function parseTar(buf: Uint8Array): Record<string, any> {
          const tree: Record<string, any> = {};
          let off = 0;
          const dec = new TextDecoder();
          while (off + 512 <= buf.length) {
            let isZero = true;
            for (let i = 0; i < 64; i++) { if (buf[off + i] !== 0) { isZero = false; break; } }
            if (isZero) break;

            const name = dec.decode(buf.slice(off, off + 100)).replace(/\x00/g, "").trim();
            const prefix = dec.decode(buf.slice(off + 345, off + 500)).replace(/\x00/g, "").trim();
            const fullName = prefix ? `${prefix}/${name}` : name;
            const size = parseInt(dec.decode(buf.slice(off + 124, off + 136)).replace(/\x00/g, "").trim() || "0", 8);
            const type = String.fromCharCode(buf[off + 156]);
            
            off += 512;
            if (fullName && type !== "5" && type !== "L") {
              const parts = fullName.split("/").filter(Boolean);
              const stripped = parts.length > 1 ? parts.slice(1) : parts; // Strip owner-repo-sha wrapper
              if (stripped.length > 0) {
                let node = tree;
                for (const dir of stripped.slice(0, -1)) {
                  if (!node[dir] || !node[dir].directory) node[dir] = { directory: {} };
                  node = node[dir].directory;
                }
                const fname = stripped[stripped.length - 1];
                if (fname) node[fname] = { file: { contents: buf.slice(off, off + size) } };
              }
            }
            off += Math.ceil(size / 512) * 512;
          }
          return tree;
        }

        const mountTree = parseTar(tarBytes);
        const topKeys = Object.keys(mountTree);
        termWriteln(`\x1b[36m> Parsed tar top-level keys: ${JSON.stringify(topKeys.slice(0, 15))}\x1b[0m`);
        
        const hasPackageJson = !!mountTree["package.json"];
        termWriteln(`\x1b[${hasPackageJson ? "32" : "31"}m> package.json at root: ${hasPackageJson}\x1b[0m`);
        
        termWriteln(`\x1b[32m> Mounting ${topKeys.length} entries into WebContainer...\x1b[0m`);
        await wc.mount(mountTree);

        const rootAfterMount = await wc.fs.readdir("/");
        termWriteln(`\x1b[36m> Container root after mount: ${JSON.stringify(rootAfterMount.slice(0, 15))}\x1b[0m`);

        const pm = topKeys.includes("pnpm-lock.yaml") ? { bin: "npx", args: ["pnpm", "install", "--no-frozen-lockfile", "--force", "--network-concurrency=4"], label: "pnpm" }
                  : topKeys.includes("yarn.lock") ? { bin: "npx", args: ["yarn", "install", "--frozen-lockfile", "--network-concurrency=4"], label: "yarn" }
                  : { bin: "npm", args: ["install", "--legacy-peer-deps"], label: "npm" };

        const npmrc = ["fetch-retries=8", "fetch-retry-mintimeout=20000", "fetch-retry-maxtimeout=120000", "network-concurrency=4"].join("\n");
        await wc.fs.writeFile("/.npmrc", npmrc);

        setDeployState({ step: "installing", message: `Installing with ${pm.label}...`, progress: 20, activeStepIndex: 1 });
        let exit = 1;
        for (let i = 1; i <= 3; i++) {
          const install = await wc.spawn(pm.bin, pm.args);
          install.output.pipeTo(new WritableStream({ write(d) { termWrite(d); setConsoleLog(p => p + d); } }));
          exit = await install.exit;
          if (exit === 0) break;
          await new Promise(r => setTimeout(r, 5000 * i));
        }
        if (exit !== 0) throw new Error("Installation failed.");

        setDeployState({ step: "building", message: "Running build...", progress: 50, activeStepIndex: 2 });
        const bParts = config.buildCommand.trim().split(/\s+/);
        const [bBin, ...bArgs] = ["npm", "pnpm", "yarn", "npx"].includes(bParts[0]) ? bParts : [pm.bin, "run", bParts[0]];
        const build = await wc.spawn(bBin, bArgs);
        build.output.pipeTo(new WritableStream({ write(d) { termWrite(d); setConsoleLog(p => p + d); } }));
        if (await build.exit !== 0) throw new Error("Build failed.");

        const outputPath = `/${config.outputDir}`;
        async function collectFiles(dir: string, base: string, list: { path: string; content: Uint8Array }[] = []) {
          const entries = await wc.fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const path = `${dir}/${entry.name}`, rel = path.slice(base.length + 1);
            if (entry.isDirectory()) await collectFiles(path, base, list);
            else list.push({ path: rel, content: await wc.fs.readFile(path) });
          }
          return list;
        }
        files = await collectFiles(outputPath, outputPath);
      }

      // ── SHARED: Pinning & Minting ──────────────────────────────────────────
      setDeployState({ step: "pinning", message: "Pinning to IPFS...", progress: 85, activeStepIndex: 3 });
      const crustToken = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
      const formData = new FormData();
      (files as { path: string; content: Uint8Array }[]).forEach(f => {
        const content = f.content.buffer instanceof SharedArrayBuffer ? new Uint8Array(f.content) : f.content;
        formData.append("file", new Blob([content as any]), f.path);
      });

      const pinRes = await fetch("https://gw.crustfiles.app/api/v0/add?wrap-with-directory=true&cid-version=1", {
        method: "POST", headers: { Authorization: `Basic ${crustToken}` }, body: formData
      });
      const pinLines = (await pinRes.text()).trim().split("\n");
      const rootCid = JSON.parse(pinLines[pinLines.length - 1]).Hash;

      setDeployState({ step: "minting", message: "Finalizing on Algorand...", progress: 95, activeStepIndex: 4 });
      const algod = new algosdk.Algodv2("", ALGOD_SERVER, ""), params = await algod.getTransactionParams().do();
      const reserve = cidToReserveAddress(rootCid);
      
      const txn = config.existingAsaId 
        ? algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({ from: activeAddress!, assetIndex: config.existingAsaId, manager: activeAddress!, reserve, suggestedParams: params, strictEmptyAddressChecking: false })
        : algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({ from: activeAddress!, total: 1, decimals: 0, defaultFrozen: false, manager: activeAddress!, reserve, unitName: "SITE", assetName: config.repo.name.slice(0, 32), assetURL: ARC19_URL_TEMPLATE, suggestedParams: params });

      const payment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ from: activeAddress!, to: algosdk.getApplicationAddress(CRUST_APP_ID), amount: 100000, suggestedParams: params });
      algosdk.assignGroupID([txn, payment]);
      const signed = await signTransactions([algosdk.encodeUnsignedTransaction(txn), algosdk.encodeUnsignedTransaction(payment)]);
      if (!signed || signed.length < 2 || !signed[0] || !signed[1]) throw new Error("Transaction signing failed.");
      
      const { txId } = await algod.sendRawTransaction(signed as Uint8Array[]).do();
      await algosdk.waitForConfirmation(algod, txId, 4);

      let asaId = config.existingAsaId;
      if (!asaId) {
        const info = await algod.pendingTransactionInformation(txId).do();
        asaId = info["asset-index"];
      }

      setResult({ cid: rootCid, asaId: asaId! });
      setDeployState({ step: "complete", message: "Deployment Successful!", progress: 100, activeStepIndex: 5 });
    } catch (e: any) {
      setDeployState({ step: "error", message: e.message, progress: 0, activeStepIndex: -1 });
    }
  };

  const getStepStatus = (index: number) => {
    if (deployState.activeStepIndex > index) return "complete";
    if (deployState.activeStepIndex === index) return "active";
    return "pending";
  };

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
        </div>

        {!activeAddress || !githubToken ? (
           <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-10 backdrop-blur-xl flex flex-col items-center text-center space-y-6">
              <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center animate-pulse">
                <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold">Connect your accounts</h2>
              <div className="flex flex-col w-full gap-3 max-w-xs">
                {!activeAddress && <div className="text-[10px] font-black uppercase tracking-widest text-yellow-500 bg-yellow-500/5 py-3 rounded-xl border border-yellow-500/20">Connect Wallet in Sidebar</div>}
                {activeAddress && !githubToken && (
                  <button onClick={connectGitHub} className="w-full py-4 bg-white text-black font-black text-sm rounded-xl hover:bg-neutral-200 transition-all active:scale-95">CONNECT GITHUB</button>
                )}
              </div>
           </div>
        ) : !config.repo ? (
           <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="relative">
               <input 
                 type="text" 
                 placeholder="Search repositories..." 
                 className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl px-6 py-5 text-sm focus:outline-none focus:ring-1 ring-orange-500/50 transition-all"
                 value={repoSearch}
                 onChange={e => setRepoSearch(e.target.value)}
               />
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[440px] overflow-y-auto pr-2 custom-scrollbar">
               {repos.filter(r => r.name.toLowerCase().includes(repoSearch.toLowerCase())).map(repo => (
                 <button 
                   key={repo.id}
                   onClick={async () => {
                     let buildCommand = "npm run build", hasBlockchainDeps = false;
                     try {
                       const treeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}`, { headers: { Authorization: `Bearer ${githubToken}` } });
                       const treeData = await treeRes.json(), filenames = (treeData.tree || []).map((f: any) => f.path.toLowerCase());
                       if (filenames.includes("pnpm-lock.yaml")) buildCommand = "pnpm run build";
                       else if (filenames.includes("yarn.lock")) buildCommand = "yarn build";
                       hasBlockchainDeps = filenames.some((f: string) => BLOCKCHAIN_KEYWORDS.some((k: string) => f.includes(k)));
                     } catch { /* ignore scan error */ }
                     setConfig(c => ({ ...c, repo, branch: repo.default_branch, buildCommand, hasBlockchainDeps }));
                     if (hasBlockchainDeps) setDeployMode("actions");
                   }}
                   className="group text-left bg-neutral-900/30 border border-neutral-800 hover:border-orange-500/40 rounded-2xl p-5 transition-all hover:bg-neutral-900/50"
                 >
                   <div className="font-bold text-sm mb-1 group-hover:text-orange-400 transition-colors">{repo.name}</div>
                   <div className="text-[10px] text-neutral-500 font-mono">{repo.language || "Web"} • {repo.default_branch}</div>
                 </button>
               ))}
               {repos.length === 0 && (
                 <div className="col-span-full py-16 text-center space-y-4">
                    <p className="text-neutral-500 text-sm">No repositories found.</p>
                    <button onClick={installGitHubApp} className="text-xs text-orange-500 font-bold hover:underline uppercase tracking-widest">Manage GitHub App installations</button>
                 </div>
               )}
             </div>
           </div>
        ) : deployState.step === "idle" || deployState.step === "error" ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
             {deployState.step === "error" && consoleLog && (
               <div className="bg-neutral-950 border border-red-500/20 rounded-2xl p-6 space-y-3">
                 <div className="text-[10px] font-black text-red-400 uppercase tracking-widest flex items-center gap-2">
                   <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Build Log (last run)
                 </div>
                 <pre className="text-[10px] font-mono text-neutral-400 whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed p-4 bg-black/40 rounded-xl custom-scrollbar">
                   {consoleLog.replace(new RegExp("\\u001b\\[[0-9;]*m", "g"), "").slice(-3000)}
                 </pre>
               </div>
             )}
             
             <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-6 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center font-bold text-orange-500">{config.repo.name[0].toUpperCase()}</div>
                  <div>
                    <div className="font-bold">{config.repo.name}</div>
                    <div className="text-[10px] text-neutral-500 font-mono uppercase flex items-center gap-2">
                      {config.branch}
                      {config.detectedPkgManager && <span className="text-cyan-500/70 border border-cyan-500/20 rounded px-1">{config.detectedPkgManager}</span>}
                      {config.hasBlockchainDeps && <span className="text-orange-500/70 border border-orange-500/20 rounded px-1">crypto deps</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => { setConfig(c => ({ ...c, repo: null })); setDeployMode(null); }} className="text-[10px] text-neutral-500 hover:text-neutral-300">CHANGE REPO</button>
             </div>

             <div className="space-y-3">
                <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">Choose deploy method</div>
                
                <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${deployMode === "actions" ? "border-orange-500/50 bg-orange-500/5" : "border-neutral-800 bg-neutral-900/50"}`}>
                  <button onClick={() => setDeployMode("actions")} className="w-full p-5 flex items-start gap-4 text-left">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base mt-0.5 ${deployMode === "actions" ? "bg-orange-500/20" : "bg-neutral-800"}`}>⚡</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm">GitHub Actions</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-orange-500 text-black px-2 py-0.5 rounded-full">Recommended</span>
                        {config.hasBlockchainDeps && <span className="text-[9px] font-bold uppercase tracking-wider bg-green-500/20 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Required for crypto repos</span>}
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">Builds on GitHub's servers. Near-instant deploys once set up. Reliable for all projects.</p>
                      <div className="flex gap-4 mt-2">
                        <span className="text-[10px] text-neutral-500 flex items-center gap-1"><span className="text-green-400">✓</span> Works with crypto deps</span>
                        <span className="text-[10px] text-neutral-500 flex items-center gap-1"><span className="text-green-400">✓</span> Fast (~5s after setup)</span>
                      </div>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-1 ${deployMode === "actions" ? "border-orange-500 bg-orange-500" : "border-neutral-600"}`} />
                  </button>

                  {deployMode === "actions" && (
                    <div className="border-t border-orange-500/20 p-5 space-y-4">
                      <div className="flex gap-2 flex-wrap">
                        <a href={`data:text/yaml;charset=utf-8,${encodeURIComponent(WEN_DEPLOY_WORKFLOW)}`} download="wen-deploy.yml" className="inline-flex items-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-400 text-black font-bold text-[10px] rounded-xl">↓ Download workflow</a>
                        <button onClick={() => navigator.clipboard.writeText(WEN_DEPLOY_WORKFLOW)} className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold text-[10px] rounded-xl">Copy workflow</button>
                        <button onClick={() => navigator.clipboard.writeText(WEN_DEPLOY_AI_PROMPT)} className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-cyan-400 font-bold text-[10px] rounded-xl">✦ Copy AI prompt</button>
                      </div>
                      <button onClick={handleDeploy} className="w-full py-4 bg-orange-500 hover:bg-orange-400 text-black font-black text-sm rounded-2xl active:scale-[0.98]">DEPLOY VIA GITHUB ACTIONS</button>
                    </div>
                  )}
                </div>

                <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${deployMode === "webcontainer" ? "border-neutral-600 bg-neutral-900/80" : "border-neutral-800 bg-neutral-900/30"}`}>
                  <button onClick={() => setDeployMode("webcontainer")} className="w-full p-5 flex items-start gap-4 text-left">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base mt-0.5 ${deployMode === "webcontainer" ? "bg-neutral-700" : "bg-neutral-800/50"}`}>🌐</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm text-neutral-300">In-Browser Build</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-full">No setup required</span>
                      </div>
                      <p className="text-[11px] text-neutral-500 leading-relaxed">Builds directly in the browser using WebContainer. Slower and may struggle with crypto deps.</p>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-1 ${deployMode === "webcontainer" ? "border-neutral-400 bg-neutral-400" : "border-neutral-600"}`} />
                  </button>

                  {deployMode === "webcontainer" && (
                    <div className="border-t border-neutral-700 p-5 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <input type="text" value={config.buildCommand} onChange={e => setConfig(c => ({ ...c, buildCommand: e.target.value }))} className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-3 py-2 text-xs font-mono" placeholder="Build command" />
                        <input type="text" value={config.outputDir} onChange={e => setConfig(c => ({ ...c, outputDir: e.target.value }))} className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-3 py-2 text-xs font-mono" placeholder="Output dir" />
                      </div>
                      <button onClick={handleDeploy} className="w-full py-4 bg-neutral-700 hover:bg-neutral-600 text-white font-black text-sm rounded-2xl active:scale-[0.98]">BUILD IN BROWSER</button>
                    </div>
                  )}
                </div>
             </div>
          </div>
        ) : deployState.step === "complete" ? (
          <div className="bg-green-500/5 border border-green-500/20 rounded-3xl p-10 text-center space-y-6">
             <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(34,197,94,0.15)]"><svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg></div>
             <h2 className="text-2xl font-black tracking-tight">Deployment Successful</h2>
             <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-xs font-mono break-all text-green-400 max-w-sm mx-auto">{window.location.origin}/deploy?resolve={result?.asaId}</div>
             <div className="flex gap-3 justify-center"><a href={`/deploy?resolve=${result?.asaId}`} target="_blank" rel="noreferrer" className="px-6 py-3 bg-white text-black font-bold rounded-xl text-sm transition-transform active:scale-95">View Site</a><button onClick={() => { setDeployState({ step: "idle", message: "", progress: 0, activeStepIndex: -1 }); setConfig(c => ({ ...c, repo: null })); }} className="px-6 py-3 bg-neutral-900 text-neutral-400 font-bold rounded-xl text-sm border border-neutral-800">Deploy New</button></div>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in duration-700">
             <div className="bg-neutral-900 border border-neutral-800 rounded-[32px] p-10 shadow-2xl">
                <div className="flex justify-between items-start mb-12 px-2 relative">
                   {PIPELINE_STEPS.map((s, i) => {
                     const status = getStepStatus(i);
                     return (
                       <div key={i} className="flex flex-col items-center flex-1 relative group">
                         {i < PIPELINE_STEPS.length - 1 && <div className={`absolute top-4 h-[2px] ${deployState.activeStepIndex > i ? 'bg-orange-500' : 'bg-neutral-800'} transition-all duration-700`} style={{left:'calc(50% + 1.25rem)', right:'calc(-50% + 1.25rem)'}} />}
                         <div className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${status === 'complete' ? 'bg-orange-500 border-orange-500' : status === 'active' ? 'border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'border-neutral-800 bg-neutral-900'}`}>{status === 'complete' ? <svg className="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg> : <span className={`text-[10px] font-bold ${status === 'active' ? 'text-orange-500' : 'text-neutral-700'}`}>{i + 1}</span>}</div>
                         <div className="mt-4 text-center"><div className={`text-[10px] font-black uppercase tracking-widest ${status === 'active' ? 'text-white' : 'text-neutral-600'}`}>{s.label}</div><div className="text-[8px] text-neutral-600 font-mono mt-0.5">{s.sub}</div></div>
                       </div>
                     );
                   })}
                </div>
                <div className="flex items-center gap-4 mb-4"><div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" /><div className="flex-1"><div className="text-sm font-bold text-neutral-200">{deployState.message}</div></div><div className="text-xl font-black text-orange-500">{deployState.progress}%</div></div>
                <div className="w-full h-1.5 bg-neutral-950 border border-neutral-800 rounded-full overflow-hidden"><div className="h-full bg-orange-500 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(249,115,22,0.2)]" style={{ width: `${deployState.progress}%` }} /></div>
             </div>
             <div className="flex justify-center"><button onClick={() => setShowConsole(!showConsole)} className="text-[10px] font-bold text-neutral-600 hover:text-orange-500 transition-all uppercase tracking-widest flex items-center gap-2">{showConsole ? 'Hide' : 'Show'} Build Console <svg className={`w-3 h-3 transition-transform ${showConsole ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></button></div>
             <div className={`bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 ${showConsole ? 'opacity-100 max-h-[400px]' : 'opacity-0 max-h-0 border-0'}`}><div className="bg-neutral-800/50 px-4 py-2 flex items-center border-b border-neutral-800"><div className="flex gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500/50" /><div className="w-2 h-2 rounded-full bg-yellow-500/50" /><div className="w-2 h-2 rounded-full bg-green-500/50" /></div><div className="text-[10px] font-mono text-neutral-500 ml-2 uppercase">WEN.DEPLOY CONSOLE</div></div><div ref={terminalRef} className="p-4" /></div>
          </div>
        )}

        <div className="mt-20 pt-8 border-t border-neutral-900 flex flex-col md:flex-row justify-between items-center gap-4 opacity-30 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-1000"><div className="flex gap-6 items-center"><img src="/af_logo.svg" className="h-6" alt="Algorand" /><img src="/crust.png" className="h-5" alt="Crust" /><span className="text-[10px] font-black tracking-widest text-neutral-400">IPFS • ARC-19 • CI/CD</span></div></div>
      </div>
    </div>
  );
}
