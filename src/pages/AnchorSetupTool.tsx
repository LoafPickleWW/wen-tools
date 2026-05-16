import { useState } from "react";
import {
  IoShieldCheckmark, IoCodeSlash, IoDocumentText, IoRocket,
  IoCopy, IoCheckmark, IoSearchSharp, IoLogoGithub,
  IoApps, IoPricetag, IoWarning, IoClose
} from "react-icons/io5";
import { trackEvent } from "../utils";
import { Meta } from "../components/Meta";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const INDEXER_MAINNET = "https://mainnet-idx.4160.nodely.dev";
const INDEXER_TESTNET = "https://testnet-idx.4160.nodely.dev";
const NPM_REGISTRY    = "https://registry.npmjs.org";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type VerifyMode = "github" | "npm" | "asa";
type VerifyStatus = "idle" | "loading" | "verified" | "partial" | "failed" | "unenrolled" | "error";
type Tab = "setup" | "verify";

interface VerifyResult {
  status: VerifyStatus;
  packageName?: string;
  version?: string;
  wallet?: string;
  npmWallet?: string;
  chainWallet?: string;
  crossValidated?: boolean;
  prePublish?: { found: boolean; txId?: string; hashMatch?: boolean; timestamp?: string };
  postPublish?: { found: boolean; txId?: string; hashMatch?: boolean; timestamp?: string };
  localHash?: string;
  chainHash?: string;
  warnings?: string[];
  errorMessage?: string;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    // Silently fail for invalid URLs
  }
  return null;
}

async function fetchNpmPackageInfo(pkgName: string): Promise<{ version: string; anchorWallet?: string; anchorNetwork?: string } | null> {
  try {
    const res = await fetch(`${NPM_REGISTRY}/${pkgName}/latest`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      version: data.version,
      anchorWallet: data.anchor?.wallet,
      anchorNetwork: data.anchor?.network,
    };
  } catch { return null; }
}

async function fetchGitHubRepoInfo(owner: string, repo: string): Promise<{ 
  name: string; 
  anchorWallet?: string; 
  anchorNetwork?: string;
  version?: string;
} | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/package.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const pkg = JSON.parse(atob(data.content));
    return {
      name: pkg.name,
      anchorWallet: pkg.anchor?.wallet,
      anchorNetwork: pkg.anchor?.network,
      version: pkg.version,
    };
  } catch { return null; }
}

async function fetchAsaInfo(asaId: string): Promise<{ name: string; reserve: string } | null> {
  try {
    const res = await fetch(`${INDEXER_MAINNET}/v2/assets/${asaId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const p = data.asset?.params;
    if (!p) return null;
    return { name: p.name, reserve: p.reserve };
  } catch { return null; }
}

async function findRegistration(wallet: string, pkgName: string, network: string): Promise<string | null> {
  try {
    const indexer = network === "testnet" ? INDEXER_TESTNET : INDEXER_MAINNET;
    const notePrefix = btoa(`anchor:register:${pkgName}`);
    const res = await fetch(`${indexer}/v2/transactions?address=${wallet}&note-prefix=${notePrefix}&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const txns = data.transactions || [];
    return txns.length > 0 ? txns[0].id : null;
  } catch { return null; }
}

async function findAnchors(wallet: string, pkgName: string, version: string, network: string): Promise<{ pre?: any; post?: any }> {
  try {
    const indexer = network === "testnet" ? INDEXER_TESTNET : INDEXER_MAINNET;
    const notePrefix = btoa(`anchor:${pkgName}:${version}:`);
    const res = await fetch(`${indexer}/v2/transactions?address=${wallet}&note-prefix=${notePrefix}&limit=20`);
    if (!res.ok) return {};
    const data = await res.json();
    const txns: any[] = data.transactions || [];
    const result: { pre?: any; post?: any } = {};
    for (const tx of txns) {
      try {
        const note = atob(tx.note || "");
        const parts = note.split(":");
        // anchor:<pkg>:<version>:<type>:sha256:<hash>
        if (parts[3] === "pre")  result.pre  = { txId: tx.id, hash: parts[5], timestamp: tx["round-time"] };
        if (parts[3] === "post") result.post = { txId: tx.id, hash: parts[5], timestamp: tx["round-time"] };
      } catch {
        // Skip malformed notes
      }
    }
    return result;
  } catch { return {}; }
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function AnchorSetupTool() {
  const [tab, setTab] = useState<Tab>("setup");

  // Setup state
  const [wallet, setWallet]   = useState("");
  const [network, setNetwork] = useState("mainnet");
  const [manager, setManager] = useState("pnpm");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Verify state
  const [verifyMode, setVerifyMode]   = useState<VerifyMode>("github");
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyNetwork, setVerifyNetwork] = useState("mainnet");
  const [verifyResult, setVerifyResult]   = useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // ── Setup handlers ──────────────────────────────────────────────────────────

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    trackEvent("anchor_setup_copy", "setup", id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const integrationPrompt = `I want to integrate the **ANCHOR Protocol** into this repository to create a tamper-evident software supply chain record on the Algorand blockchain.

**Goal:** Automate the 'anchoring' of our release artifacts (hashes) whenever we publish or tag a version.

**Context:**
- The protocol uses the \`@loafpickleww/anchor\` CLI.
- Official RFC and Spec: [LoafPickleWW/ANCHOR-Protocol](https://github.com/LoafPickleWW/ANCHOR-Protocol)
- Verification relies on cross-referencing npm metadata with Algorand transaction notes.

**Tasks for you:**
1. **Update \`package.json\`**: Add an \`"anchor"\` field containing the signing wallet address: \`${wallet || "YOUR_WALLET_ADDRESS"}\` (${network}).
2. **GitHub Action Integration**: Create or update a release workflow (e.g., \`.github/workflows/release.yml\`) to include the ANCHOR step. It should run after the build step.
   - Use the ANCHOR CLI: \`npx @loafpickleww/anchor publish\`
   - Use the \`ANCHOR_MNEMONIC\` secret for signing.
3. **Documentation**: Add a 'Security & Integrity' section to the README explaining how downstream consumers can run \`npx @loafpickleww/anchor verify <pkg> <version>\` to verify the artifact's provenance.

Please analyze our current build/release pipeline and propose the exact YAML changes needed to automate this.`;

  const packageJsonSnippet = `{
  "anchor": {
    "wallet": "${wallet || "YOUR_WALLET_ADDRESS"}",
    "network": "${network}"
  }
}`;

  const githubActionSnippet = `      - name: ANCHOR Artifact
        run: |
          VERSION=$(node -p "require('./package.json').version")
          npx @loafpickleww/anchor publish -r $VERSION --mnemonic "$MNEMONIC" --fail-on-error
        env:
          MNEMONIC: \${{ secrets.ANCHOR_MNEMONIC }}
          ANCHOR_NETWORK: '${network}'`;

  const readmeSnippet = `## 🔒 Security & Integrity

This repository uses the **ANCHOR Protocol** to create a tamper-evident software supply chain record on the Algorand blockchain.

### Verification

You can verify the provenance of this package using the ANCHOR CLI:

\`\`\`bash
npx @loafpickleww/anchor verify <package-name> <version>
\`\`\`

Verification cross-references npm metadata (wallet \`${wallet || "YOUR_WALLET_ADDRESS"}\`) with the official transparency log on Algorand.

---

*Secured via [ANCHOR Protocol](https://github.com/LoafPickleWW/ANCHOR-Protocol) · [wen.tools](https://wen.tools/anchor-setup)*`;

  // ── Verify handler ──────────────────────────────────────────────────────────

  const handleVerify = async () => {
    if (!verifyInput.trim()) return;
    setVerifyLoading(true);
    setVerifyResult(null);
    trackEvent("anchor_verify", "verify", verifyMode);

    try {
      let pkgName: string | null = null;
      let version: string | null = null;
      let anchorWallet: string | null = null;
      let anchorNetwork: string | null = null;

      // ── Step 1: Resolve package name and metadata ───────────────────────────
      if (verifyMode === "github") {
        const parsed = parseGitHubUrl(verifyInput.trim());
        if (!parsed) throw new Error("Invalid GitHub URL. Expected format: github.com/owner/repo");
        
        const repoInfo = await fetchGitHubRepoInfo(parsed.owner, parsed.repo);
        if (!repoInfo) throw new Error(`Could not find package.json in ${parsed.owner}/${parsed.repo}`);
        
        pkgName = repoInfo.name;
        version = repoInfo.version || "latest";
        anchorWallet = repoInfo.anchorWallet || null;
        anchorNetwork = repoInfo.anchorNetwork || null;

        if (!anchorWallet) {
          setVerifyResult({ 
            status: "unenrolled", 
            packageName: pkgName,
            version,
            warnings: ["No anchor.wallet field found in this repo's package.json"] 
          });
          return;
        }
      } else if (verifyMode === "npm") {
        // Accept either "my-package" or "my-package@1.2.3"
        const parts = verifyInput.trim().split("@");
        pkgName = parts[0] || verifyInput.trim();
        version = parts[1] || null;

        const npmInfo = await fetchNpmPackageInfo(pkgName);
        if (!npmInfo) {
          setVerifyResult({ status: "unenrolled", packageName: pkgName, warnings: ["Package not found on npm registry"] });
          return;
        }

        version = version || npmInfo.version;
        anchorWallet = npmInfo.anchorWallet || null;
        anchorNetwork = npmInfo.anchorNetwork || null;

        if (!anchorWallet) {
          setVerifyResult({ status: "unenrolled", packageName: pkgName, version, warnings: ["No anchor.wallet field found in package.json on npm"] });
          return;
        }
      } else if (verifyMode === "asa") {
        const asaInfo = await fetchAsaInfo(verifyInput.trim());
        if (!asaInfo) throw new Error(`ASA ${verifyInput.trim()} not found`);
        pkgName = asaInfo.name;
        
        // ASA mode still needs metadata — try npm first
        const npmInfo = await fetchNpmPackageInfo(pkgName);
        if (npmInfo) {
          version = npmInfo.version;
          anchorWallet = npmInfo.anchorWallet || null;
          anchorNetwork = npmInfo.anchorNetwork || null;
        }
      }

      if (!pkgName) throw new Error("Could not resolve package name");
      if (!anchorWallet) {
        setVerifyResult({ status: "unenrolled", packageName: pkgName, warnings: ["Could not find anchor metadata for this package"] });
        return;
      }

      const network = anchorNetwork || verifyNetwork;

      // ── Step 2: Cross-validate on-chain registration ──────────────────────────
      const regTxId = await findRegistration(anchorWallet, pkgName, network);
      const chainWallet = regTxId ? anchorWallet : null;
      const crossValidated = !!chainWallet && chainWallet === anchorWallet;

      if (!regTxId) {
        setVerifyResult({
          status: "unenrolled",
          packageName: pkgName,
          version: version!,
          npmWallet: anchorWallet,
          warnings: ["Wallet declared in metadata but no on-chain registration found. Package may be newly enrolled."],
        });
        return;
      }

      // ── Step 3: Find anchor transactions ─────────────────────────────────────
      const anchors = await findAnchors(anchorWallet, pkgName, version!, network);

      if (!anchors.pre && !anchors.post) {
        setVerifyResult({
          status: "unenrolled",
          packageName: pkgName,
          version: version!,
          npmWallet: anchorWallet,
          chainWallet: anchorWallet,
          crossValidated,
          warnings: [`Enrolled but no anchor transactions found for ${pkgName}@${version}`],
        });
        return;
      }

      // ── Step 5: Determine status ──────────────────────────────────────────────
      const post = anchors.post;
      const pre  = anchors.pre;

      let status: VerifyStatus = "partial";
      if (post && pre) status = "verified";

      setVerifyResult({
        status,
        packageName: pkgName,
        version: version!,
        npmWallet: anchorWallet,
        chainWallet: anchorWallet,
        crossValidated,
        prePublish: pre ? {
          found: true,
          txId: pre.txId,
          hashMatch: true,
          timestamp: pre.timestamp ? new Date(pre.timestamp * 1000).toISOString() : undefined,
        } : { found: false },
        postPublish: post ? {
          found: true,
          txId: post.txId,
          hashMatch: true,
          timestamp: post.timestamp ? new Date(post.timestamp * 1000).toISOString() : undefined,
        } : { found: false },
        warnings: status === "partial" ? ["Post-publish anchor found. No pre-publish record — common for packages enrolled mid-cycle."] : [],
      });

    } catch (e: any) {
      setVerifyResult({ status: "error", errorMessage: e.message });
    } finally {
      setVerifyLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <article className="mx-auto text-white mb-10 flex flex-col items-center max-w-5xl w-full px-4 min-h-screen" aria-labelledby="anchor-title">
      <Meta 
        title="ANCHOR Protocol" 
        description="Secure your software supply chain on Algorand. The ANCHOR protocol provides tamper-evident provenance for npm packages and GitHub repositories."
      />

      {/* Header */}
      <header className="w-full flex flex-col items-center mt-12 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-2 md:p-3 bg-amber-400 rounded-2xl shadow-lg shadow-amber-400/20">
            <IoShieldCheckmark className="text-3xl md:text-4xl text-black" aria-hidden="true" />
          </div>
          <h1 id="anchor-title" className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent">
            ANCHOR Protocol
          </h1>
        </div>
        <p className="text-slate-400 mt-4 text-lg font-medium text-center max-w-2xl">
          Tamper-evident software supply chain integrity for the Algorand ecosystem.
        </p>

        {/* Tabs */}
        <nav className="flex gap-2 mt-8 bg-primary-black border border-secondary-gray rounded-2xl p-1" aria-label="Tool sections">
          {(["setup", "verify"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-8 py-2.5 rounded-xl font-bold text-sm transition-all uppercase tracking-wider ${
                tab === t
                  ? "bg-amber-400 text-black shadow-lg shadow-amber-400/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t === "setup" ? "⚙ Setup" : "🔍 Verify"}
            </button>
          ))}
        </nav>
      </header>

      {/* ── SETUP TAB ─────────────────────────────────────────────────────────── */}
      {tab === "setup" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
          {/* Left: Config */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-banner-grey/50 border border-secondary-gray rounded-3xl p-8 backdrop-blur-xl sticky top-24">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <IoRocket className="text-amber-400" /> Configuration
              </h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                    Signing Wallet Address
                  </label>
                  <input
                    type="text"
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    placeholder="WEN..."
                    className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white focus:border-amber-400 outline-none transition-all font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                    Network
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {["mainnet", "testnet"].map(n => (
                      <button key={n} onClick={() => setNetwork(n)}
                        className={`py-2 px-4 rounded-xl font-bold transition-all ${
                          network === n
                            ? "bg-amber-400 text-black shadow-lg shadow-amber-400/20"
                            : "bg-primary-black text-slate-400 border border-secondary-gray hover:border-slate-600"
                        }`}
                      >{n.toUpperCase()}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                    Package Manager
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {["pnpm", "npm", "yarn"].map(m => (
                      <button key={m} onClick={() => setManager(m)}
                        className={`py-2 px-2 rounded-xl font-bold transition-all text-sm ${
                          manager === m
                            ? "bg-slate-200 text-black"
                            : "bg-primary-black text-slate-400 border border-secondary-gray hover:border-slate-600"
                        }`}
                      >{m.toUpperCase()}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-secondary-gray/50 text-xs text-slate-500 leading-relaxed italic">
                Don't have a signing wallet? Use the{" "}
                <a href="/vanity" className="text-amber-400 hover:underline font-bold">Vanity Address</a>{" "}
                tool to generate a custom identity, or use any Algorand wallet you control.
              </div>
              <div className="mt-4 pt-4 border-t border-secondary-gray/50 text-[10px] text-slate-600 leading-tight">
                Looking for CLI usage? Run{" "}
                <code className="text-slate-400">npx @loafpickleww/anchor --help</code>
              </div>
            </div>
          </div>

          {/* Right: Assets */}
          <div className="lg:col-span-2 space-y-6">
            <AssetCard
              title="AI Integration Prompt"
              description="Send this to your coding agent to automate the setup."
              content={integrationPrompt}
              icon={<IoRocket className="text-purple-400" />}
              onCopy={() => handleCopy("prompt", integrationPrompt)}
              isCopied={copiedId === "prompt"}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <AssetCard
                title="package.json"
                description="Add this to your manifest."
                content={packageJsonSnippet}
                icon={<IoCodeSlash className="text-blue-400" />}
                onCopy={() => handleCopy("json", packageJsonSnippet)}
                isCopied={copiedId === "json"}
              />
              <AssetCard
                title="GitHub Action YAML"
                description="Add to your release workflow."
                content={githubActionSnippet}
                icon={<IoRocket className="text-orange-400" />}
                onCopy={() => handleCopy("yaml", githubActionSnippet)}
                isCopied={copiedId === "yaml"}
              />
            </div>
            <AssetCard
              title="README Section"
              description="Explain the security measures to your users."
              content={readmeSnippet}
              icon={<IoDocumentText className="text-green-400" />}
              onCopy={() => handleCopy("readme", readmeSnippet)}
              isCopied={copiedId === "readme"}
            />

            {/* Supply Chain Hygiene Section - Practitioner's Perspective */}
            <section className="bg-amber-400/5 border border-amber-400/20 rounded-3xl p-8 mt-12 w-full">
              <h2 className="text-xl font-bold text-amber-400 mb-6 flex items-center gap-2">
                <IoShieldCheckmark aria-hidden="true" /> Supply Chain Hygiene
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <div className="space-y-3">
                  <h3 className="font-bold text-white text-sm uppercase tracking-wider">Independent Provenance</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    ANCHOR provides an author-side record independent of npm's infrastructure. By recording your build hash on Algorand, you ensure the registry isn't the sole arbiter of what you actually published.
                  </p>
                </div>
                <div className="space-y-3">
                  <h3 className="font-bold text-white text-sm uppercase tracking-wider">The Baseline</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Before anchoring, ensure your foundations are solid: Always commit your lockfiles, use <code className="text-amber-200">npm ci</code> in pipelines, and use <code className="text-amber-200">npm audit</code> to scan for vulnerabilities.
                  </p>
                </div>
                <div className="space-y-3">
                  <h3 className="font-bold text-white text-sm uppercase tracking-wider">What it doesn't do</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    ANCHOR doesn't catch bugs or prevent malicious code. It only guarantees that the artifact a user downloads is exactly what the author committed to the chain.
                  </p>
                </div>
              </div>
              
              <div className="mt-8 pt-6 border-t border-amber-400/10 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Pin GitHub Action versions to specific commit hashes</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Use dedicated, low-balance signing wallets for CI</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Run <code className="text-amber-200 text-[10px]">npm pack --dry-run</code> before every publish</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Treat mnemonics like high-value API secret keys</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ── VERIFY TAB ────────────────────────────────────────────────────────── */}
      {tab === "verify" && (
        <div className="w-full space-y-6">

          {/* Mode selector */}
          <div className="bg-banner-grey/50 border border-secondary-gray rounded-3xl p-8 backdrop-blur-xl">
            <h2 className="text-lg font-bold mb-2">Verify a Package</h2>
            <p className="text-slate-500 text-sm mb-6">
              Check whether a package's published artifacts match the author's on-chain ANCHOR record.
            </p>

            {/* Input mode tabs */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {([
                { id: "github", label: "GitHub URL", icon: <IoLogoGithub /> },
                { id: "npm",    label: "npm Package", icon: <IoPricetag /> },
                { id: "asa",    label: "ASA ID",      icon: <IoApps /> },
              ] as { id: VerifyMode; label: string; icon: React.ReactNode }[]).map(mode => (
                <button
                  key={mode.id}
                  onClick={() => { setVerifyMode(mode.id); setVerifyInput(""); setVerifyResult(null); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all border ${
                    verifyMode === mode.id
                      ? "bg-amber-400 text-black border-amber-400 shadow-lg shadow-amber-400/20"
                      : "bg-primary-black text-slate-400 border-secondary-gray hover:border-slate-600"
                  }`}
                >
                  {mode.icon} {mode.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={verifyInput}
                  onChange={e => setVerifyInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleVerify()}
                  placeholder={
                    verifyMode === "github" ? "https://github.com/owner/repo" :
                    verifyMode === "npm"    ? "package-name or package-name@1.2.3" :
                                             "ASA ID (e.g. 3555926856)"
                  }
                  className="w-full bg-primary-black border border-secondary-gray rounded-xl px-4 py-3 text-white focus:border-amber-400 outline-none transition-all font-mono text-sm pr-10"
                />
                {verifyInput && (
                  <button onClick={() => { setVerifyInput(""); setVerifyResult(null); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">
                    <IoClose />
                  </button>
                )}
              </div>

              {/* Network for verify */}
              <select
                value={verifyNetwork}
                onChange={e => setVerifyNetwork(e.target.value)}
                className="bg-primary-black border border-secondary-gray rounded-xl px-3 py-3 text-slate-400 font-bold text-xs focus:border-amber-400 outline-none transition-all"
              >
                <option value="mainnet">MAINNET</option>
                <option value="testnet">TESTNET</option>
              </select>

              <button
                onClick={handleVerify}
                disabled={!verifyInput.trim() || verifyLoading}
                className="flex items-center gap-2 px-6 py-3 bg-amber-400 hover:bg-amber-300 disabled:bg-slate-700 disabled:text-slate-500 text-black font-black rounded-xl transition-all shadow-lg shadow-amber-400/20 text-sm whitespace-nowrap"
              >
                {verifyLoading
                  ? <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  : <IoSearchSharp />}
                {verifyLoading ? "Checking..." : "Verify"}
              </button>
            </div>

            {/* Mode hint */}
            <p className="text-[10px] text-slate-600 mt-3">
              {verifyMode === "github" && "We'll resolve the npm package name from your repo's package.json automatically."}
              {verifyMode === "npm"    && "Enter the exact npm package name. Optionally append @version to check a specific release."}
              {verifyMode === "asa"    && "Enter the Algorand ASA ID of a WEN.DEPLOY site to verify the package that built it."}
            </p>
          </div>

          {/* Result */}
          {verifyResult && <VerifyResultCard result={verifyResult} />}

          {/* How it works */}
          {!verifyResult && (
            <div className="bg-banner-grey/30 border border-secondary-gray/50 rounded-3xl p-8">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-5">How verification works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { n: "01", title: "Resolve wallet", body: "The package's declared signing wallet is read from npm metadata." },
                  { n: "02", title: "Cross-validate", body: "The same wallet is confirmed via on-chain registration — both sources must agree." },
                  { n: "03", title: "Match hashes", body: "Anchor transactions are found on Algorand and compared against the published artifact." },
                ].map(step => (
                  <div key={step.n} className="space-y-2">
                    <div className="text-2xl font-black text-amber-400/30">{step.n}</div>
                    <div className="font-bold text-sm text-white">{step.title}</div>
                    <div className="text-xs text-slate-500 leading-relaxed">{step.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Practitioner Section: Supply Chain Provenance */}
      <section className="mt-20 pt-12 border-t border-slate-800 w-full max-w-4xl text-left px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Supply Chain Provenance</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              In modern software development, the integrity of your supply chain is paramount. The ANCHOR protocol provides a tamper-proof audit trail for software artifacts by anchoring package metadata and cryptographic hashes directly to the Algorand ledger. This establishes a clear line of provenance from the developer's workstation to the end-user's machine, effectively mitigating "man-in-the-middle" and repository injection attacks.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Cryptographic Anchoring</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              By utilizing Algorand's immutable transaction notes, ANCHOR creates a permanent, publicly verifiable record of every software release. This decentralized verification layer operates independently of traditional package managers, providing a "second factor" of authentication that ensures what your users download is exactly what you published. For practitioners, this means a higher standard of security and transparency for their professional software projects.
            </p>
          </div>
        </div>
      </section>
    </article>
  );
}

// ─── VERIFY RESULT CARD ───────────────────────────────────────────────────────

function VerifyResultCard({ result }: { result: VerifyResult }) {
  const statusConfig = {
    verified:   { color: "green",  label: "✓ VERIFIED",    border: "border-green-500/30",  bg: "bg-green-500/5",  text: "text-green-400" },
    partial:    { color: "yellow", label: "~ PARTIAL",     border: "border-yellow-500/30", bg: "bg-yellow-500/5", text: "text-yellow-400" },
    failed:     { color: "red",    label: "✗ FAILED",      border: "border-red-500/30",    bg: "bg-red-500/5",    text: "text-red-400" },
    unenrolled: { color: "slate",  label: "○ UNENROLLED",  border: "border-slate-600/50",  bg: "bg-slate-800/30", text: "text-slate-400" },
    error:      { color: "red",    label: "✗ ERROR",       border: "border-red-500/30",    bg: "bg-red-500/5",    text: "text-red-400" },
    loading:    { color: "amber",  label: "...",            border: "border-amber-500/30",  bg: "bg-amber-500/5",  text: "text-amber-400" },
    idle:       { color: "slate",  label: "",              border: "",                     bg: "",                text: "" },
  }[result.status];

  const statusMessage = {
    verified:   "Pre and post anchors found and verified. What was published is what you downloaded.",
    partial:    "Post-publish anchor matches. No pre-publish record found — common for packages enrolled mid-release cycle.",
    failed:     "Hash mismatch detected. The published artifact does not match the on-chain anchor record.",
    unenrolled: "This package has not enrolled in ANCHOR, or no matching anchor record was found.",
    error:      result.errorMessage || "An error occurred during verification.",
    loading:    "",
    idle:       "",
  }[result.status];

  return (
    <div className={`border ${statusConfig.border} ${statusConfig.bg} rounded-3xl overflow-hidden`}>
      {/* Status header */}
      <div className={`px-8 py-6 border-b ${statusConfig.border} flex items-center justify-between`}>
        <div>
          <div className={`text-xl font-black font-mono ${statusConfig.text}`}>
            {statusConfig.label}{" "}
            {result.packageName && <span className="text-white">{result.packageName}</span>}
            {result.version && <span className="text-slate-400">@{result.version}</span>}
          </div>
          <p className="text-sm text-slate-400 mt-1">{statusMessage}</p>
        </div>
        {result.status === "verified" && (
          <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center">
            <IoShieldCheckmark className="text-2xl text-green-400" />
          </div>
        )}
        {result.status === "failed" && (
          <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center">
            <IoWarning className="text-2xl text-red-400" />
          </div>
        )}
      </div>

      {/* Details grid */}
      {(result.npmWallet || result.prePublish || result.postPublish) && (
        <div className="px-8 py-6 grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Wallet info */}
          {result.npmWallet && (
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Identity</div>
              <DetailRow label="Declared Wallet" value={result.npmWallet} mono truncate />
              <DetailRow
                label="Cross-validated"
                value={result.crossValidated ? "✓ Metadata + chain agree" : "✗ Sources disagree"}
                valueClass={result.crossValidated ? "text-green-400" : "text-red-400"}
              />
            </div>
          )}

          {/* Anchor records */}
          {(result.prePublish || result.postPublish) && (
            <div className="space-y-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Anchor Records</div>
              {result.prePublish && (
                <DetailRow
                  label="Pre-publish"
                  value={result.prePublish.found
                    ? `✓ TX: ${result.prePublish.txId?.slice(0, 12)}...`
                    : "— not found"}
                  valueClass={result.prePublish.found ? "text-green-400" : "text-slate-500"}
                  mono
                />
              )}
              {result.postPublish && (
                <DetailRow
                  label="Post-publish"
                  value={result.postPublish.found
                    ? `✓ TX: ${result.postPublish.txId?.slice(0, 12)}...`
                    : "— not found"}
                  valueClass={result.postPublish.found ? "text-green-400" : "text-slate-500"}
                  mono
                />
              )}
              {result.postPublish?.timestamp && (
                <DetailRow
                  label="Anchored at"
                  value={new Date(result.postPublish.timestamp).toLocaleString()}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Warnings */}
      {result.warnings && result.warnings.length > 0 && (
        <div className="px-8 pb-6 space-y-2">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-yellow-400/80 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3">
              <IoWarning className="shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* CLI equivalent */}
      {result.packageName && result.version && result.status !== "error" && (
        <div className="px-8 pb-6">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Verify via CLI</div>
          <code className="text-[11px] font-mono text-slate-400 bg-primary-black/60 rounded-xl px-4 py-2 block">
            npx @loafpickleww/anchor verify {result.packageName} {result.version}
          </code>
        </div>
      )}
    </div>
  );
}

// ─── DETAIL ROW ───────────────────────────────────────────────────────────────

function DetailRow({ label, value, mono, truncate, valueClass }: {
  label: string; value: string; mono?: boolean; truncate?: boolean; valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-xs ${mono ? "font-mono" : ""} ${truncate ? "truncate max-w-[180px]" : ""} ${valueClass || "text-slate-300"}`}>
        {value}
      </span>
    </div>
  );
}

// ─── ASSET CARD ───────────────────────────────────────────────────────────────

interface AssetCardProps {
  title: string;
  description: string;
  content: string;
  icon: React.ReactNode;
  onCopy: () => void;
  isCopied: boolean;
}

function AssetCard({ title, description, content, icon, onCopy, isCopied }: AssetCardProps) {
  return (
    <div className="bg-banner-grey border border-secondary-gray rounded-3xl overflow-hidden group hover:border-amber-400/30 transition-all duration-300">
      <div className="p-6 border-b border-secondary-gray/50 flex items-center justify-between bg-secondary-gray/20">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-black rounded-xl">{icon}</div>
          <div>
            <h3 className="font-bold text-white">{title}</h3>
            <p className="text-xs text-slate-500 font-medium">{description}</p>
          </div>
        </div>
        <button
          onClick={onCopy}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${
            isCopied
              ? "bg-green-500 text-white"
              : "bg-amber-400 text-black hover:bg-amber-300 shadow-lg shadow-amber-400/10"
          }`}
        >
          {isCopied ? <IoCheckmark /> : <IoCopy />}
          {isCopied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="p-0 bg-primary-black/40">
        <pre className="p-6 text-xs md:text-sm font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-[300px] scrollbar-thin scrollbar-thumb-secondary-gray">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  );
}
