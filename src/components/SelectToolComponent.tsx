import { useState, useMemo, useEffect, useRef, type MouseEvent } from "react";
import { Reticle } from "./cypher/Reticle";
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
      "Auto-detect Collection Data Downloader (CSV export)",
      "Import NFTs from other chains (XRP Ledger, etc.)"
    ],
    icon: "/icons/mint.png",
    path: "/minting-journey"
  },
  {
    id: "analytics",
    label: "Wallets & Analytics",
    description: "Advanced account cryptography and portfolio analysis tools. Snapshot holdings across multiple assets and generate vanity addresses.",
    features: [
      "Wen Wallet (Visual explorer & bulk send/opt-in/opt-out/destroy)",
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

/**
 * Renders a monochrome icon asset filled with the theme gradient, so tool
 * icons re-color along with the active theme.
 */
function ToolIcon({ src, size = "h-11 w-11" }: { src: string; size?: string }) {
  return (
    <span
      className={`${size} relative grid shrink-0 place-items-center rounded-xl border border-primary-orange/20 bg-primary-orange/10 transition duration-300 group-hover:scale-105 group-hover:border-primary-orange/40`}
    >
      <span
        aria-hidden="true"
        className="h-[55%] w-[55%]"
        style={{
          background: "linear-gradient(135deg, rgb(var(--brand)), rgb(var(--brand-2)))",
          WebkitMask: `url(${src}) center / contain no-repeat`,
          mask: `url(${src}) center / contain no-repeat`,
        }}
      />
    </span>
  );
}

/** Tracks the cursor so a card can draw a soft spotlight under it. */
function trackSpotlight(e: MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

const Spotlight = () => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
    style={{
      background:
        "radial-gradient(360px circle at var(--mx, 50%) var(--my, 0%), rgb(var(--brand) / 0.12), transparent 60%)",
    }}
  />
);

function ToolCard({ tool, index }: { tool: any; index: number }) {
  return (
    <Link
      to={tool.path}
      onMouseMove={trackSpotlight}
      className="button-link group animate-fade-in relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50 p-5 text-left backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-primary-orange/30 hover:bg-banner-grey/80"
      style={{ animationDelay: `${Math.min(index * 30, 360)}ms` }}
      onClick={() => trackEvent("tool_click", "home", tool.label)}
      aria-label={`Open ${tool.label}: ${tool.description}`}
    >
      <Spotlight />
      <Reticle />
      <div className="relative flex items-start justify-between">
        <ToolIcon src={tool.icon} />
        <span className="font-mono text-[11px] text-slate-600 transition group-hover:text-primary-orange">
          [{String(index + 1).padStart(2, "0")}]
        </span>
      </div>
      <h3 className="relative mt-4 font-display text-lg font-semibold tracking-tight text-white">
        {tool.label}
      </h3>
      <p className="relative mt-1.5 flex-1 text-sm leading-relaxed text-slate-400">
        {tool.description}
      </p>
      <div className="relative mt-5 flex items-center justify-between border-t border-dashed border-white/[0.08] pt-3 font-mono text-[11px] text-slate-500">
        <span className="truncate transition group-hover:text-slate-300">~{tool.path}</span>
        <span className="text-primary-orange opacity-0 transition duration-300 group-hover:translate-x-0.5 group-hover:opacity-100">
          run →
        </span>
      </div>
    </Link>
  );
}

function SectionHeading({ index, eyebrow, title, count }: { index?: number; eyebrow: string; title: string; count?: number }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <p className="wt-label mb-3">
          ( {index !== undefined ? String(index).padStart(2, "0") + " " : ""}{eyebrow} )
        </p>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-white md:text-3xl">
          {title}
        </h2>
      </div>
      {count !== undefined && (
        <span className="font-mono text-xs text-slate-500">{count} tools</span>
      )}
    </div>
  );
}

const FEATURED_TOOL_LABELS = [
  "Creator Suite",
  "Distribution Suite",
  "Bulk Asset Manager",
  "Agent Marketplace",
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

  // Suites live on "/" as ?suite=, so the route-level ScrollToTop never fires.
  // Opening a suite starts at the top; leaving one returns to the suite list.
  const prevSuite = useRef(selectedSuiteId);
  useEffect(() => {
    const prev = prevSuite.current;
    prevSuite.current = selectedSuiteId;
    if (prev === selectedSuiteId) return;
    if (selectedSuiteId) {
      window.scrollTo({ top: 0 });
    } else if (prev) {
      requestAnimationFrame(() =>
        document.getElementById("tool-suites")?.scrollIntoView({ block: "start" })
      );
    }
  }, [selectedSuiteId]);

  const activeSuite = useMemo(() => {
    return SUITES.find(s => s.id === selectedSuiteId);
  }, [selectedSuiteId]);

  const suiteTools = useMemo(() => {
    if (!selectedSuiteId) return [];
    return TOOLS.filter(t => !t.hideFromLanding && t.category === selectedSuiteId);
  }, [selectedSuiteId]);

  return (
    <main id="tools" className={`mx-auto w-full max-w-7xl scroll-mt-24 px-4 text-center ${activeSuite ? "pt-8" : ""}`} aria-label="Algorand Tool Discovery">
      {/* Search */}
      <div className={activeSuite ? "hidden" : "-mt-2 mb-10"}>
        <ToolSearch query={searchQuery} setQuery={setSearchQuery} />
      </div>

      {/* Tools Listing */}
      <div className="min-h-[400px]">
        {searchQuery ? (
          <div className="animate-fade-in text-left">
            <p className="mb-6 text-sm text-slate-400">
              <span className="font-semibold text-white">{filteredTools.length}</span>{" "}
              {filteredTools.length === 1 ? "tool matches" : "tools match"} “{searchQuery}”
            </p>
            <div className="mb-12 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredTools.map((tool, index) => (
                <ToolCard key={tool.id} tool={tool} index={index} />
              ))}
            </div>
            {filteredTools.length === 0 && (
              <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-20 text-center">
                <p className="font-display text-xl text-slate-300">Nothing matches that search.</p>
                <button
                  onClick={() => setSearchQuery("")}
                  className="wt-btn wt-btn-ghost"
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
              className="wt-btn wt-btn-ghost mb-6 text-xs"
            >
              ← Back to discovery
            </button>

            <div className="relative mb-8 overflow-hidden rounded-3xl border border-white/[0.07] bg-banner-grey/50 p-6 backdrop-blur md:p-8">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: "radial-gradient(40rem 16rem at 0% 0%, rgb(var(--brand) / 0.12), transparent 70%)" }}
              />
              <div className="relative flex items-start gap-5">
                <ToolIcon src={activeSuite.icon} size="h-14 w-14" />
                <div>
                  <h2 className="font-display text-3xl font-semibold tracking-tight text-white">
                    {activeSuite.label}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
                    {activeSuite.description}
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-20 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {suiteTools.map((tool, index) => (
                <ToolCard key={tool.id} tool={tool} index={index} />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-20">
            {/* Featured Tools Section */}
            <section className="animate-fade-in text-left">
              <SectionHeading index={1} eyebrow="start here" title="Featured tools" />
              <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {featuredTools.map((tool, index) => (
                  <ToolCard key={tool.id} tool={tool} index={index} />
                ))}
              </div>
            </section>

            {/* Sponsored slot. Add entries to rotate more ads. */}
            <section className="animate-fade-in mx-auto max-w-3xl" aria-label="Sponsored">
              <div className="relative flex items-center justify-center rounded-3xl border border-white/[0.07] bg-banner-grey/40 px-6 pb-3 pt-8 backdrop-blur transition hover:border-white/15">
                <span className="wt-label absolute left-5 top-4 !text-slate-600">( sponsored )</span>
                <CarouselComponent
                  images={[{ path: "./AEwebp.webp", url: "https://astroexplorer.co/" }]}
                />
              </div>
            </section>

            {/* Tool Suites Section */}
            <section id="tool-suites" className="animate-fade-in scroll-mt-24 text-left">
              <SectionHeading index={2} eyebrow="everything else" title="Tool suites" />
              <div className="mb-20 grid gap-3 md:grid-cols-2">
                {SUITES.map((suite, i) => {
                  const cardContent = (
                    <>
                      <Spotlight />
                      <Reticle />
                      <div className="relative flex items-start gap-4">
                        <ToolIcon src={suite.icon} size="h-12 w-12" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="font-display text-xl font-semibold tracking-tight text-white">
                              {suite.label}
                            </h3>
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-primary-orange opacity-60 transition duration-300 group-hover:translate-x-1 group-hover:opacity-100">
                              <span className="hidden sm:inline">Open</span>
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M9 5l7 7-7 7" />
                              </svg>
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                            {suite.description}
                          </p>
                          <ul className="mt-4 flex flex-wrap gap-1.5">
                            {suite.features.map((feat, j) => (
                              <li key={j} className="rounded-lg border border-white/[0.06] bg-primary-black/40 px-2.5 py-1 text-[11px] text-slate-400">
                                {feat}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </>
                  );

                  const cardClasses = `button-link group relative block w-full overflow-hidden rounded-3xl [--wt-r:24px] border border-white/[0.07] bg-banner-grey/50 p-6 text-left backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-primary-orange/30 hover:bg-banner-grey/80 ${
                    i === SUITES.length - 1 && SUITES.length % 2 === 1 ? "md:col-span-2" : ""
                  }`;

                  if (suite.path) {
                    return (
                      <Link
                        key={suite.id}
                        to={suite.path}
                        onMouseMove={trackSpotlight}
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
                      onMouseMove={trackSpotlight}
                      className={cardClasses}
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
