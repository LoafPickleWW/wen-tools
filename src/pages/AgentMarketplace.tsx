import { useState, useEffect, useCallback } from "react";
import { useWallet, NetworkId } from "@txnlab/use-wallet-react";
import { useAtom } from "jotai";
import { IoSparkles, IoAdd, IoGlobe, IoShieldCheckmark } from "react-icons/io5";
import { toast } from "react-toastify";
import { Meta } from "../components/Meta";
import { AgentCard } from "../components/agents/AgentCard";
import { AgentFilters } from "../components/agents/AgentFilters";
import { AddListingModal } from "../components/agents/AddListingModal";
import { SmartContractViewer } from "../components/agents/SmartContractViewer";
import { AgentSnippets } from "../components/agents/AgentSnippets";
import { TestAgentModal } from "../components/agents/TestAgentModal";
import { agentListingsAtom, agentListingsLoadingAtom } from "../atoms/agentAtoms";
import {
  getAllListings,
  buildDeleteListingTxns,
} from "../utils/agentContract";
import type { AgentListing } from "../types/agent";
import { trackEvent } from "../utils";

export default function AgentMarketplace() {
  const { activeAddress, signTransactions, algodClient, activeNetwork } = useWallet();
  const [listings, setListings] = useAtom(agentListingsAtom);
  const [loading, setLoading] = useAtom(agentListingsLoadingAtom);

  // Network toggle
  const [network, setNetwork] = useState<NetworkId>(NetworkId.MAINNET);

  // Sync network with wallet active network
  useEffect(() => {
    if (activeNetwork) {
      setNetwork(activeNetwork);
    }
  }, [activeNetwork]);

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editListing, setEditListing] = useState<AgentListing | null>(null);


  // Test modal state
  const [testListing, setTestListing] = useState<AgentListing | null>(null);

  // ── Fetch listings ─────────────────────────────────────────────────────────

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllListings(network);
      setListings(data);
    } catch (err) {
      console.error("Failed to fetch agent listings:", err);
    } finally {
      setLoading(false);
    }
  }, [network, setListings, setLoading]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);


  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAddClick = () => {
    setEditListing(null);
    setModalOpen(true);
    trackEvent("agent_marketplace_click", "marketplace", "open_modal");
  };

  const handleEdit = (listing: AgentListing) => {
    setEditListing(listing);
    setModalOpen(true);
    trackEvent("agent_marketplace_click", "marketplace", "edit_listing");
  };

  const handleDelete = async (listing: AgentListing) => {
    if (!activeAddress) return;
    if (!confirm("Delete this listing? This will destroy the child contract and remove the registry entry. Your MBR will be refunded.")) return;

    try {
      const txns = await buildDeleteListingTxns(listing.appId, listing.nonce, activeAddress, network);
      const signed = await signTransactions(txns);
      const validTxns = signed.filter((s): s is Uint8Array => s !== null);
      if (validTxns.length > 0) {
        await algodClient.sendRawTransaction(validTxns).do();
      }
      toast.success("Listing deleted and MBR reclaimed");
      trackEvent("agent_marketplace_delete", "marketplace", listing.name);
      fetchListings();
    } catch (err: any) {
      console.error("Delete listing error:", err);
      toast.error(err.message || "Failed to delete listing");
    }
  };

  const handleSuccess = () => {
    fetchListings();
    trackEvent("agent_marketplace_success", "marketplace", editListing ? "update" : "create");
  };

  // ── Filtered listings ──────────────────────────────────────────────────────

  const filtered = listings.filter((l) => {
    const matchesSearch =
      !search ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.description.toLowerCase().includes(search.toLowerCase());
    const matchesCat = !category || l.category.toLowerCase() === category.toLowerCase();
    return matchesSearch && matchesCat;
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-primary-black pt-2 flex justify-center flex-col text-white">
      <Meta
        title="Agent Marketplace"
        description="Discover and register AI agents on the Algorand blockchain. The decentralized, on-chain registry for the agent economy."
      />

      <article className="mx-auto text-white mb-10 flex flex-col items-center max-w-6xl w-full px-4 min-h-screen">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <header className="w-full flex flex-col items-center mt-12 mb-10">
          <div className="flex items-center gap-4">
            <div className="p-2 md:p-3 bg-orange-500 rounded-2xl shadow-lg shadow-orange-500/20">
              <IoSparkles className="text-3xl md:text-4xl text-black" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-orange-300 via-orange-500 to-red-500 bg-clip-text text-transparent">
              Agent Marketplace
            </h1>
          </div>
          <p className="text-neutral-500 mt-4 text-lg font-medium text-center max-w-2xl">
            Discover and register AI agents on-chain. The decentralized registry for Algorand's agent economy.
          </p>

          {/* Network toggle */}
          <div className="flex gap-2 mt-6">
            {([NetworkId.MAINNET, NetworkId.TESTNET] as const).map((n) => (
              <button
                key={n}
                onClick={() => setNetwork(n)}
                className={`px-6 py-2 rounded-xl font-bold text-sm transition-all uppercase tracking-wider ${
                  network === n
                    ? "bg-orange-500 text-black shadow-lg shadow-orange-500/20"
                    : "bg-primary-black text-neutral-500 border border-secondary-gray hover:border-neutral-600"
                }`}
              >
                {n === NetworkId.TESTNET ? "TESTNET" : "MAINNET"}
              </button>
            ))}
          </div>
        </header>

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <div className="w-full flex flex-col sm:flex-row gap-4 items-start sm:items-center mb-8">
          <AgentFilters
            search={search}
            onSearchChange={setSearch}
            category={category}
            onCategoryChange={setCategory}
          />
          {activeAddress && (
            <button
              onClick={handleAddClick}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-black font-black rounded-xl transition-all shadow-lg shadow-orange-500/20 text-sm uppercase tracking-wider whitespace-nowrap flex-shrink-0"
            >
              <IoAdd className="text-lg" />
              { "Register Agent" }
            </button>
          )}
        </div>

        {/* ── Grid ──────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="bg-banner-grey/30 border border-secondary-gray/30 rounded-2xl p-6 animate-pulse"
              >
                <div className="h-5 bg-neutral-800 rounded-lg w-2/3 mb-3" />
                <div className="h-3 bg-neutral-800 rounded w-1/3 mb-4" />
                <div className="h-3 bg-neutral-800/50 rounded w-full mb-2" />
                <div className="h-3 bg-neutral-800/50 rounded w-4/5" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="w-full flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-orange-500/10 rounded-3xl flex items-center justify-center mb-6">
              <IoSparkles className="text-3xl text-orange-500/40" />
            </div>
            <h2 className="text-xl font-bold text-neutral-400 mb-2">
              {search || category ? "No agents match your filters" : "No agents registered yet"}
            </h2>
            <p className="text-sm text-neutral-600 max-w-md">
              {search || category
                ? "Try adjusting your search or category filter."
                : "Be the first to register your AI agent on-chain. Connect your wallet and click \"Register Agent\" to get started."}
            </p>
          </div>
        ) : (
          <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((listing) => (
              <AgentCard
                key={listing.appId}
                listing={listing}
                isOwner={activeAddress === listing.walletAddress}
                onEdit={() => handleEdit(listing)}
                onDelete={() => handleDelete(listing)}
                onTestCall={(l) => setTestListing(l)}
              />
            ))}
          </div>
        )}

        {/* ── Count ─────────────────────────────────────────────────────────── */}
        {!loading && filtered.length > 0 && (
          <div className="mt-6 text-xs text-neutral-600 font-mono">
            {filtered.length} agent{filtered.length !== 1 ? "s" : ""} registered
            {category && ` in ${category}`}
          </div>
        )}

        <div className="w-full border-t border-neutral-800 pt-8 mt-12 mb-12">
          <SmartContractViewer />
        </div>

        {/* ── SEO / Practitioner Content ────────────────────────────────────── */}
        <section className="mt-20 pt-12 border-t border-neutral-800 w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <IoGlobe className="text-orange-400" />
                <h2 className="text-lg font-bold text-white italic">On-Chain Discovery</h2>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Agent listings are stored entirely on the Algorand blockchain using a factory/child contract pattern. No databases, no central servers — the ledger is the only source of truth. Other platforms can discover your agent via the standardized <code className="text-orange-400 bg-orange-500/10 px-1 py-0.5 rounded">/.well-known/agents.json</code> endpoint.
              </p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <IoShieldCheckmark className="text-orange-400" />
                <h2 className="text-lg font-bold text-white italic">Wallet-to-Wallet Payments</h2>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                This marketplace is purely a registry. Payment for agent services flows directly between the caller and the agent operator's wallet using x402 or standard Algorand transactions. No intermediary, no escrow, no custody.
              </p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <IoSparkles className="text-orange-400" />
                <h2 className="text-lg font-bold text-white italic">x402 Compatible</h2>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                The agent economy is built on open standards. Listings advertise x402 compatibility so that autonomous agents can discover, negotiate, and pay for services programmatically — enabling true machine-to-machine commerce on Algorand.
              </p>
            </div>
          </div>
        </section>

        <div className="w-full border-t border-neutral-800 pt-8 mt-12 mb-12">
          <AgentSnippets />
        </div>
      </article>

      {/* ── Modal ───────────────────────────────────────────────────────────── */}
      <AddListingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleSuccess}
        existingListing={editListing}
        network={network}
      />
      <TestAgentModal
        open={!!testListing}
        onClose={() => setTestListing(null)}
        listing={testListing}
        network={network}
      />
    </div>
  );
}
