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
import { Download69CollectionData } from "./pages/Download69CollectionData";
import { BatchCollectionMetadataUpdate } from "./pages/BatchMetadataUpdateComponent";
import { WalletHoldings } from "./pages/WalletHoldings";
import { MultimintAssetHolders } from "./pages/MultimintAssetHolders";
import { ARC3MintTool } from "./pages/ARC3MintTool";
import { ARC19MintTool } from "./pages/ARC19MintTool";
import { ARC19UpdateTool } from "./pages/ARC19UpdateTool";
import { Download19CollectionData } from "./pages/Download19CollectionData";
import { BatchDelete } from "./pages/BatchDelete";

function App() {
  return (
    <div className="bg-gray-900 flex flex-col min-h-screen font-roboto pb-[100px]">
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
            path="/arc69-collection-mint"
            element={<BatchCollectionMint />}
          />
          <Route
            path="/arc3-collection-mint"
            element={<ARC3MintTool />}
          />
          <Route
            path="/arc69-metadata-update"
            element={<BatchCollectionMetadataUpdate />}
          />
          <Route path="/batch-optin" element={<BatchOptin />} />
          <Route path="/batch-optout" element={<BatchOptout />} />
          <Route path="/batch-destroy" element={<BatchDelete />} />
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
          <Route path="/ipfs-upload" element={<UploadCollectionToIPFS />} />
          <Route path="/arc19-collection-mint" element={<ARC19MintTool />} />
          <Route path="/arc19-metadata-update" element={<ARC19UpdateTool />} />
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
