import {
  NetworkId,
  WalletManager,
  WalletProvider,
} from "@txnlab/use-wallet-react";
import { pera } from "@txnlab/use-wallet-pera";
import { defly } from "@txnlab/use-wallet-defly";
import { lute } from "@galaxypay/use-wallet-lute";
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, BrowserRouter as Router, useParams } from "react-router-dom";

/** Old Shuffle URLs (/wen-pad/sales/:appId) keep working */
function RedirectSaleToShuffle() {
  const { appId } = useParams();
  return <Navigate to={`/shuffle/${appId}`} replace />;
}
import axios from "axios";
import Home from "./views/home";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import { PQThemeProvider } from "./context/PQThemeContext";
import { ChainPulseProvider } from "./context/ChainPulse";
import { PageShell } from "./components/cypher/PageShell";
import { AtomicBackground } from "./components/quantum/AtomicBackground";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import ScrollToTop from "./components/ScrollToTop";
import { Analytics } from "@vercel/analytics/react";
import { NotFound } from "./pages/NotFound";


// Pages load on demand so a first visit only downloads the route it lands on
const DistributionSuite = lazy(() => import("./pages/DistributionSuite").then((m) => ({ default: m.DistributionSuite })));
const BatchOptin = lazy(() => import("./pages/BatchOptin").then((m) => ({ default: m.BatchOptin })));
const BatchOptout = lazy(() => import("./pages/BatchOptout").then((m) => ({ default: m.BatchOptout })));
const BatchUpdate = lazy(() => import("./pages/BatchUpdate").then((m) => ({ default: m.BatchUpdate })));
const HoldingsAuditor = lazy(() => import("./pages/HoldingsAuditor").then((m) => ({ default: m.HoldingsAuditor })));
const BatchDelete = lazy(() => import("./pages/BatchDelete").then((m) => ({ default: m.BatchDelete })));
const SimpleMint = lazy(() => import("./pages/SimpleMint").then((m) => ({ default: m.SimpleMint })));
const SimpleUpdate = lazy(() => import("./pages/SimpleUpdate").then((m) => ({ default: m.SimpleUpdate })));
const BatchMint = lazy(() => import("./pages/BatchMint").then((m) => ({ default: m.BatchMint })));
const BlukClaimTool = lazy(() => import("./pages/BulkClaimTool").then((m) => ({ default: m.BlukClaimTool })));
const ARC62ManagerTool = lazy(() => import("./pages/ARC62ManagerTool").then((m) => ({ default: m.ARC62ManagerTool })));
const WenPad = lazy(() => import("./pages/WenPad").then((m) => ({ default: m.WenPad })));
const WenPadSales = lazy(() => import("./pages/WenPadSales").then((m) => ({ default: m.WenPadSales })));
const VoteTool = lazy(() => import("./pages/VoteTool").then((m) => ({ default: m.VoteTool })));
const XGov = lazy(() => import("./pages/XGov").then((m) => ({ default: m.XGov })));
const Jukebox = lazy(() => import("./pages/Jukebox").then((m) => ({ default: m.Jukebox })));
const P2PChat = lazy(() => import("./pages/P2PChat").then((m) => ({ default: m.P2PChat })));
const BeaconChat = lazy(() => import("./pages/BeaconChat").then((m) => ({ default: m.BeaconChat })));
const PostQuantum = lazy(() => import("./pages/PostQuantum"));
const PQTxPrinter = lazy(() => import("./pages/PQTxPrinter"));
const BeaconDropTool = lazy(() => import("./pages/BeaconDropTool").then((m) => ({ default: m.BeaconDropTool })));
const WenDeployTool = lazy(() => import("./pages/WenDeployTool"));
const AnchorSetupTool = lazy(() => import("./pages/AnchorSetupTool"));
const VanityAddressTool = lazy(() => import("./pages/VanityAddressTool"));
const Encyclopedia = lazy(() => import("./pages/Encyclopedia").then((m) => ({ default: m.Encyclopedia })));
const WenSwapTool = lazy(() => import("./pages/WenSwapTool"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse").then((m) => ({ default: m.TermsOfUse })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const AgentMarketplace = lazy(() => import("./pages/AgentMarketplace"));
const BulkAssetManager = lazy(() => import("./pages/BulkAssetManager").then((m) => ({ default: m.BulkAssetManager })));
const MintingSuite = lazy(() => import("./pages/MintingSuite").then((m) => ({ default: m.MintingSuite })));
const WenWallet = lazy(() => import("./pages/WenWallet").then((m) => ({ default: m.WenWallet })));
const WalletAssetDetail = lazy(() => import("./pages/WalletAssetDetail"));
const ClusterMap = lazy(() => import("./pages/ClusterMap").then((m) => ({ default: m.ClusterMap })));
const StablecoinStudio = lazy(() => import("./pages/StablecoinStudio").then((m) => ({ default: m.StablecoinStudio })));

const walletManager = new WalletManager({
  wallets: [pera(), defly(), lute({ siteName: "wen.tools" })],
  defaultNetwork: NetworkId.MAINNET,
  // use-wallet v5 no longer remembers the selected network by default
  options: { persistNetwork: true },
});

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (
      config &&
      config.url &&
      config.url.includes("https://ipfs.algonode.xyz/ipfs/") &&
      (!error.response || [403, 429, 502, 503, 504].includes(error.response.status) || error.code === 'ECONNABORTED' || error.message.includes('timeout') || error.message.includes('Network Error'))
    ) {
      if (!config._retry) {
        config._retry = true;
        // ipfs.io no longer serves direct requests (HTTP 429), so fall back to Pinata
        console.warn(`IPFS gateway error on Nodely, falling back to Pinata for: ${config.url}`);
        config.url = config.url.replace("https://ipfs.algonode.xyz/ipfs/", "https://gateway.pinata.cloud/ipfs/");
        return axios(config);
      }
    }
    return Promise.reject(error);
  }
);

function App() {
  return (
    <WalletProvider manager={walletManager}>
      <PQThemeProvider>
      <ChainPulseProvider>
        <div className="wt-app bg-primary-black flex flex-col min-h-screen font-sans relative transition-colors duration-500">
          <AtomicBackground />
          <div className="wt-grain" aria-hidden="true" />
          <ToastContainer
            pauseOnFocusLoss={false}
            closeOnClick
            draggable
            pauseOnHover={false}
            position="bottom-right"
            rtl={false}
            hideProgressBar={false}
            autoClose={3500}
            newestOnTop={true}
            theme="dark"
          />
        <Router>
          <ScrollToTop />
          <Header />
          <PageShell>
          <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/distribution-suite" element={<DistributionSuite />} />
            <Route path="/airdrop" element={<DistributionSuite defaultTab="custom" defaultSubMode="csv" />} />
            <Route path="/simple-airdrop" element={<DistributionSuite defaultTab="creator-wallet" />} />
            <Route path="/simple-send" element={<DistributionSuite defaultTab="custom" defaultSubMode="manual" />} />
            <Route path="/vault-send" element={<DistributionSuite defaultTab="vault" />} />
            <Route
              path="/arc69-collection-mint"
              element={<BatchMint />}
            />
            <Route path="/arc3-collection-mint" element={<BatchMint />} />
            <Route
              path="/arc69-metadata-update"
              element={<BatchUpdate />}
            />
            <Route
              path="/bulk-metadata-update"
              element={<BatchUpdate />}
            />
            <Route path="/batch-optin" element={<BatchOptin />} />
            <Route path="/batch-optout" element={<BatchOptout />} />
            <Route path="/batch-destroy" element={<BatchDelete />} />
            <Route path="/bulk-asset-manager" element={<BulkAssetManager />} />
            <Route path="/batch-clawback" element={<BulkAssetManager defaultTab="clawback" />} />
            <Route path="/batch-freeze" element={<BulkAssetManager defaultTab="freeze" />} />
            <Route path="/bulk-claim" element={<BlukClaimTool />} />
            <Route path="/token-manager" element={<ARC62ManagerTool />} />
            <Route
              path="/find-collection-holders"
              element={<MintingSuite defaultPath="snapshot" />}
            />
            <Route
              path="/download-collection-data"
              element={<MintingSuite defaultPath="downloader" />}
            />
            <Route
              path="/download-arc69-collection-data"
              element={<MintingSuite defaultPath="downloader" />}
            />
            <Route
              path="/download-arc19-collection-data"
              element={<MintingSuite defaultPath="downloader" />}
            />
            <Route path="/arc19-collection-mint" element={<BatchMint />} />
            <Route
              path="/arc19-metadata-update"
              element={<BatchUpdate />}
            />
            <Route path="/holdings-auditor" element={<HoldingsAuditor />} />
            <Route path="/wallet-holdings" element={<HoldingsAuditor defaultTab="wallet" />} />
            <Route
              path="/multimint-asset-holders"
              element={<HoldingsAuditor defaultTab="asset" />}
            />
            <Route path="/simple-batch-mint" element={<BatchMint />} />
            <Route path="/batch-collection-mint" element={<BatchMint />} />
            <Route path="/simple-mint" element={<SimpleMint />} />
            <Route path="/simple-update" element={<SimpleUpdate />} />
            <Route
              path="/simple-mint-classic"
              element={<SimpleMint />}
            />
            <Route
              path="/simple-update-classic"
              element={<SimpleUpdate />}
            />
            <Route path="/minting-journey" element={<MintingSuite />} />
            <Route path="/creator-suite" element={<MintingSuite />} />
            <Route path="/creator-suite/:toolId" element={<MintingSuite />} />
            <Route path="/stablecoin-studio" element={<StablecoinStudio />} />
            <Route
              path="/nft-import"
              element={<MintingSuite defaultPath="import" />}
            />
            <Route path="/really-simple-mint" element={<SimpleMint />} />
            <Route path='/wen-pad' element={<WenPad />} />
            <Route path='/shuffle' element={<WenPadSales />} />
            <Route path='/shuffle/:appId' element={<WenPadSales />} />
            <Route path='/wen-pad/sales' element={<Navigate to='/shuffle' replace />} />
            <Route path='/wen-pad/sales/:appId' element={<RedirectSaleToShuffle />} />
            <Route path='/vote' element={<VoteTool />} />
            <Route path='/vote/:appId' element={<VoteTool />} />
            <Route path='/xgov' element={<XGov />} />
            <Route path='/jukebox' element={<Jukebox />} />
            <Route path='/p2p-chat' element={<P2PChat />} />
            <Route path='/beacon-chat' element={<BeaconChat />} />
            <Route path='/post-quantum' element={<PostQuantum />} />
            <Route path='/pq-printer' element={<PQTxPrinter />} />
            <Route path='/beacon-drop' element={<BeaconDropTool />} />
            <Route path='/deploy' element={<WenDeployTool />} />
            <Route path='/anchor-setup' element={<AnchorSetupTool />} />
            <Route path='/vanity' element={<VanityAddressTool />} />
            <Route path='/encyclopedia' element={<Encyclopedia />} />
            <Route path='/wen-swap' element={<WenSwapTool />} />
            <Route path="/terms" element={<TermsOfUse />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/agents" element={<AgentMarketplace />} />
            <Route path="/wallet" element={<WenWallet />} />
            <Route path="/wallet/account/:account" element={<WenWallet />} />
            <Route path="/wallet/asset/:assetId" element={<WalletAssetDetail />} />
            <Route path="/cluster-map" element={<ClusterMap />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </PageShell>
          <Footer />
        </Router>
      </div>
      <Analytics />
      </ChainPulseProvider>
      </PQThemeProvider>
    </WalletProvider>
  );
}
export default App;

