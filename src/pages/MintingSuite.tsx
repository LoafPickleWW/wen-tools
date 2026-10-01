import { ToolHero, PathCard } from "../components/cypher/ToolKit";

import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Meta } from "../components/Meta";
import { WenPad } from "./WenPad";
import { SimpleMint } from "./SimpleMint";
import { BatchMint } from "./BatchMint";
import { SimpleUpdate } from "./SimpleUpdate";
import { BatchUpdate } from "./BatchUpdate";
import { CollectionDataDownloader } from "./CollectionDataDownloader";
import { CollectionSnapshot } from "./CollectionSnapshotComponent";
import { NFTImportTool } from "./NFTImportTool";

type CreatorPath = null | "generate" | "mint_options" | "update_options" | "downloader" | "snapshot" | "simple_mint" | "batch_mint" | "simple_update" | "bulk_update" | "import";

interface MintingSuiteProps {
  defaultPath?: CreatorPath;
}

export function MintingSuite({ defaultPath = null }: MintingSuiteProps) {
  const { toolId } = useParams<{ toolId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const getPathFromSlug = (slug?: string): CreatorPath => {
    switch (slug) {
      case "wenpad": return "generate";
      case "mint-options": return "mint_options";
      case "update-options": return "update_options";
      case "downloader": return "downloader";
      case "snapshot": return "snapshot";
      case "simple-mint": return "simple_mint";
      case "bulk-mint": return "batch_mint";
      case "simple-update": return "simple_update";
      case "bulk-update": return "bulk_update";
      case "nft-import": return "import";
      default: return null;
    }
  };

  const getSlugFromPath = (path: CreatorPath): string => {
    switch (path) {
      case "generate": return "wenpad";
      case "mint_options": return "mint-options";
      case "update_options": return "update-options";
      case "downloader": return "downloader";
      case "snapshot": return "snapshot";
      case "simple_mint": return "simple-mint";
      case "batch_mint": return "bulk-mint";
      case "simple_update": return "simple-update";
      case "bulk_update": return "bulk-update";
      case "import": return "nft-import";
      default: return "";
    }
  };

  const isCreatorSuiteRoute = location.pathname.startsWith("/creator-suite");
  const currentPath = isCreatorSuiteRoute ? getPathFromSlug(toolId) : defaultPath;

  const setCurrentPath = (path: CreatorPath) => {
    if (path === null) {
      navigate("/creator-suite");
    } else {
      navigate(`/creator-suite/${getSlugFromPath(path)}`);
    }
  };

  const getBackState = (): CreatorPath => {
    switch (currentPath) {
      case "simple_mint":
      case "batch_mint":
        return "mint_options";
      case "simple_update":
      case "bulk_update":
        return "update_options";
      default:
        return null;
    }
  };

  // Inside an actual tool (not the dashboard or a choice screen)
  const isToolView =
    currentPath !== null && currentPath !== "mint_options" && currentPath !== "update_options";

  const getBackLabel = (): string => {
    const backState = getBackState();
    if (backState === "mint_options") return "← Back to Mint Options";
    if (backState === "update_options") return "← Back to Update Options";
    return "← Back to Creator Suite Dashboard";
  };

  const renderContent = () => {
    switch (currentPath) {
      case "generate":
        return <WenPad />;
      case "simple_mint":
        return <SimpleMint />;
      case "batch_mint":
        return <BatchMint />;
      case "simple_update":
        return <SimpleUpdate />;
      case "bulk_update":
        return <BatchUpdate />;
      case "downloader":
        return <CollectionDataDownloader />;
      case "snapshot":
        return <CollectionSnapshot />;
      case "import":
        return <NFTImportTool />;

      case "mint_options":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full mt-6 animate-fadeIn">
            <PathCard
              index={0}
              onClick={() => setCurrentPath("simple_mint")}
              icon="/icons/smint.png"
              title="Mint 1 Asset"
              description="Mint a single asset (NFT or Token) with custom properties. Supports Crust, Pinata, and Filebase."
              cta="Launch Simple Minter →"
            />

            <PathCard
              index={1}
              onClick={() => setCurrentPath("batch_mint")}
              icon="/icons/bulk.png"
              title="Bulk Mint"
              description="Mint bulk collections in ARC-3, ARC-19, or ARC-69 formats using CSV file uploads or range generation."
              cta="Launch Bulk Minter →"
            />
          </div>
        );

      case "update_options":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full mt-6 animate-fadeIn text-left">
            <PathCard
              index={0}
              onClick={() => setCurrentPath("simple_update")}
              icon="/icons/mintupdate.png"
              title="Update 1 Asset"
              description="Modify metadata, urls, freeze, or clawback settings for a single asset."
              cta="Launch Update Minter →"
            />

            <PathCard
              index={1}
              onClick={() => setCurrentPath("bulk_update")}
              icon="/icons/arc69u.png"
              title="Bulk Update"
              description="Bulk update metadata note fields or reserve address CIDs across your collection using CSV configuration (supports ARC-69 & ARC-19)."
              cta="Launch Bulk Updater →"
            />
          </div>
        );

      default:
        // Dashboard Landing Menu (4 Paths)
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto w-full mt-10 animate-fadeIn text-left">
            {/* Path 1: Generate via WenPad */}
            <PathCard
              index={0}
              onClick={() => setCurrentPath("generate")}
              icon="/icons/wenpad.png"
              title="No Artwork or Metadata"
              description="Generate layered artwork and JSON metadata directly in the browser using WenPad's layer configuration engine."
              cta="Generate Artwork via WenPad →"
            />

            {/* Path 2: Mint Assets */}
            <PathCard
              index={1}
              onClick={() => setCurrentPath("mint_options")}
              icon="/icons/mint.png"
              title="Already Have Images / Files"
              description="Mint individual assets or compile entire bulk collections into ARC-3, ARC-19, or ARC-69 formats."
              cta="Mint Assets / Collections →"
            />

            {/* Path 3: Update Assets */}
            <PathCard
              index={2}
              onClick={() => setCurrentPath("update_options")}
              icon="/icons/mintupdate.png"
              title="Update Minted Collection"
              description="Modify configurations, update transaction notes, or alter dynamic metadata reserve references on-chain."
              cta="Update Minted Assets →"
            />

            {/* Path 4: Downloader */}
            <PathCard
              index={3}
              onClick={() => setCurrentPath("downloader")}
              icon="/icons/arc69d.png"
              title="Download Collection Data"
              description="Audit and fetch complete collection details from creator wallets. Exports a clean flattened CSV of traits."
              cta="Extract Collection CSV →"
            />

            {/* Path 5: Find Collection Holders */}
            <PathCard
              index={4}
              onClick={() => setCurrentPath("snapshot")}
              icon="/icons/devtools.png"
              title="Find Collection Holders"
              description="Query and snapshot all current holders of a given NFT collection or asset. Generate accurate snapshots for airdrops or community analytics."
              cta="Snapshot Holders →"
            />

            {/* Path 6: Import from other chains */}
            <PathCard
              index={5}
              onClick={() => setCurrentPath("import")}
              icon="/icons/mint.png"
              title="Import from other chains"
              description="Have NFTs from other chains you want to move over? Scan and re-mint your XRPL collections on Algorand."
              cta="Launch NFT Import Tool →"
            />

            {/* Path 7: Stablecoin Studio */}
            <PathCard
              index={6}
              onClick={() => navigate("/stablecoin-studio")}
              icon="/icons/devtools.png"
              title="Stablecoin Studio (via Brale)"
              description="Configure, mint, and manage fiat-backed stablecoins on Algorand using Brale's infrastructure."
              cta="Launch Stablecoin Studio"
            />
          </div>
        );
    }
  };

  return (
    <div className="mx-auto text-white mb-12 min-h-screen max-w-7xl px-4 flex flex-col items-center">
      <Meta
        title="Creator Suite"
        description="Streamlined choice-based creator workspace for generating, minting, updating, and auditing Algorand standard assets."
      />

      {/* Header: full hero on choice screens, compact bar inside a tool */}
      {isToolView ? (
        <div className="mt-6 flex w-full max-w-4xl">
          <button
            onClick={() => setCurrentPath(getBackState())}
            className="wt-btn wt-btn-ghost font-mono text-xs"
          >
            {getBackLabel()}
          </button>
        </div>
      ) : (
        <>
          <ToolHero
            tag="creator"
            title="Creator Suite"
            description="An integrated workspace that simplifies asset creation on Algorand: generate, mint, update and audit."
            meta={["WenPad", "ARC-3 / 19 / 69", "CSV bulk", "Crust · Pinata · Filebase"]}
          />
          {currentPath !== null && (
            <div className="w-full max-w-4xl flex justify-start">
              <button
                onClick={() => setCurrentPath(getBackState())}
                className="wt-btn wt-btn-ghost font-mono text-xs"
              >
                {getBackLabel()}
              </button>
            </div>
          )}
        </>
      )}

      {/* Renders Dashboard or Selected View */}
      <div className="w-full">
        {renderContent()}
      </div>

      {/* Creator suite info footer */}
      {currentPath === null && (
        <section className="mt-20 pt-12 border-t border-white/[0.08] w-full text-left max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-sm text-gray-400">
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-white">Integrated Creator Journeys</h4>
              <p className="leading-relaxed">
                By organizing utilities into choice-based starting states, the Creator Suite eliminates redundant navigations. Access generative layer tooling, single and collection minters, or auditing facilities seamlessly.
              </p>
            </div>
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-white">Technical Standards Enforcement</h4>
              <p className="leading-relaxed">
                Every component within this dashboard compiles transactions compliant with Algorand ARC specifications (including ARC-3, ARC-19, and ARC-69). Build collections recognized across explorer platforms and decentralized marketplaces.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
