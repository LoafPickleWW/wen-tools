import { useState, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TOOLS } from "../constants";
import CarouselComponent from "./CarouselComponent";
import { ToolSearch } from "./ToolSearch";
import { trackEvent } from "../utils";

const SUITES = [
  {
    id: "assets",
    label: "Asset Suite",
    description: "Manage, control, and distribute your Algorand assets in bulk. Enforces ARC-62 supply controls, dynamic freeze/clawback rules, vault security, and multi-recipient token airdrops.",
    features: [
      "Bulk Asset Manager (Opt-in, opt-out, destroy)",
      "Batch Freeze & Clawback control parameters",
      "Token supply management using ARC-62 standard",
      "Secure Vault & NFD Transfers",
      "Simple & Coordinated Bulk Token Airdrops"
    ],
    icon: "/icons/manager.png"
  },
  {
    id: "creator",
    label: "Creator Suite",
    description: "End-to-end workspace for artwork generation and smart contract deployment. Mint collections in ARC-3, ARC-19, or ARC-69 formats and perform metadata audits.",
    features: [
      "Layered artwork & metadata generator (WenPad)",
      "Simple single-asset & bulk-collection minter",
      "Collection metadata updater (individual or CSV bulk)",
      "Auto-detect Collection Data Downloader (CSV export)"
    ],
    icon: "/icons/mint.png",
    path: "/minting-journey"
  },
  {
    id: "analytics",
    label: "Wallets & Analytics",
    description: "Advanced account cryptography and portfolio analysis tools. Snapshot holdings across multiple assets and generate vanity addresses.",
    features: [
      "Falcon-1024 Post-Quantum secured account creator",
      "Holdings Auditor (Wallet holdings & asset distribution)",
      "Vanity address generator for custom prefixes"
    ],
    icon: "/icons/pqwallet.png"
  },
  {
    id: "apps",
    label: "Apps & Social",
    description: "Decentralized social tools, encrypted communications, and community applications built natively on Algorand.",
    features: [
      "End-to-end encrypted peer-to-peer chat",
      "BEACON chat with serverless signaling",
      "Serverless BEACON dead drop",
      "Music NFT Jukebox player",
      "xGov governance proposal bulk voting tracker"
    ],
    icon: "/icons/p2pchat.svg"
  },
  {
    id: "protocols",
    label: "Protocols",
    description: "Developer integration pipelines and automated deployment configurations for GitHub Actions and the ANCHOR protocol.",
    features: [
      "GitHub to IPFS deployment pipeline (Wen Deploy)",
      "ANCHOR protocol integration & agent setup"
    ],
    icon: "/icons/devtools.png"
  }
];

function ToolCard({ tool, index }: { tool: any; index: number }) {
  return (
    <Link 
      to={tool.path} 
      className="animate-fade-in"
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={() => trackEvent("tool_click", "home", tool.label)}
      aria-label={`Open ${tool.label}: ${tool.description}`}
    >
      <div className="button-link group relative flex flex-col h-full rounded-[36px] bg-banner-grey p-2.5 text-center transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-secondary-gray border border-transparent hover:border-amber-400/30">
        <div className="relative flex items-center mb-[50px] w-full h-[70px] rounded-t-[28px] bg-gradient-to-r from-[#E4E808] to-[#FD941D]">
          <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <div className="relative flex items-center justify-center w-20 h-20 text-center rounded-full bg-[#262626] flex-shrink-0 border-transparent bg-gradient-to-r from-yellow-400 to-orange-400 p-1 ">
              <div className="flex items-center justify-center w-full h-full rounded-full bg-[#262626]">
                <img
                  src={tool.icon}
                  alt="icon"
                  className="w-[70%] h-[70%] invert-[0.9] group-hover:scale-110 transition-transform"
                />
              </div>
            </div>
          </div>
        </div>
        <h5 className="text-xl xl:text-2xl font-bold text-white group-hover:text-amber-400 transition-colors">
          {tool.label}
        </h5>
        <p className="text-sm xl:text-base font-light text-slate-300 p-2 mt-2 leading-relaxed">
          {tool.description}
        </p>
      </div>
    </Link>
  );
}

const FEATURED_TOOL_LABELS = [
  "Creator Suite",
  "Bulk Asset Manager",
  "Agent Marketplace",
  "Post-Quantum Wallet",
];

export function SelectToolComponent() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSuiteId = searchParams.get("suite");

  const featuredTools = useMemo(() => {
    return TOOLS.filter(t => FEATURED_TOOL_LABELS.includes(t.label));
  }, []);

  const filteredTools = useMemo(() => {
    const tools = TOOLS.filter(t => !t.hideFromLanding);
    if (!searchQuery) return tools;
    
    const query = searchQuery.toLowerCase();
    return tools.filter(
      (t) =>
        t.label.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const activeSuite = useMemo(() => {
    return SUITES.find(s => s.id === selectedSuiteId);
  }, [selectedSuiteId]);

  const suiteTools = useMemo(() => {
    if (!selectedSuiteId) return [];
    return TOOLS.filter(t => !t.hideFromLanding && t.category === selectedSuiteId);
  }, [selectedSuiteId]);

  return (
    <main className="text-center w-full max-w-7xl mx-auto px-4" aria-label="Algorand Tool Discovery">
      {/* Carousels Section */}
      <div className="mx-auto my-4 md:my-8">
        <div className="flex flex-col lg:flex-row items-center justify-center lg:gap-8 gap-6">
          <CarouselComponent
            images={[
              { path: "./wenwallet.png", url: "https://wallet.wen.tools" },
            ]}
          />
          <CarouselComponent
            images={[
              { path: "./AEwebp.webp", url: "https://astroexplorer.co/" },
            ]}
          />
        </div>
      </div>

      {/* Navigation & Search */}
      <div className="sticky top-[64px] md:top-[72px] z-20 bg-primary-black/80 backdrop-blur-md py-4 mb-10 border-b border-secondary-gray/30 shadow-xl shadow-black/20">
        <ToolSearch query={searchQuery} setQuery={setSearchQuery} />
      </div>

      {/* Tools Listing */}
      <div className="min-h-[400px]">
        {searchQuery ? (
          <div className="animate-fade-in">
            <h2 className="text-xl text-slate-400 mb-8 text-left">
              Found {filteredTools.length} tools matching "{searchQuery}"
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch mb-12">
              {filteredTools.map((tool, index) => (
                <ToolCard key={tool.id} tool={tool} index={index} />
              ))}
            </div>
            {filteredTools.length === 0 && (
              <div className="text-center py-20">
                <p className="text-2xl text-slate-500">No tools found matching your search.</p>
                <button 
                  onClick={() => setSearchQuery("")}
                  className="mt-4 text-amber-400 hover:underline font-semibold"
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        ) : activeSuite ? (
          <div className="animate-fade-in text-left">
            <button 
              onClick={() => setSearchParams({})}
              className="mb-8 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-gray-200 border border-slate-800 rounded-xl transition flex items-center gap-2 font-bold text-xs shadow-md"
            >
              ← Back to Discovery
            </button>
            
            <div className="mb-10 bg-slate-900/40 border border-slate-800/80 p-6 md:p-8 rounded-3xl backdrop-blur-md">
              <h2 className="text-3xl font-black italic uppercase tracking-tight text-white mb-2 bg-gradient-to-r from-white to-slate-500 bg-clip-text text-transparent">
                {activeSuite.label}
              </h2>
              <p className="text-slate-300 text-sm leading-relaxed">
                {activeSuite.description}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch mb-20">
              {suiteTools.map((tool, index) => (
                <ToolCard key={tool.id} tool={tool} index={index} />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-16">
            {/* Featured Tools Section */}
            <section className="text-left animate-fade-in">
              <h2 className="text-2xl font-black italic uppercase tracking-tight text-white mb-6 border-l-4 border-amber-400 pl-4 bg-gradient-to-r from-white to-slate-500 bg-clip-text text-transparent">
                Featured Tools
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
                {featuredTools.map((tool, index) => (
                  <ToolCard key={tool.id} tool={tool} index={index} />
                ))}
              </div>
            </section>

            {/* Tool Suites Section */}
            <section className="text-left animate-fade-in">
              <h2 className="text-2xl font-black italic uppercase tracking-tight text-white mb-6 border-l-4 border-amber-400 pl-4 bg-gradient-to-r from-white to-slate-500 bg-clip-text text-transparent">
                Tool Suites
              </h2>
              <div className="space-y-6 mb-20 max-w-6xl mx-auto">
                {SUITES.map((suite) => {
                  const cardContent = (
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex flex-col md:flex-row md:items-start gap-6 flex-grow">
                        {/* Icon */}
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 p-0.5 flex-shrink-0 shadow-lg shadow-orange-500/10">
                          <div className="w-full h-full rounded-[14px] bg-[#1a1a1a] flex items-center justify-center">
                            <img 
                              src={suite.icon} 
                              alt={suite.label} 
                              className="w-[60%] h-[60%] object-contain invert"
                            />
                          </div>
                        </div>
                        {/* Details */}
                        <div className="space-y-2 max-w-4xl">
                          <h3 className="text-2xl font-black italic uppercase tracking-tight text-white group-hover:text-amber-400 transition-colors">
                            {suite.label}
                          </h3>
                          <p className="text-slate-300 text-sm leading-relaxed">
                            {suite.description}
                          </p>
                          <div className="flex flex-wrap gap-2 pt-2">
                            {suite.features.map((feat, i) => (
                              <span key={i} className="text-slate-400 text-xs flex items-center gap-1.5 bg-slate-950/40 px-3 py-1 rounded-xl border border-slate-800/40">
                                <span className="text-amber-400 font-bold">•</span>
                                {feat}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      {/* Arrow Indicator */}
                      <div className="flex-shrink-0 self-end md:self-center flex items-center gap-2 text-amber-400 font-bold group-hover:translate-x-2 transition-transform duration-300">
                        <span className="text-xs uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">Launch Suite</span>
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  );

                  const cardClasses = "block w-full bg-slate-900/60 border border-slate-800/60 hover:border-amber-400/40 hover:bg-secondary-gray/40 rounded-3xl p-6 md:p-8 transition-all duration-300 shadow-2xl group cursor-pointer hover:scale-[1.01]";

                  if (suite.path) {
                    return (
                      <Link 
                        key={suite.id}
                        to={suite.path}
                        className={cardClasses}
                      >
                        {cardContent}
                      </Link>
                    );
                  }

                  return (
                    <button 
                      key={suite.id}
                      onClick={() => setSearchParams({ suite: suite.id })}
                      className={`${cardClasses} text-left`}
                    >
                      {cardContent}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
