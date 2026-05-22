import {
  NetworkId,
  WalletId,
  WalletManager,
  WalletProvider,
} from "@txnlab/use-wallet-react";
import { Route, Routes, BrowserRouter as Router } from "react-router-dom";
import Home from "./views/home";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { DistributionSuite } from "./pages/DistributionSuite";
import { BatchOptin } from "./pages/BatchOptin";
import { BatchOptout } from "./pages/BatchOptout";
import { BatchUpdate } from "./pages/BatchUpdate";
import { HoldingsAuditor } from "./pages/HoldingsAuditor";
import { BatchDelete } from "./pages/BatchDelete";
import { SimpleMint } from "./pages/SimpleMint";
import { SimpleUpdate } from "./pages/SimpleUpdate";
import { BatchMint } from "./pages/BatchMint";
import { BlukClaimTool } from "./pages/BulkClaimTool";
import ScrollToTop from "./components/ScrollToTop";
import { Analytics } from "@vercel/analytics/react";
import { ARC62ManagerTool } from "./pages/ARC62ManagerTool";
import { WenPad } from './pages/WenPad';
import { XGov } from './pages/XGov';
import { Jukebox } from './pages/Jukebox';
import { P2PChat } from './pages/P2PChat';
import { BeaconChat } from './pages/BeaconChat';
import PostQuantum from './pages/PostQuantum';
import { BeaconDropTool } from './pages/BeaconDropTool';
import WenDeployTool from './pages/WenDeployTool';
import AnchorSetupTool from './pages/AnchorSetupTool';
import VanityAddressTool from './pages/VanityAddressTool';
import { Encyclopedia } from './pages/Encyclopedia';
import WenSwapTool from './pages/WenSwapTool';
import { TermsOfUse } from "./pages/TermsOfUse";
import { PrivacyPolicy } from "./pages/PrivacyPolicy";
import AgentMarketplace from './pages/AgentMarketplace';
import { BulkAssetManager } from "./pages/BulkAssetManager";
import { MintingSuite } from "./pages/MintingSuite";



const walletManager = new WalletManager({
  wallets: [
    WalletId.PERA,
    WalletId.DEFLY,
    {
      id: WalletId.LUTE,
      options: { siteName: "wen.tools" },
    },
  ],
  network: NetworkId.MAINNET,
});

function App() {
  return (
    <WalletProvider manager={walletManager}>
      <div className="bg-primary-black flex flex-col min-h-screen font-sans ">
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
            <Route path="/really-simple-mint" element={<SimpleMint />} />
            <Route path='/wen-pad' element={<WenPad />} />
            <Route path='/xgov' element={<XGov />} />
            <Route path='/jukebox' element={<Jukebox />} />
            <Route path='/p2p-chat' element={<P2PChat />} />
            <Route path='/beacon-chat' element={<BeaconChat />} />
            <Route path='/post-quantum' element={<PostQuantum />} />
            <Route path='/beacon-drop' element={<BeaconDropTool />} />
            <Route path='/deploy' element={<WenDeployTool />} />
            <Route path='/anchor-setup' element={<AnchorSetupTool />} />
            <Route path='/vanity' element={<VanityAddressTool />} />
            <Route path='/encyclopedia' element={<Encyclopedia />} />
            <Route path='/wen-swap' element={<WenSwapTool />} />
            <Route path="/terms" element={<TermsOfUse />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/agents" element={<AgentMarketplace />} />
            <Route path="*" element={<Home />} />
          </Routes>
          <Footer />
        </Router>
      </div>
      <Analytics />
    </WalletProvider>
  );
}
export default App;

