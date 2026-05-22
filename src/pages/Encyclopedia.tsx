import { Meta } from "../components/Meta";
import { TOOLS } from "../constants";
import { Link } from "react-router-dom";

export function Encyclopedia() {
  return (
    <article className="mx-auto text-white mb-20 flex flex-col items-start max-w-5xl w-full px-6 pt-12 min-h-screen">
      <Meta 
        title="Algorand Developer & Creator Encyclopedia" 
        description="A comprehensive directory and knowledge base for the Algorand blockchain. Master ARC standards, mass-minting, airdrops, and secure on-chain protocols."
      />

      <header className="mb-16 border-b border-slate-800 pb-12 w-full">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6 bg-gradient-to-r from-white via-slate-400 to-slate-600 bg-clip-text text-transparent italic">
          The Algorand Encyclopedia
        </h1>
        <p className="text-xl text-slate-400 max-w-3xl leading-relaxed">
          The definitive directory of high-performance tools, decentralized protocols, and technical standards for the Algorand ecosystem. Built for developers, creators, and professional practitioners.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
        {/* Sidebar / Quick Links */}
        <aside className="lg:col-span-1 space-y-12">
          <nav className="sticky top-24 space-y-8">
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Core Categories</h3>
              <ul className="space-y-3">
                <li><a href="#minting" className="text-sm text-slate-400 hover:text-white transition">NFT & Asset Minting</a></li>
                <li><a href="#management" className="text-sm text-slate-400 hover:text-white transition">Account Management</a></li>
                <li><a href="#distribution" className="text-sm text-slate-400 hover:text-white transition">Airdrops & Logistics</a></li>
                <li><a href="#security" className="text-sm text-slate-400 hover:text-white transition">Security & Privacy</a></li>
                <li><a href="#analytics" className="text-sm text-slate-400 hover:text-white transition">Ecosystem Analytics</a></li>
              </ul>
            </div>
            
            <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-3xl">
              <h3 className="text-xs font-bold text-white uppercase tracking-widest mb-3">Protocol Standards</h3>
              <div className="flex flex-wrap gap-2">
                {["ARC-3", "ARC-19", "ARC-59", "ARC-62", "ARC-69"].map(std => (
                  <span key={std} className="px-2 py-1 bg-slate-800 text-[10px] font-mono text-slate-300 rounded uppercase">{std}</span>
                ))}
              </div>
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="lg:col-span-2 space-y-24">
          
          {/* Section: Minting */}
          <section id="minting" className="space-y-8">
            <h2 className="text-2xl font-bold italic border-l-4 border-slate-700 pl-6 text-white">Algorand NFT & Asset Minting</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Minting on Algorand is uniquely efficient due to the protocol's low fees and instant finality. However, choosing the right metadata standard is critical for long-term utility and provenance.
            </p>
            <div className="grid grid-cols-1 gap-6">
              {TOOLS.filter(t => t.category === "creator" && !t.id.endsWith("_classic") && t.id !== "really_simple_mint" && !["arc69_collection_mint", "arc3_collection_mint", "arc19_collection_mint", "simple_batch_mint", "arc69_metadata_update", "arc19_metadata_update"].includes(t.id)).map(tool => (
                <div key={tool.id} className="group border-b border-slate-900 pb-6">
                  <Link to={tool.path} className="text-lg font-bold text-slate-200 group-hover:text-white transition block mb-2">{tool.label}</Link>
                  <p className="text-sm text-slate-500 leading-relaxed">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Management */}
          <section id="management" className="space-y-8">
            <h2 className="text-2xl font-bold italic border-l-4 border-slate-700 pl-6 text-white">Account & State Management</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Managing state on Algorand involves handling Opt-ins, Minimum Balance Requirements (MBR), and asset parameters. Professional practitioners use batch tools to optimize their account hygiene and recover locked Algos.
            </p>
            <div className="grid grid-cols-1 gap-6">
              {TOOLS.filter(t => t.category === "assets" && !["airdrop", "simple_airdrop", "simple_send", "vault_send", "bulk_claim", "wen_swap", "batch_optin", "batch_optout", "batch_destroy", "distribution_suite"].includes(t.id)).map(tool => (
                <div key={tool.id} className="group border-b border-slate-900 pb-6">
                  <Link to={tool.path} className="text-lg font-bold text-slate-200 group-hover:text-white transition block mb-2">{tool.label}</Link>
                  <p className="text-sm text-slate-500 leading-relaxed">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Distribution */}
          <section id="distribution" className="space-y-8">
            <h2 className="text-2xl font-bold italic border-l-4 border-slate-700 pl-6 text-white">Airdrops & Logistics</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Distributing rewards or inventory requires sophisticated coordination. Our tools support ARC-59 Asset Inboxes and NFD Vaults, allowing for frictionless, permissionless delivery to your community.
            </p>
            <div className="grid grid-cols-1 gap-6">
              {TOOLS.filter(t => t.category === "assets" && ["airdrop", "simple_airdrop", "simple_send", "vault_send", "bulk_claim", "wen_swap", "distribution_suite"].includes(t.id)).map(tool => (
                <div key={tool.id} className="group border-b border-slate-900 pb-6">
                  <Link to={tool.path} className="text-lg font-bold text-slate-200 group-hover:text-white transition block mb-2">{tool.label}</Link>
                  <p className="text-sm text-slate-500 leading-relaxed">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Security */}
          <section id="security" className="space-y-8">
            <h2 className="text-2xl font-bold italic border-l-4 border-slate-700 pl-6 text-white">Security & Sovereign Protocols</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Algorand provides a robust foundation for next-generation security and machine economies. From post-quantum signatures and secure P2P messaging to trustless supply chain attestation (ANCHOR) and machine-to-machine x402 API billing, we provide tools to run sovereign systems.
            </p>
            <div className="grid grid-cols-1 gap-6">
              {TOOLS.filter(t => ["post_quantum", "anchor_setup", "beacon_chat", "beacon_drop", "p2p_chat", "agent_marketplace", "wen_deploy"].includes(t.id)).map(tool => (
                <div key={tool.id} className="group border-b border-slate-900 pb-6">
                  <Link to={tool.path} className="text-lg font-bold text-slate-200 group-hover:text-white transition block mb-2">{tool.label}</Link>
                  <p className="text-sm text-slate-500 leading-relaxed">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Advanced Protocol Features (NEW) */}
          <section id="protocol-deep-dive" className="space-y-8">
            <h2 className="text-2xl font-bold italic border-l-4 border-slate-700 pl-6 text-white">Advanced Protocol Architecture</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Algorand's architecture is designed for scale and security. Beyond simple transactions, practitioners leverage advanced features like Rekeying and Multisig to build institutional-grade custody and governance systems.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl space-y-4">
                <h4 className="text-white font-bold">Rekeying (Account Continuity)</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Rekeying allows an Algorand account to change its spending key without changing its public address. This is a unique protocol-level feature that enables seamless migration from standard accounts to hardware wallets or multisig configurations while preserving the account's identity and reputation.
                </p>
              </div>
              <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl space-y-4">
                <h4 className="text-white font-bold">Multisignature Accounts</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Algorand natively supports multisig accounts with M-of-N thresholds. This is perfect for DAO governance, joint-venture wallets, and enhanced security for high-value treasury management.
                </p>
              </div>
              <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl space-y-4">
                <h4 className="text-white font-bold">Atomic Transaction Groups</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Group up to 16 transactions into a single atomic unit. If one fails, they all fail. This eliminates counterparty risk in decentralized swaps and complex multi-step interactions.
                </p>
              </div>
              <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-2xl space-y-4">
                <h4 className="text-white font-bold">Algorand Virtual Machine (AVM)</h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  The AVM is a stack-based execution environment that powers Algorand's smart contracts. It supports high-level languages like Python and TypeScript, compiling them into efficient TEAL (Transaction Execution Approval Language) bytecode.
                </p>
              </div>
            </div>
          </section>

          {/* Section: Analytics */}
          <section id="analytics" className="space-y-8">
            <h2 className="text-2xl font-bold italic border-l-4 border-slate-700 pl-6 text-white">Ecosystem Analytics</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Transparency is the hallmark of the Algorand ledger. Our analytics tools allow you to audit collections, track holder distributions, and export technical state data to CSV for professional reporting.
            </p>
            <div className="grid grid-cols-1 gap-6">
              {TOOLS.filter(t => t.category === "analytics" && t.id !== "post_quantum" && !t.hideFromLanding).map(tool => (
                <div key={tool.id} className="group border-b border-slate-900 pb-6">
                  <Link to={tool.path} className="text-lg font-bold text-slate-200 group-hover:text-white transition block mb-2">{tool.label}</Link>
                  <p className="text-sm text-slate-500 leading-relaxed">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Deep Protocol Knowledge */}
          <section className="mt-32 p-12 bg-slate-900/30 border border-slate-800 rounded-[40px] space-y-8">
            <h2 className="text-3xl font-black italic text-white uppercase tracking-tighter">Technical Glossary</h2>
            <div className="grid grid-cols-1 gap-12">
              <div className="space-y-2">
                <h4 className="text-white font-bold">Minimum Balance Requirement (MBR)</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  Every asset and smart contract interaction on Algorand requires a locked balance of Algos. For standard assets, this is 0.1A. Our "Asset Remove" tools help you recover these funds by opting out of unused assets.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-white font-bold">Atomic Transactions (tx.group)</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  Algorand supports grouping up to 16 transactions that fail or succeed as a single unit. This is the foundation of decentralized swaps and secure mass-airdrops.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-white font-bold">Box Storage</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  Box storage allows smart contracts to store unlimited amounts of data by paying a Minimum Balance Requirement (MBR) per box. This is ideal for large-scale applications like decentralized registries and complex state tracking.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-white font-bold">ARC Standards (3, 19, 69)</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  ARC-3 is the standard for immutable NFTs. ARC-69 uses transaction notes for lightweight metadata updates. ARC-19 uses the reserve address field to point to dynamic IPFS templates, enabling "evolvable" NFTs with a clear provenance trail.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-white font-bold">Inner Transactions</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  Smart contracts can issue transactions on their own behalf (e.g., sending payments, managing assets). These are called "Inner Transactions" and are the backbone of automated on-chain logic.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-white font-bold">x402 (Agentic Payments Standard)</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  An on-chain billing and authorization standard for autonomous machine-to-machine agents. Instead of Web2 API keys or credits, agents specify their fee per call (e.g. 1 ALGO) on-chain. Clients submit native payments directly to the agent's wallet, enabling true gated pay-to-access zero-infrastructure APIs.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-white font-bold">Post-Quantum Resilience</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  Falcon-1024 signatures are the next frontier in blockchain security. Algorand's State Proofs already use Falcon, and our Post-Quantum wallet brings this protection to individual accounts to defend against future quantum computing threats.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="text-white font-bold">TEAL & AVM Languages</h4>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  TEAL is the assembly-like language of the Algorand Virtual Machine. Modern developers use Python or TypeScript-based frameworks (like Puya or AlgoKit) to write high-level code that compiles directly to TEAL.
                </p>
              </div>
            </div>
          </section>

          {/* Ecosystem Connectivity */}
          <section className="mt-16 space-y-4">
            <h3 className="text-lg font-bold text-slate-200 italic">Ecosystem Connectivity</h3>
            <p className="text-xs text-slate-500 max-w-2xl">
              The wen.tools suite is part of a broader ecosystem designed to decentralize the web. For non-developer operations, visit our companion platforms:
            </p>
            <div className="flex gap-6">
              <a href="https://wallet.wen.tools" className="text-sm text-amber-400 hover:underline">Wen Wallet</a>
              <a href="https://swap.wen.tools" className="text-sm text-amber-400 hover:underline">Wen Swap</a>
            </div>
          </section>

        </main>
      </div>

      <footer className="mt-32 pt-12 border-t border-slate-800 w-full text-center">
        <p className="text-slate-600 text-xs uppercase tracking-[0.2em]">
          End of Directory — wen.tools Algorand Encyclopedia
        </p>
      </footer>
    </article>
  );
}
