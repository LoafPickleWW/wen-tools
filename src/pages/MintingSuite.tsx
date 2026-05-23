
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
            <div
              onClick={() => setCurrentPath("simple_mint")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 cursor-pointer transition shadow-lg group text-left flex flex-col justify-between"
            >
              <div>
                <img src="/icons/smint.png" alt="Mint 1 Asset" className="w-10 h-10 mb-3 object-contain invert" />
                <h3 className="text-xl font-bold group-hover:text-orange-400 transition">Mint 1 Asset</h3>
                <p className="text-gray-300 text-sm mt-2 leading-relaxed">
                  Mint a single asset (NFT or Token) with custom properties. Supports Crust and Pinata.
                </p>
              </div>
              <span className="text-orange-400 text-xs font-semibold mt-4 block">Launch Simple Minter →</span>
            </div>

            <div
              onClick={() => setCurrentPath("batch_mint")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 cursor-pointer transition shadow-lg group text-left flex flex-col justify-between"
            >
              <div>
                <img src="/icons/bulk.png" alt="Bulk Mint" className="w-10 h-10 mb-3 object-contain invert" />
                <h3 className="text-xl font-bold group-hover:text-orange-400 transition">Bulk Mint</h3>
                <p className="text-gray-300 text-sm mt-2 leading-relaxed">
                  Mint bulk collections in ARC-3, ARC-19, or ARC-69 formats using CSV file uploads or range generation.
                </p>
              </div>
              <span className="text-orange-400 text-xs font-semibold mt-4 block">Launch Bulk Minter →</span>
            </div>
          </div>
        );

      case "update_options":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full mt-6 animate-fadeIn text-left">
            <div
              onClick={() => setCurrentPath("simple_update")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 cursor-pointer transition shadow-lg group flex flex-col justify-between"
            >
              <div>
                <img src="/icons/mintupdate.png" alt="Update 1 Asset" className="w-10 h-10 mb-2 object-contain invert" />
                <h3 className="text-lg font-bold group-hover:text-orange-400 transition">Update 1 Asset</h3>
                <p className="text-gray-300 text-xs mt-2 leading-relaxed">
                  Modify metadata, urls, freeze, or clawback settings for a single asset.
                </p>
              </div>
              <span className="text-orange-400 text-xs font-semibold mt-4 block">Launch Update Minter →</span>
            </div>

            <div
              onClick={() => setCurrentPath("bulk_update")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 cursor-pointer transition shadow-lg group flex flex-col justify-between"
            >
              <div>
                <img src="/icons/arc69u.png" alt="Bulk Update" className="w-10 h-10 mb-2 object-contain invert" />
                <h3 className="text-lg font-bold group-hover:text-orange-400 transition">Bulk Update</h3>
                <p className="text-gray-300 text-xs mt-2 leading-relaxed">
                  Bulk update metadata note fields or reserve address CIDs across your collection using CSV configuration (supports ARC-69 & ARC-19).
                </p>
              </div>
              <span className="text-orange-400 text-xs font-semibold mt-4 block">Launch Bulk Updater →</span>
            </div>
          </div>
        );

      default:
        // Dashboard Landing Menu (4 Paths)
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto w-full mt-10 animate-fadeIn text-left">
            {/* Path 1: Generate via WenPad */}
            <div
              onClick={() => setCurrentPath("generate")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 md:p-8 cursor-pointer transition shadow-xl group duration-300 transform hover:scale-[1.01]"
            >
              <img src="/icons/wenpad.png" alt="WenPad" className="w-12 h-12 mb-4 object-contain invert" />
              <h3 className="text-xl font-bold group-hover:text-orange-400 transition">
                No Artwork or Metadata
              </h3>
              <p className="text-gray-300 text-sm mt-3 leading-relaxed">
                Generate layered artwork and JSON metadata directly in the browser using WenPad's layer configuration engine.
              </p>
              <span className="text-orange-400 text-xs font-semibold mt-6 block">Generate Artwork via WenPad →</span>
            </div>

            {/* Path 2: Mint Assets */}
            <div
              onClick={() => setCurrentPath("mint_options")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 md:p-8 cursor-pointer transition shadow-xl group duration-300 transform hover:scale-[1.01]"
            >
              <img src="/icons/mint.png" alt="Mint" className="w-12 h-12 mb-4 object-contain invert" />
              <h3 className="text-xl font-bold group-hover:text-orange-400 transition">
                Already Have Images / Files
              </h3>
              <p className="text-gray-300 text-sm mt-3 leading-relaxed">
                Mint individual assets or compile entire bulk collections into ARC-3, ARC-19, or ARC-69 formats.
              </p>
              <span className="text-orange-400 text-xs font-semibold mt-6 block">Mint Assets / Collections →</span>
            </div>

            {/* Path 3: Update Assets */}
            <div
              onClick={() => setCurrentPath("update_options")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 md:p-8 cursor-pointer transition shadow-xl group duration-300 transform hover:scale-[1.01]"
            >
              <img src="/icons/mintupdate.png" alt="Update" className="w-12 h-12 mb-4 object-contain invert" />
              <h3 className="text-xl font-bold group-hover:text-orange-400 transition">
                Update Minted Collection
              </h3>
              <p className="text-gray-300 text-sm mt-3 leading-relaxed">
                Modify configurations, update transaction notes, or alter dynamic metadata reserve references on-chain.
              </p>
              <span className="text-orange-400 text-xs font-semibold mt-6 block">Update Minted Assets →</span>
            </div>

            {/* Path 4: Downloader */}
            <div
              onClick={() => setCurrentPath("downloader")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 md:p-8 cursor-pointer transition shadow-xl group duration-300 transform hover:scale-[1.01]"
            >
              <img src="/icons/arc69d.png" alt="Downloader" className="w-12 h-12 mb-4 object-contain invert" />
              <h3 className="text-xl font-bold group-hover:text-orange-400 transition">
                Download Collection Data
              </h3>
              <p className="text-gray-300 text-sm mt-3 leading-relaxed">
                Audit and fetch complete collection details from creator wallets. Exports a clean flattened CSV of traits.
              </p>
              <span className="text-orange-400 text-xs font-semibold mt-6 block">Extract Collection CSV →</span>
            </div>

            {/* Path 5: Find Collection Holders */}
            <div
              onClick={() => setCurrentPath("snapshot")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 md:p-8 cursor-pointer transition shadow-xl group duration-300 transform hover:scale-[1.01]"
            >
              <img src="/icons/devtools.png" alt="Holders" className="w-12 h-12 mb-4 object-contain invert" />
              <h3 className="text-xl font-bold group-hover:text-orange-400 transition">
                Find Collection Holders
              </h3>
              <p className="text-gray-300 text-sm mt-3 leading-relaxed">
                Query and snapshot all current holders of a given NFT collection or asset. Generate accurate snapshots for airdrops or community analytics.
              </p>
              <span className="text-orange-400 text-xs font-semibold mt-6 block">Snapshot Holders →</span>
            </div>

            {/* Path 6: Import from other chains */}
            <div
              onClick={() => setCurrentPath("import")}
              className="bg-white/5 backdrop-blur-md border border-white/10 hover:border-orange-500/30 hover:bg-white/10 rounded-2xl p-6 md:p-8 cursor-pointer transition shadow-xl group duration-300 transform hover:scale-[1.01]"
            >
              <img src="/icons/mint.png" alt="Import" className="w-12 h-12 mb-4 object-contain invert" />
              <h3 className="text-xl font-bold group-hover:text-orange-400 transition">
                Import from other chains
              </h3>
              <p className="text-gray-300 text-sm mt-3 leading-relaxed">
                Have NFTs from other chains you want to move over? Scan and re-mint your XRPL collections on Algorand.
              </p>
              <span className="text-orange-400 text-xs font-semibold mt-6 block">Launch NFT Import Tool →</span>
            </div>
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

      {/* Header and Title */}
      <div className="mt-8 text-center max-w-2xl">
        <h1 className="text-4xl font-extrabold bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent tracking-tight">
          Creator Suite
        </h1>
        <p className="text-gray-400 text-sm mt-2">
          An integrated, professional workspace designed to simplify asset creation workflows on the Algorand blockchain.
        </p>
      </div>

      {/* Navigation breadcrumb / Back Button */}
      {currentPath !== null && (
        <div className="w-full max-w-4xl mt-6 flex justify-start">
          <button
            onClick={() => setCurrentPath(getBackState())}
            className="px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-gray-200 rounded-xl transition flex items-center gap-2 font-semibold text-xs shadow-md"
          >
            {getBackLabel()}
          </button>
        </div>
      )}

      {/* Renders Dashboard or Selected View */}
      <div className="w-full">
        {renderContent()}
      </div>

      {/* Creator suite info footer */}
      {currentPath === null && (
        <section className="mt-20 pt-12 border-t border-slate-800 w-full text-left max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-sm text-gray-400">
            <div className="space-y-3">
              <h4 className="text-lg font-bold text-white italic">Integrated Creator Journeys</h4>
              <p className="leading-relaxed">
                By organizing utilities into choice-based starting states, the Creator Suite eliminates redundant navigations. Access generative layer tooling, single and collection minters, or auditing facilities seamlessly.
              </p>
            </div>
            <div className="space-y-3">
              <h4 className="text-lg font-bold text-white italic">Technical Standards Enforcement</h4>
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
