import { useState } from "react";
import { IoShieldCheckmark, IoCodeSlash, IoDocumentText, IoRocket, IoCopy, IoCheckmark } from "react-icons/io5";
import { trackEvent } from "../utils";

export default function AnchorSetupTool() {
  const [wallet, setWallet] = useState("");
  const [network, setNetwork] = useState("mainnet");
  const [manager, setManager] = useState("pnpm");
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
2. **GitHub Action Integration**: Create or update a release workflow (e.g., \`.github/workflows/release.yml\`) to include the ANCHOR Action. It should run after the build but before or during the publish step.
   - Use \`loafpickleww/anchor-action@v1\` (or the equivalent CLI command).
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
        uses: LoafPickleWW/ANCHOR-Protocol@main
        with:
          mnemonic: \${{ secrets.ANCHOR_MNEMONIC }}
          network: '${network}'
          # Optional: fail_on_error: true`;

  const readmeSnippet = `## 🔒 Security & Integrity

This repository uses the **ANCHOR Protocol** to create a tamper-evident software supply chain record on the Algorand blockchain.

### Verification

You can verify the provenance of this package using the ANCHOR CLI:

\`\`\`bash
npx @loafpickleww/anchor verify <package-name> <version>
\`\`\`

Verification relies on cross-referencing metadata (wallet \`${wallet || "YOUR_WALLET_ADDRESS"}\`) with the official transparency log on Algorand.

---

*Generated via [wen.tools](https://wen.tools/anchor-setup)*`;

  return (
    <div className="mx-auto text-white mb-10 flex flex-col items-center max-w-5xl w-full px-4 min-h-screen">
      {/* Header */}
      <div className="w-full flex flex-col items-center mt-12 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-2 md:p-3 bg-amber-400 rounded-2xl shadow-lg shadow-amber-400/20">
            <IoShieldCheckmark className="text-3xl md:text-4xl text-black" />
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent">
            ANCHOR SETUP
          </h1>
        </div>
        <p className="text-slate-400 mt-4 text-lg font-medium text-center max-w-2xl">
          Secure your software supply chain in minutes. Generate the integration assets needed to enroll your repository in the ANCHOR protocol.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
        {/* Left Column: Configuration */}
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
                  {["mainnet", "testnet"].map((n) => (
                    <button
                      key={n}
                      onClick={() => setNetwork(n)}
                      className={`py-2 px-4 rounded-xl font-bold transition-all ${
                        network === n
                          ? "bg-amber-400 text-black shadow-lg shadow-amber-400/20"
                          : "bg-primary-black text-slate-400 border border-secondary-gray hover:border-slate-600"
                      }`}
                    >
                      {n.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                  Package Manager
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {["pnpm", "npm", "yarn"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setManager(m)}
                      className={`py-2 px-2 rounded-xl font-bold transition-all text-sm ${
                        manager === m
                          ? "bg-slate-200 text-black"
                          : "bg-primary-black text-slate-400 border border-secondary-gray hover:border-slate-600"
                      }`}
                    >
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-secondary-gray/50 text-xs text-slate-500 leading-relaxed italic">
              Don't have a signing wallet? Use the <a href="/vanity" className="text-amber-400 hover:underline font-bold">Vanity Address</a> tool to generate a custom identity, or use any Algorand wallet you control.
            </div>
            
            <div className="mt-4 pt-4 border-t border-secondary-gray/50 text-[10px] text-slate-600 leading-tight">
              Looking for CLI usage? Run <code className="text-slate-400">npx @loafpickleww/anchor --help</code> to see all available commands.
            </div>
          </div>
        </div>

        {/* Right Column: Assets */}
        <div className="lg:col-span-2 space-y-6">
          {/* Integration Prompt */}
          <AssetCard
            title="AI Integration Prompt"
            description="Send this to your coding agent (like Antigravity) to automate the setup."
            content={integrationPrompt}
            icon={<IoRocket className="text-purple-400" />}
            onCopy={() => handleCopy("prompt", integrationPrompt)}
            isCopied={copiedId === "prompt"}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* package.json */}
            <AssetCard
              title="package.json"
              description="Add this to your manifest."
              content={packageJsonSnippet}
              icon={<IoCodeSlash className="text-blue-400" />}
              onCopy={() => handleCopy("json", packageJsonSnippet)}
              isCopied={copiedId === "json"}
            />

            {/* GitHub Action */}
            <AssetCard
              title="GitHub Action YAML"
              description="Add to your release workflow."
              content={githubActionSnippet}
              icon={<IoRocket className="text-orange-400" />}
              onCopy={() => handleCopy("yaml", githubActionSnippet)}
              isCopied={copiedId === "yaml"}
            />
          </div>

          {/* README */}
          <AssetCard
            title="README Section"
            description="Explain the security measures to your users."
            content={readmeSnippet}
            icon={<IoDocumentText className="text-green-400" />}
            onCopy={() => handleCopy("readme", readmeSnippet)}
            isCopied={copiedId === "readme"}
          />
        </div>
      </div>
    </div>
  );
}

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
          <div className="p-2 bg-primary-black rounded-xl">
            {icon}
          </div>
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
