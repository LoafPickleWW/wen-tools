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
import { AirdropTool } from "./pages/AirdropTool";
import { BatchCollectionMint } from "./pages/BatchCollectionMint";
import { BatchOptin } from "./pages/BatchOptin";
import { BatchOptout } from "./pages/BatchOptout";
import { CollectionSnapshot } from "./pages/CollectionSnapshotComponent";
import { Download69CollectionData } from "./pages/Download69CollectionData";
import { BatchCollectionMetadataUpdate } from "./pages/BatchMetadataUpdateComponent";
import { WalletHoldings } from "./pages/WalletHoldings";
import { MultimintAssetHolders } from "./pages/MultimintAssetHolders";
import { ARC3MintTool } from "./pages/ARC3MintTool";
import { ARC19MintTool } from "./pages/ARC19MintTool";
import { ARC19UpdateTool } from "./pages/ARC19UpdateTool";
import { Download19CollectionData } from "./pages/Download19CollectionData";
import { BatchDelete } from "./pages/BatchDelete";
import { SimpleSendTool } from "./pages/SimpleSendTool";
import { SimpleAirdropTool } from "./pages/SimpleAirdropTool";
import { SimpleMint } from "./pages/SimpleMint";
import { SimpleUpdate } from "./pages/SimpleUpdate";
import { BatchClawback } from "./pages/BatchClawback";
import { BatchFreeze } from "./pages/BatchFreeze";
import { VaultSendTool } from "./pages/VaultSendTool";
import { SimpleBatchMint } from "./pages/SimpleBatchMint";
import { SimpleMintClassic } from "./pages/SimpleMintClassic";
import { SimpleUpdateClassic } from "./pages/SimpleUpdateClassic";
import { BlukClaimTool } from "./pages/BulkClaimTool";
import ScrollToTop from "./components/ScrollToTop";
import { Analytics } from "@vercel/analytics/react";

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
      <div className="bg-primary-black flex flex-col min-h-screen font-sans pb-6">
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
            <Route path="/airdrop" element={<AirdropTool />} />
            <Route path="/simple-airdrop" element={<SimpleAirdropTool />} />
            <Route path="/simple-send" element={<SimpleSendTool />} />
            <Route path="/vault-send" element={<VaultSendTool />} />
            <Route
              path="/arc69-collection-mint"
              element={<BatchCollectionMint />}
            />
            <Route path="/arc3-collection-mint" element={<ARC3MintTool />} />
            <Route
              path="/arc69-metadata-update"
              element={<BatchCollectionMetadataUpdate />}
            />
            <Route path="/batch-optin" element={<BatchOptin />} />
            <Route path="/batch-optout" element={<BatchOptout />} />
            <Route path="/batch-destroy" element={<BatchDelete />} />
            <Route path="/batch-clawback" element={<BatchClawback />} />
            <Route path="/batch-freeze" element={<BatchFreeze />} />
            <Route path="/bulk-claim" element={<BlukClaimTool />} />
            <Route
              path="/find-collection-holders"
              element={<CollectionSnapshot />}
            />
            <Route
              path="/download-arc69-collection-data"
              element={<Download69CollectionData />}
            />
            <Route
              path="/download-arc19-collection-data"
              element={<Download19CollectionData />}
            />
            <Route path="/arc19-collection-mint" element={<ARC19MintTool />} />
            <Route
              path="/arc19-metadata-update"
              element={<ARC19UpdateTool />}
            />
            <Route path="/wallet-holdings" element={<WalletHoldings />} />
            <Route
              path="/multimint-asset-holders"
              element={<MultimintAssetHolders />}
            />
            <Route path="/simple-batch-mint" element={<SimpleBatchMint />} />
            <Route path="/simple-mint" element={<SimpleMint />} />
            <Route path="/simple-update" element={<SimpleUpdate />} />
            <Route
              path="/simple-mint-classic"
              element={<SimpleMintClassic />}
            />
            <Route
              path="/simple-update-classic"
              element={<SimpleUpdateClassic />}
            />
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
