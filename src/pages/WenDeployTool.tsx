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
const IPFS_GATEWAY = "https://ipfs.algonode.dev/ipfs";
const IPFS_GATEWAY_FALLBACKS = [
  "https://gw.crustfiles.net/ipfs",
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
  { label: "CI Artifact", sub: "Fetching build", steps: ["booting"] },
  { label: "Download", sub: "Getting artifact", steps: ["installing"] },
  { label: "Unpack", sub: "Reading dist files", steps: ["building", "exporting"] },
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

function reserveAddressToCID(reserveAddress: string): string {
  try {
    const decoded = algosdk.decodeAddress(reserveAddress);
    const sha256Code = 0x12;
    const hashDigest = digest.create(sha256Code, decoded.publicKey);
    const cid = CID.createV0(hashDigest).toV1();
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

function toCIDv1(cidStr: string): string {
  try {
    const cid = CID.parse(cidStr);
    return cid.toV1().toString();
  } catch (e) {
    console.error("Failed to convert CID to v1:", e);
    return cidStr;
  }
}

const isMobile = () => /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

function openGitHubAuth(): Promise<string> {
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}`;

  if (isMobile()) {
    sessionStorage.setItem("gh_oauth_pending", "1");
    window.location.href = authUrl;
    return new Promise(() => {});
  }

  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, "github-auth", "width=600,height=700,left=200,top=100");
    if (!popup) {
      sessionStorage.setItem("gh_oauth_pending", "1");
      window.location.href = authUrl;
      return new Promise(() => {});
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
      } catch { /* cross-origin */ }
    }, 300);

    setTimeout(() => {
      clearInterval(interval);
      if (!popup.closed) popup.close();
      reject(new Error("Authentication timed out."));
    }, 5 * 60 * 1000);
  });
}

function generateReadmeHTML(markdown: string, repoName: string): string {
  // Basic md → html conversion for headings, code blocks, links
  const body = markdown
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/```[\w]*\n([\s\S]*?)```/gm, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^---$/gm, "<hr>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${repoName}</title>
  <style>
    body { max-width: 860px; margin: 0 auto; padding: 2rem; font-family: -apple-system, sans-serif; 
           background: #0d1117; color: #e6edf3; line-height: 1.6; }
    h1,h2,h3,h4 { border-bottom: 1px solid #30363d; padding-bottom: .3em; }
    pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; 
          padding: 1rem; overflow-x: auto; }
    code { background: #161b22; padding: .2em .4em; border-radius: 3px; font-size: 90%; }
    pre code { background: none; padding: 0; }
    a { color: #58a6ff; } hr { border-color: #30363d; }
    li { margin: .25rem 0; }
    table { border-collapse: collapse; width: 100%; }
    td,th { border: 1px solid #30363d; padding: .5rem .75rem; }
  </style>
</head>
<body><p>${body}</p></body>
</html>`;
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
          node-version: 22

      - name: Setup pnpm
        if: steps.pm.outputs.manager == 'pnpm'
        uses: pnpm/action-setup@v4

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

2. Check the project's build output directory. The workflow above assumes \`dist/\` — if this project outputs to a different directory update the \`path:\` line in the "Upload build artifact" step accordingly.

3. Make sure the workflow's install and build commands match what this project uses.

4. Commit and push the workflow file. Once the first Actions run completes successfully, WEN.DEPLOY will automatically use the pre-built artifact for near-instant deploys — no in-browser build needed.

Do not modify anything else in the repository.`;

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
      <iframe src={siteUrl} className="flex-1 w-full border-0" />
    </div>
  );
}

function DeployView() {
  const { activeAddress, signTransactions } = useWallet();
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const pending = sessionStorage.getItem("gh_oauth_pending");
    if (code && pending) {
      sessionStorage.removeItem("gh_oauth_pending");
      window.history.replaceState({}, "", window.location.pathname);
      setDeployState({ step: "connecting-github", message: "Connecting to GitHub...", progress: 0, activeStepIndex: -1 });
      fetch("/api/github/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      })
        .then(r => r.json())
        .then(({ access_token, error }) => {
          if (error || !access_token) throw new Error(error || "Token exchange failed");
          setGithubToken(access_token);
          sessionStorage.setItem("gh_token", access_token);
          setDeployState({ step: "idle", message: "", progress: 0, activeStepIndex: -1 });
        })
        .catch(e => setDeployState({ step: "error", message: e.message, progress: 0, activeStepIndex: -1 }));
    }
  }, []);

  const connectGitHub = async () => {
    try {
      setDeployState({ step: "connecting-github", message: "Connecting to GitHub...", progress: 0, activeStepIndex: -1 });
      const code = await openGitHubAuth();
      const res = await fetch("/api/github/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const { access_token, error } = await res.json();
      if (error || !access_token) throw new Error(error || "Token exchange failed");
      setGithubToken(access_token);
      sessionStorage.setItem("gh_token", access_token);
      setDeployState({ step: "idle", message: "", progress: 0, activeStepIndex: -1 });
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
    setConsoleLog("");

    try {
      let files: { path: string; content: Uint8Array }[] | null = null;

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
            const match = artifacts.find(a => preferred.some(p => a.name.toLowerCase().includes(p))) ?? artifacts[0];
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
                const zipKeys = Object.keys(unzipped).filter(k => !k.endsWith("/"));
                const topDirs = new Set(zipKeys.map(k => k.split("/")[0]));
                const stripPrefix = topDirs.size === 1 ? [...topDirs][0] + "/" : "";
                files = zipKeys.map(k => ({
                  path: stripPrefix ? k.slice(stripPrefix.length) : k,
                  content: unzipped[k]
                })).filter(f => f.path);
                termWriteln(`\x1b[32m> Unpacked ${files.length} files from artifact — skipping build step\x1b[0m`);
              }
              break;
            }
          }
        }
      } catch {
        termWriteln(`\x1b[33m> No artifact available, falling back to WebContainer build\x1b[0m`);
      }
      }

      if (!files) {
        termWriteln("\x1b[33m> Fetching repository tarball...\x1b[0m");
        setDeployState({ step: "booting", message: "Fetching code...", progress: 8, activeStepIndex: 0 });
        const tarRes = await fetch(`/api/tarball?repo=${encodeURIComponent(config.repo.full_name)}&ref=${encodeURIComponent(config.branch)}`, { headers: { Authorization: `Bearer ${githubToken}` } });
        if (!tarRes.ok) throw new Error(`Failed to fetch tarball: ${tarRes.status}`);
        const tarGzBuffer = new Uint8Array(await tarRes.arrayBuffer());

        termWriteln("\x1b[33m> Extracting repository...\x1b[0m");
        const { decompress } = await import("fflate");
        const tarBytes: Uint8Array = await new Promise((res, rej) => decompress(tarGzBuffer, (err, data) => err ? rej(err) : res(data)));

        function parseTar(buf: Uint8Array): Record<string, any> {
          const tree: Record<string, any> = {};
          const dec = new TextDecoder();
          let off = 0;

          const SKIP_NAMES = new Set(["pax_global_header", "./pax_global_header"]);
          const NULL = String.fromCharCode(0);

          while (off + 512 <= buf.length) {
            const header = buf.slice(off, off + 512);
            if (header.every((b: number) => b === 0)) break;

            const name    = dec.decode(header.slice(0, 100)).split(NULL).join("").trim();
            const prefix  = dec.decode(header.slice(345, 500)).split(NULL).join("").trim();
            const fullName = prefix ? prefix + "/" + name : name;
            const sizeStr = dec.decode(header.slice(124, 136)).split(NULL).join("").trim();
            const size    = sizeStr ? parseInt(sizeStr, 8) : 0;
            const type    = String.fromCharCode(header[156]);

            off += 512;

            const skip = SKIP_NAMES.has(fullName) || type === "5" || type === "x" || type === "g" || type === "X" || type === "L" || type === "K";
            const isFile = !skip && (type === "0" || type === "\0" || type === "");

            if (isFile && fullName && !isNaN(size)) {
              const fileData = buf.slice(off, off + size);
              const parts = fullName.split("/").filter(Boolean);
              const stripped = parts.length > 1 ? parts.slice(1) : parts;

              if (stripped.length > 0) {
                let node = tree;
                for (const dir of stripped.slice(0, -1)) {
                  if (!node[dir] || !node[dir].directory) node[dir] = { directory: {} };
                  node = node[dir].directory;
                }
                const fname = stripped[stripped.length - 1];
                if (fname) node[fname] = { file: { contents: fileData } };
              }
            }
            if (!isNaN(size)) off += Math.ceil(size / 512) * 512;
          }
          return tree;
        }

        const fileTree = parseTar(tarBytes);
        const topKeys = Object.keys(fileTree);
        if (topKeys.length === 0) throw new Error("Failed to extract repository: archive is empty.");

        termWriteln(`\x1b[36m> Parsed tar top-level keys: ${JSON.stringify(topKeys.slice(0, 15))}\x1b[0m`);

        let mountTree = fileTree;
        const realKeys = topKeys.filter(k => k !== "pax_global_header" && !k.startsWith("pax_") && !k.startsWith("."));

        if (!mountTree["package.json"] && realKeys.length === 1) {
          const candidate = (fileTree[realKeys[0]] as any)?.directory;
          if (candidate && candidate["package.json"]) {
            mountTree = candidate;
            termWriteln(`\x1b[33m> Unwrapped wrapper folder: ${realKeys[0]}\x1b[0m`);
          } else {
            for (const key of Object.keys(candidate ?? {})) {
              const sub = candidate?.[key]?.directory;
              if (sub?.["package.json"]) {
                mountTree = sub;
                termWriteln(`\x1b[33m> Unwrapped nested folder: ${realKeys[0]}/${key}\x1b[0m`);
                break;
              }
            }
          }
        }

        const hasPackageJson = !!mountTree["package.json"];
        termWriteln(`\x1b[${hasPackageJson ? "32" : "33"}m> package.json at root: ${hasPackageJson}\x1b[0m`);

        if (!hasPackageJson) {
          termWriteln("\x1b[33m> No package.json found — treating repo as static site, skipping build\x1b[0m");

          const collectFromTree = (node: Record<string, any>, prefix = "", list: { path: string; content: Uint8Array }[] = []) => {
            for (const [key, val] of Object.entries(node)) {
              const fullPath = prefix ? `${prefix}/${key}` : key;
              if (val?.file?.contents) list.push({ path: fullPath, content: val.file.contents });
              else if (val?.directory) collectFromTree(val.directory, fullPath, list);
            }
            return list;
          };

          files = collectFromTree(mountTree);
          
          const hasIndex = files.some(f => f.path === "index.html" || f.path === "index.htm");
          if (!hasIndex) {
            const readme = files.find(f => f.path.toLowerCase() === "readme.md");
            if (readme) {
              const md = new TextDecoder().decode(readme.content);
              const html = generateReadmeHTML(md, config.repo!.name);
              files.push({ path: "index.html", content: new TextEncoder().encode(html) });
              termWriteln(`\x1b[33m> No index.html found — generated one from README.md\x1b[0m`);
            }
          }
          termWriteln(`\x1b[32m> Collected ${files.length} static files\x1b[0m`);
        } else {
          termWriteln("\x1b[33m> Booting WebContainer...\x1b[0m");
          if (webcontainerInstance) {
            try { webcontainerInstance.teardown(); } catch { /* ignore */ }
            webcontainerInstance = null;
          }
          webcontainerInstance = await WebContainer.boot();
          const wc = webcontainerInstance;

          termWriteln(`\x1b[32m> Mounting ${Object.keys(mountTree).length} entries into WebContainer...\x1b[0m`);
          await wc.mount(mountTree);

          const rootAfterMount = await wc.fs.readdir("/");
          if (!rootAfterMount.includes("package.json")) {
            termWriteln(`\x1b[31m> ERROR: package.json not found at root. Contents: ${JSON.stringify(rootAfterMount)}\x1b[0m`);
            throw new Error(`package.json missing from container root.`);
          }

          const mountedKeys = Object.keys(mountTree);
          type PkgManager = { bin: string; installArgs: string[]; runArgs: (s: string) => string[]; label: string };
          const pkgManager: PkgManager = mountedKeys.includes("pnpm-lock.yaml")
            ? { bin: "npx", installArgs: ["--yes", "pnpm@9", "install", "--no-frozen-lockfile"], runArgs: s => ["--yes", "pnpm@9", "run", s], label: "pnpm" }
            : mountedKeys.includes("yarn.lock")
            ? { bin: "npx", installArgs: ["yarn", "install"], runArgs: s => ["yarn", s], label: "yarn" }
            : { bin: "npm", installArgs: ["install", "--legacy-peer-deps"], runArgs: s => ["run", s], label: "npm" };

          const npmrc = ["registry=https://registry.npmjs.org/", "fetch-retries=2", "fetch-retry-mintimeout=5000", "fetch-retry-maxtimeout=10000", "maxsockets=4", "network-concurrency=4"].join("\n");
          await wc.fs.writeFile("/.npmrc", npmrc);

          setDeployState({ step: "installing", message: `Installing with ${pkgManager.label}...`, progress: 20, activeStepIndex: 1 });
          termWriteln(`\x1b[33m> Running ${pkgManager.label} install...\x1b[0m`);

          let installLog = "", installExit = 1;
          for (let attempt = 1; attempt <= 3; attempt++) {
            if (attempt > 1) {
              termWriteln(`\x1b[33m> Network error — retry ${attempt}/3...\x1b[0m`);
              await new Promise(r => setTimeout(r, attempt * 10000));
            }
            installLog = "";
            const install = await wc.spawn(pkgManager.bin, pkgManager.installArgs, { cwd: "." });
            install.output.pipeTo(new WritableStream({ write(data) { installLog += data; termWrite(data); setConsoleLog(p => p + data); } }));
            installExit = await Promise.race([ install.exit, new Promise<number>(r => setTimeout(() => r(124), 180000)) ]);
            const isNetErr = installLog.includes("ECONNRESET") || installLog.includes("socket hang up") || installLog.includes("META_FETCH_FAIL") || installLog.includes("FETCH_FAIL");
            if (installExit === 0 || !isNetErr) break;
          }
          if (installExit !== 0) {
            const ESC_ERR = String.fromCharCode(27);
            const ANSI_REG_ERR = new RegExp(ESC_ERR + "\\[[0-9;]*m", "g");
            const snippet = installLog.replace(ANSI_REG_ERR, "").slice(-500);
            throw new Error(`Installation failed (exit ${installExit}).\n${snippet}`);
          }

          setDeployState({ step: "building", message: "Building...", progress: 50, activeStepIndex: 2 });
          const buildCmd = config.buildCommand.trim().split(/\s+/);
          const knownBins = ["npm", "pnpm", "yarn", "npx"];
          const [buildBin, ...buildArgs] = knownBins.includes(buildCmd[0]) ? buildCmd : [pkgManager.bin, ...pkgManager.runArgs(buildCmd.join(" "))];
          const build = await wc.spawn(buildBin, buildArgs, { cwd: "." });
          build.output.pipeTo(new WritableStream({ write(data) { termWrite(data); setConsoleLog(p => p + data); } }));
          if (await build.exit !== 0) throw new Error("Build failed.");

          setDeployState({ step: "exporting", message: "Collecting build output...", progress: 75, activeStepIndex: 2 });
          const outputPath = `/${config.outputDir}`;
          const collectFiles = async (dir: string, base: string, list: { path: string; content: Uint8Array }[] = []) => {
            const entries = await wc.fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const full = `${dir}/${entry.name}`, rel = full.slice(base.length + 1);
              if (entry.isDirectory()) await collectFiles(full, base, list);
              else list.push({ path: rel, content: await wc.fs.readFile(full) });
            }
            return list;
          };
          files = await collectFiles(outputPath, outputPath);
        }
      }

      if (!files || files.length === 0) throw new Error("No files found to deploy.");

      // ── SHARED: Pinning & Minting ──────────────────────────────────────────
      setDeployState({ step: "pinning", message: "Pinning to IPFS...", progress: 85, activeStepIndex: 3 });
      const crustToken = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
      const formData = new FormData();
      (files as { path: string; content: Uint8Array }[]).forEach(f => {
        const content = f.content.buffer instanceof SharedArrayBuffer ? new Uint8Array(f.content) : f.content;
        formData.append("file", new Blob([content as any]), f.path);
      });

      const pinRes = await fetch("https://gw-seattle.crustcloud.io/api/v0/add?pin=true&wrap-with-directory=true&recursive=true", {
        method: "POST",
        headers: { Authorization: `Basic ${crustToken}` },
        body: formData
      });
      if (!pinRes.ok) throw new Error(`IPFS pin failed: ${pinRes.status}`);
      
      const text = await pinRes.text();
      const lines = text.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));

      // The root directory entry always has Name === "" when using wrap-with-directory
      const root = lines.find(l => l.Name === "");
      if (!root) throw new Error("No root directory entry in IPFS response");
      
      const cid = toCIDv1(root.Hash);
      termWriteln(`\x1b[32m> Pinned to IPFS: ${cid}\x1b[0m`);

      const algod = new algosdk.Algodv2("", ALGOD_SERVER, "");
      const params = await algod.getTransactionParams().do();
      const reserve = cidToReserveAddress(cid);

      let txn;
      if (config.existingAsaId) {
        setDeployState({ step: "updating", message: "Verifying asset ownership...", progress: 88, activeStepIndex: 4 });
        const assetInfo = await algod.getAssetByID(config.existingAsaId).do();
        
        if (assetInfo.params.manager !== activeAddress) {
          throw new Error(`You are not the manager of ASA ${config.existingAsaId}. Manager is ${assetInfo.params.manager}`);
        }

        txn = algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({
          from: activeAddress!,
          assetIndex: config.existingAsaId,
          manager: assetInfo.params.manager,
          reserve: reserve,
          freeze: assetInfo.params.freeze,
          clawback: assetInfo.params.clawback,
          strictEmptyAddressChecking: false,
          suggestedParams: params
        });
        setDeployState({ step: "updating", message: "Updating on-chain...", progress: 93, activeStepIndex: 4 });
      } else {
        setDeployState({ step: "minting", message: "Minting ARC-19 NFT...", progress: 92, activeStepIndex: 4 });
        txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
          from: activeAddress!,
          assetName: config.repo.name.slice(0, 32),
          unitName: "SITE",
          total: 1,
          decimals: 0,
          reserve,
          assetURL: ARC19_URL_TEMPLATE,
          manager: activeAddress!,
          defaultFrozen: false,
          suggestedParams: params
        });
      }

      const payment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: activeAddress!,
        to: algosdk.getApplicationAddress(CRUST_APP_ID),
        amount: 100000,
        suggestedParams: params
      });
      algosdk.assignGroupID([txn, payment]);

      const signed = await signTransactions([algosdk.encodeUnsignedTransaction(txn), algosdk.encodeUnsignedTransaction(payment)]);
      if (!signed || signed.length < 2 || !signed[0] || !signed[1]) throw new Error("Transaction signing failed.");
      
      const { txId } = await algod.sendRawTransaction(signed as Uint8Array[]).do();
      await algosdk.waitForConfirmation(algod, txId, 4);

      let asaId = config.existingAsaId;
      if (!asaId) {
        const ptx = await algod.pendingTransactionInformation(txId).do();
        asaId = ptx["asset-index"];
      }

      setResult({ cid, asaId: asaId! });
      setDeployState({ step: "complete", message: "Deployment Complete!", progress: 100, activeStepIndex: 5 });
      termWriteln("\x1b[32m> Deployment successful!\x1b[0m");

    } catch (e: any) {
      setDeployState({ step: "error", message: e.message, progress: 0, activeStepIndex: -1 });
    }
  };

  const getStepStatus = (index: number) => {
    if (deployState.activeStepIndex > index) return "complete";
    if (deployState.activeStepIndex === index) return "active";
    return "pending";
  };

  const ESC_RENDER = String.fromCharCode(27);
  const ANSI_REG_RENDER = new RegExp(ESC_RENDER + "\\[[0-9;]*m", "g");

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-orange-500/30">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="text-4xl font-black tracking-tighter mb-2">
            <span className="text-orange-500">WEN</span>.DEPLOY <span className="text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded-full font-mono align-middle ml-2 tracking-normal">V2 WEBCONTAINER</span>
          </h1>
          <p className="text-neutral-500 text-sm font-mono tracking-tight">Zero-infrastructure build & deploy pipeline.</p>
        </div>

        {!activeAddress || !githubToken ? (
           <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-10 backdrop-blur-xl">
             <div className="flex flex-col items-center text-center space-y-6">
                <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center"><svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg></div>
                <h2 className="text-xl font-bold">Connect your accounts</h2>
                <div className="flex flex-col w-full gap-3 max-w-xs">
                  {!activeAddress && <div className="text-xs text-yellow-500 bg-yellow-500/5 py-2 rounded-lg border border-yellow-500/20">Connect Wallet in Sidebar First</div>}
                  {activeAddress && !githubToken && ( <button onClick={connectGitHub} className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-neutral-200 transition-colors">Connect GitHub</button> )}
                </div>
             </div>
           </div>
        ) : !config.repo ? (
           <div className="space-y-6">
             <div className="relative"><input type="text" placeholder="Search your repositories..." className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-1 ring-orange-500/50 transition-all" value={repoSearch} onChange={e => setRepoSearch(e.target.value)} /></div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
               {Array.isArray(repos) && repos.filter(r => r.name.toLowerCase().includes(repoSearch.toLowerCase())).map(repo => (
                 <button key={repo.id} onClick={async () => {
                   let buildCommand = "npm run build";
                   let hasBlockchainDepsDetected = false;
                   try {
                     const treeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}`, { headers: { Authorization: `Bearer ${githubToken}` } });
                     const treeData = await treeRes.json(), filenames = (treeData.tree || []).map((f: any) => f.path);
                     if (filenames.includes("pnpm-lock.yaml")) buildCommand = "pnpm run build";
                     else if (filenames.includes("yarn.lock")) buildCommand = "yarn build";
                     const pkgFile = treeData.tree?.find((f: any) => f.path === "package.json");
                     if (pkgFile?.url) {
                       const pkgRes = await fetch(pkgFile.url, { headers: { Authorization: `Bearer ${githubToken}` } });
                       const pkgBlob = await pkgRes.json();
                       const pkgJson = JSON.parse(atob(pkgBlob.content));
                       const allDeps = Object.keys({ ...pkgJson.dependencies, ...pkgJson.devDependencies });
                       const PROBLEM = ['algosdk', 'ethers', 'web3', '@solana/web3.js', 'bitcoinjs-lib', '@perawallet/connect', 'vite-plugin-node-polyfills', 'crypto-browserify', 'bn.js', 'elliptic', 'secp256k1'];
                       hasBlockchainDepsDetected = PROBLEM.some(d => allDeps.includes(d));
                     }
                   } catch { /* silently fall back */ }
                   setConfig(c => ({ ...c, repo, branch: repo.default_branch, buildCommand, hasBlockchainDeps: hasBlockchainDepsDetected }));
                 }} className="group text-left bg-neutral-900/30 border border-neutral-800 hover:border-orange-500/30 rounded-2xl p-5 transition-all">
                   <div className="font-bold text-sm mb-1 group-hover:text-orange-400 transition-colors">{repo.name}</div>
                   <div className="text-[10px] text-neutral-500 font-mono">{repo.language || "Unknown"} • {repo.default_branch}</div>
                 </button>
               ))}
               {repos.length === 0 && ( <div className="col-span-full py-12 text-center space-y-4"><p className="text-neutral-500 text-sm">No repositories found.</p><button onClick={installGitHubApp} className="text-xs text-orange-500 font-bold hover:underline uppercase tracking-widest">Install App or Manage Repositories</button></div> )}
             </div>
           </div>
        ) : deployState.step === "idle" || deployState.step === "error" ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {deployState.step === "error" && (
              <div className="space-y-3">
                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4"><div className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Deploy Failed</div><p className="text-xs text-red-300 font-mono whitespace-pre-wrap">{deployState.message}</p></div>
                {consoleLog && ( <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4"><div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">Build Log</div><pre className="text-[10px] font-mono text-neutral-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto leading-relaxed">{consoleLog.replace(ANSI_REG_RENDER, "").slice(-3000)}</pre></div> )}
              </div>
            )}
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-6 flex justify-between items-center">
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center font-bold text-orange-500 text-lg">{config.repo.name[0].toUpperCase()}</div><div><div className="font-bold text-sm">{config.repo.name}</div><div className="text-[10px] text-neutral-500 font-mono uppercase">{config.branch}</div></div></div>
              <button onClick={() => { setConfig(c => ({ ...c, repo: null })); setDeployMode(null); }} className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors">CHANGE REPO</button>
            </div>
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">Choose deploy method</div>
              
              <button onClick={() => setDeployMode(deployMode === "actions" ? null : "actions")} className={`w-full text-left rounded-2xl border transition-all duration-200 overflow-hidden ${deployMode === "actions" ? "border-orange-500/50 bg-orange-500/5" : "border-neutral-800 bg-neutral-900/50 hover:border-neutral-700"}`}>
                <div className="p-5 flex items-start gap-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base mt-0.5 ${deployMode === "actions" ? "bg-orange-500/20" : "bg-neutral-800"}`}>⚡</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1"><span className="font-bold text-sm">GitHub Actions</span><span className="text-[9px] font-bold uppercase tracking-wider bg-orange-500 text-black px-2 py-0.5 rounded-full">Recommended</span></div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">Builds on GitHub's servers. Near-instant deploys once set up. Reliable for all repos.</p>
                  </div>
                </div>
                {deployMode === "actions" && (
                  <div className="border-t border-orange-500/20 p-5 space-y-4" onClick={e => e.stopPropagation()}>
                    <div>
                      <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2">Setup instructions</div>
                      <ol className="text-xs text-neutral-400 space-y-1.5 list-decimal list-inside leading-relaxed">
                        <li>Add <code className="text-orange-400 bg-neutral-800 px-1 py-0.5 rounded text-[10px]">wen-deploy.yml</code> to <code className="text-orange-400 bg-neutral-800 px-1 py-0.5 rounded text-[10px]">.github/workflows/</code></li>
                        <li>Push — GitHub will build automatically</li>
                        <li>Come back and click Deploy — WEN.DEPLOY picks up the artifact</li>
                      </ol>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <a href={`data:text/yaml;charset=utf-8,${encodeURIComponent(WEN_DEPLOY_WORKFLOW)}`} download="wen-deploy.yml" className="inline-flex items-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-400 text-black font-bold text-[10px] rounded-xl transition-colors">↓ Download workflow</a>
                      <button onClick={() => navigator.clipboard.writeText(WEN_DEPLOY_WORKFLOW)} className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold text-[10px] rounded-xl transition-colors">Copy workflow</button>
                      <button onClick={() => navigator.clipboard.writeText(WEN_DEPLOY_AI_PROMPT)} className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-cyan-400 font-bold text-[10px] rounded-xl transition-colors flex items-center gap-1.5"><span>✦</span> Copy AI prompt</button>
                    </div>
                    
                    <div className="pt-4 border-t border-neutral-800 space-y-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="update-mode-actions"
                          checked={!!config.existingAsaId}
                          onChange={e => setConfig(c => ({ ...c, existingAsaId: e.target.checked ? 0 : null }))}
                          className="w-4 h-4 bg-neutral-900 border-neutral-700 rounded text-orange-500 focus:ring-orange-500/50"
                        />
                        <label htmlFor="update-mode-actions" className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Update existing deployment</label>
                      </div>

                      {config.existingAsaId !== null && (
                        <input
                          type="number"
                          placeholder="Enter ASA ID to update"
                          value={config.existingAsaId || ""}
                          onChange={e => setConfig(c => ({ ...c, existingAsaId: parseInt(e.target.value) || null }))}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-xs font-mono text-orange-400 focus:outline-none focus:ring-1 ring-orange-500/50"
                        />
                      )}
                    </div>
                    
                    <button onClick={handleDeploy} className="w-full py-3 bg-orange-500 hover:bg-orange-400 text-black font-black text-xs rounded-xl transition-all shadow-lg shadow-orange-500/10 active:scale-[0.98]">DEPLOY VIA GITHUB ACTIONS</button>
                  </div>
                )}
              </button>

              <button onClick={() => setDeployMode(deployMode === "webcontainer" ? null : "webcontainer")} className={`w-full text-left rounded-2xl border transition-all duration-200 overflow-hidden ${deployMode === "webcontainer" ? "border-neutral-600 bg-neutral-900/80" : "border-neutral-800 bg-neutral-900/30 hover:border-neutral-700"}`}>
                <div className="p-5 flex items-start gap-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base mt-0.5 ${deployMode === "webcontainer" ? "bg-neutral-700" : "bg-neutral-800/50"}`}>🌐</div>
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1"><span className="font-bold text-sm text-neutral-300">In-Browser Build</span><span className="text-[9px] font-bold uppercase tracking-wider bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-full">No setup required</span></div><p className="text-[11px] text-neutral-500 leading-relaxed">Builds your project directly in the browser using WebContainer.</p></div>
                </div>
                {deployMode === "webcontainer" && (
                  <div className="border-t border-neutral-700 p-5 space-y-4" onClick={e => e.stopPropagation()}>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="text" value={config.buildCommand} onChange={e => setConfig(c => ({ ...c, buildCommand: e.target.value }))} className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-3 py-2 text-xs font-mono" />
                      <input type="text" value={config.outputDir} onChange={e => setConfig(c => ({ ...c, outputDir: e.target.value }))} className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded-xl px-3 py-2 text-xs font-mono" />
                    </div>
                    
                    <div className="pt-2 space-y-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="update-mode-wc"
                          checked={!!config.existingAsaId}
                          onChange={e => setConfig(c => ({ ...c, existingAsaId: e.target.checked ? 0 : null }))}
                          className="w-4 h-4 bg-neutral-900 border-neutral-700 rounded text-orange-500 focus:ring-orange-500/50"
                        />
                        <label htmlFor="update-mode-wc" className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Update existing deployment</label>
                      </div>

                      {config.existingAsaId !== null && (
                        <input
                          type="number"
                          placeholder="Enter ASA ID to update"
                          value={config.existingAsaId || ""}
                          onChange={e => setConfig(c => ({ ...c, existingAsaId: parseInt(e.target.value) || null }))}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-xs font-mono text-orange-400 focus:outline-none focus:ring-1 ring-orange-500/50"
                        />
                      )}
                    </div>
                    
                    <button onClick={handleDeploy} className="w-full py-3 bg-neutral-700 hover:bg-neutral-600 text-white font-black text-xs rounded-xl transition-all active:scale-[0.98]">BUILD IN BROWSER</button>
                  </div>
                )}
              </button>
            </div>
          </div>
) : deployState.step === "complete" ? (
          <div className="bg-green-500/5 border border-green-500/20 rounded-3xl p-10 text-center space-y-6">
             <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto"><svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg></div>
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
                <div className="flex justify-between items-start mb-10 px-2">
                   {PIPELINE_STEPS.map((s, i) => {
                     const status = getStepStatus(i);
                     return (
                       <div key={i} className="flex flex-col items-center flex-1 relative group">
                         {i < PIPELINE_STEPS.length - 1 && <div className={`absolute top-4 h-[2px] ${deployState.activeStepIndex > i ? 'bg-orange-500' : 'bg-neutral-800'} transition-colors duration-500`} style={{left:'calc(50% + 1.25rem)', right:'calc(-50% + 1.25rem)'}} />}
                         <div className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${status === 'complete' ? 'bg-orange-500 border-orange-500' : status === 'active' ? 'border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]' : 'border-neutral-800 bg-neutral-900'}`}>{status === 'complete' ? <svg className="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg> : <span className={`text-[10px] font-bold ${status === 'active' ? 'text-orange-500' : 'text-neutral-600'}`}>{i + 1}</span>}</div>
                         <div className="mt-3 text-center"><div className={`text-[10px] font-black uppercase tracking-widest ${status === 'active' ? 'text-white' : 'text-neutral-500'}`}>{s.label}</div></div>
                       </div>
                     );
                   })}
                </div>
                <div className="flex items-center gap-4 mb-4"><div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" /><div className="flex-1"><div className="text-sm font-medium text-neutral-300">{deployState.message}</div></div><div className="text-xl font-black text-orange-500">{deployState.progress}%</div></div>
                <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden"><div className="h-full bg-orange-500 transition-all duration-500 ease-out" style={{ width: `${deployState.progress}%` }} /></div>
             </div>
             <div className="flex justify-center"><button onClick={() => setShowConsole(!showConsole)} className="text-[10px] font-bold text-neutral-600 hover:text-orange-500 transition-colors uppercase tracking-widest flex items-center gap-2">{showConsole ? 'Hide' : 'Show'} Build Console</button></div>
             <div className={`bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl transition-all duration-300 ${showConsole ? 'opacity-100 max-h-[400px]' : 'opacity-0 max-h-0 border-0'}`}><div ref={terminalRef} className="p-4" /></div>
          </div>
        )}
      </div>
    </div>
  );
}
