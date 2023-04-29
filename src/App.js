import { Route, Routes, BrowserRouter as Router } from "react-router-dom";
import Home from "./views/home";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.min.css";
import { UploadCollectionToIPFS } from "./pages/UploadCollectionToIPFS";
import { Header } from "./components/header";
import { Footer } from "./components/footer";
import { AirdropTool } from "./pages/AirdropTool";
import { BatchCollectionMint } from "./pages/BatchCollectionMint";
import { BatchOptin } from "./pages/BatchOptin";
import { BatchOptout } from "./pages/BatchOptout";
import { CollectionSnapshot } from "./pages/CollectionSnapshotComponent";
import { DownloadCollectionData } from "./pages/DownloadCollectionData";
import { BatchCollectionMetadataUpdate } from "./pages/BatchMetadataUpdateComponent";
import { WalletHoldings } from "./pages/WalletHoldings";
import { MultimintAssetHolders } from "./pages/MultimintAssetHolders";
import { ARC3MintTool } from "./pages/ARC3MintTool";

function App() {
  return (
    <div className="bg-gray-900 flex flex-col min-h-screen font-roboto">
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
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/airdrop" element={<AirdropTool />} />
          <Route
            path="/batch-collection-mint"
            element={<BatchCollectionMint />}
          />
          <Route
            path="/arc3-collection-mint"
            element={<ARC3MintTool />}
          />
          <Route
            path="/batch-metadata-update"
            element={<BatchCollectionMetadataUpdate />}
          />
          <Route path="/batch-optin" element={<BatchOptin />} />
          <Route path="/batch-optout" element={<BatchOptout />} />
          <Route
            path="/find-collection-holders"
            element={<CollectionSnapshot />}
          />
          <Route
            path="/download-collection-data"
            element={<DownloadCollectionData />}
          />
          <Route path="/ipfs-upload" element={<UploadCollectionToIPFS />} />
          <Route path="/wallet-holdings" element={<WalletHoldings />} />
          <Route
            path="/multimint-asset-holders"
            element={<MultimintAssetHolders />}
          />
          <Route path="*" element={<Home />} />
        </Routes>
        <Footer />
      </Router>
    </div>
  );
}
export default App;
