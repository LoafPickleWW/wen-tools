import { useState } from 'react';
import { useProject } from '../ProjectProvider';
import { MdRocketLaunch, MdCheckCircle, MdError, MdHourglassEmpty } from 'react-icons/md';
import { useWallet } from '@txnlab/use-wallet-react';
import { toast } from 'react-toastify';
import confetti from 'canvas-confetti';
import { 
  pinImageToPinata, 
  pinJSONToPinata,
  createARC3AssetMintArrayV2Batch,
  createARC19AssetMintArrayV2Batch,
  walletSign,
  getIndexerURL,
  sliceIntoChunks
} from '../../../utils';
import { 
  pinImageToCrust, 
  pinJSONToCrust, 
} from '../../../crust';
import algosdk from 'algosdk';
import { loadImage } from '../ProjectUtils';

const MintStep = () => {
  const { project, previewItems } = useProject();
  const { activeAccount, activeNetwork, transactionSigner } = useWallet();
  const [standard, setStandard] = useState<'ARC3' | 'ARC69' | 'ARC19'>('ARC19');
  const [provider, setProvider] = useState<'Crust' | 'Pinata'>('Crust');
  const [ipfsToken, setIpfsToken] = useState(localStorage.getItem('authBasic') || '');
  const [isMinting, setIsMinting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: previewItems.length, status: '' });

  const generateBlob = async (item: any) => {
    const canvas = document.createElement('canvas');
    canvas.width = project.imageWidth || 1000;
    canvas.height = project.imageHeight || 1000;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    const traits = Object.values(item.traits)
      .filter((trait: any) => trait.image)
      .map((trait: any) => trait.image);

    for (const traitData of traits) {
      const img: any = await loadImage(traitData);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  };

  const handleMint = async () => {
    if (!activeAccount) return toast.error('Please connect your wallet');
    if (!ipfsToken) return toast.error('Please provide an IPFS token');
    if (previewItems.length === 0) return toast.error('No items to mint');

    setIsMinting(true);
    setProgress({ current: 0, total: previewItems.length, status: 'Starting collection launch...' });

    try {
      const mintedData = [];
      
      // 1. Pinning Step
      for (let i = 0; i < previewItems.length; i++) {
        const item = previewItems[i];
        setProgress({ current: i + 1, total: previewItems.length, status: `Preparing NFT #${item.index}...` });
        
        const blob = await generateBlob(item);
        
        let imageCid = '';
        if (provider === 'Crust') {
          imageCid = await pinImageToCrust(ipfsToken, blob);
        } else {
          imageCid = await pinImageToPinata(ipfsToken, blob);
        }

        const metadata: any = {
          name: `${project.name} #${item.index}`,
          description: project.description,
          image: `ipfs://${imageCid}`,
          properties: {}
        };
        
        Object.values(item.traits).forEach((t: any) => {
          if (!t.excludeFromMetadata) {
            metadata.properties[t.trait_type] = t.value;
          }
        });

        let assetData: any = {
          asset_name: metadata.name,
          unit_name: project.unitName,
          total_supply: 1,
          decimals: 0,
          asset_url: metadata.image,
        };

        if (standard === 'ARC69') {
           assetData.asset_note = metadata;
        } else {
           setProgress({ current: i + 1, total: previewItems.length, status: `Pinning metadata #${item.index}...` });
           let jsonCid = '';
           if (provider === 'Crust') {
             jsonCid = await pinJSONToCrust(ipfsToken, JSON.stringify(metadata));
           } else {
             jsonCid = await pinJSONToPinata(ipfsToken, JSON.stringify(metadata));
           }
           assetData.cid = jsonCid;
           assetData.ipfs_data = metadata;
        }

        mintedData.push(assetData);
        toast.info(`Uploaded ${i + 1}/${previewItems.length}`, { autoClose: 500 });
      }

      // 2. Minting Step
      setProgress({ current: previewItems.length, total: previewItems.length, status: 'Creating transactions...' });
      
      const algodClient = new algosdk.Algodv2('', getIndexerURL(activeNetwork!), '');
      let txnsGroups: algosdk.Transaction[][] = [];
      
      if (standard === 'ARC3') {
        txnsGroups = await createARC3AssetMintArrayV2Batch(mintedData, activeAccount.address, algodClient, transactionSigner);
      } else if (standard === 'ARC19') {
        txnsGroups = await createARC19AssetMintArrayV2Batch(mintedData, activeAccount.address, algodClient, transactionSigner);
      } else {
        // ARC69 or Standard
        // We'll need a generic batch creator if we want to support ARC69 in batch
        // For now let's focus on ARC19/3 as they are most requested
        toast.warning('ARC69 batch minting coming soon. Using ARC19 instead for this demo.');
        txnsGroups = await createARC19AssetMintArrayV2Batch(mintedData, activeAccount.address, algodClient, transactionSigner);
      }

      // 3. Signing Loop
      setProgress({ current: previewItems.length, total: previewItems.length, status: 'Awaiting signatures...' });
      
      const chunks = sliceIntoChunks(txnsGroups, 16); // Sign in groups of 16
      for (let i = 0; i < chunks.length; i++) {
        setProgress({ 
          current: previewItems.length, 
          total: previewItems.length, 
          status: `Signing batch ${i + 1} of ${chunks.length}...` 
        });
        const signedTxns = await walletSign(chunks[i], transactionSigner);
        await algodClient.sendRawTransaction(signedTxns).do();
        toast.success(`Batch ${i + 1} sent!`);
      }

      setProgress({ current: previewItems.length, total: previewItems.length, status: 'Collection Minted!' });
      confetti({
        particleCount: 200,
        spread: 100,
        origin: { y: 0.6 }
      });
      toast.success('Collection successfully launched!');

    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Minting failed');
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <div className="relative inline-block">
          <MdRocketLaunch size={64} className="mx-auto text-primary-orange animate-bounce" />
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-900 shadow-lg shadow-green-500/50" />
        </div>
        <h2 className="text-4xl font-black bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent uppercase tracking-tighter">
          Final Launch
        </h2>
        <p className="text-gray-400 font-medium">Your collection is ready. Let's send it to the blockchain.</p>
      </div>

      <div className="bg-gray-800/30 border border-gray-700/50 p-6 rounded-3xl backdrop-blur-md space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">NFT Standard</label>
            <div className="grid grid-cols-3 gap-2">
              {['ARC3', 'ARC69', 'ARC19'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStandard(s as any)}
                  className={`py-3 rounded-2xl border text-xs font-black transition-all ${
                    standard === s ? 'bg-primary-orange text-black border-primary-orange shadow-lg shadow-primary-orange/20' : 'bg-gray-900/50 border-gray-800 text-gray-500 hover:border-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">IPFS Provider</label>
            <div className="grid grid-cols-2 gap-2">
              {['Crust', 'Pinata'].map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p as any)}
                  className={`py-3 rounded-2xl border text-xs font-black transition-all ${
                    provider === p ? 'bg-primary-orange text-black border-primary-orange shadow-lg shadow-primary-orange/20' : 'bg-gray-900/50 border-gray-800 text-gray-500 hover:border-gray-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">{provider} API Token</label>
          <input 
            type="password"
            value={ipfsToken}
            onChange={(e) => {
               setIpfsToken(e.target.value);
               localStorage.setItem('authBasic', e.target.value);
            }}
            placeholder={`Paste your ${provider} API Key here...`}
            className="w-full bg-gray-900/50 border border-gray-800 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <button 
          onClick={handleMint}
          disabled={isMinting || !activeAccount}
          className="group relative w-full overflow-hidden bg-white text-black font-black py-5 rounded-3xl shadow-2xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-30 disabled:grayscale disabled:hover:scale-100"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary-orange to-secondary-orange opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative flex items-center justify-center gap-3 text-lg tracking-tight group-hover:text-black">
            {isMinting ? (
               <MdHourglassEmpty className="animate-spin" />
            ) : (
               <MdRocketLaunch size={24} />
            )}
            {isMinting ? 'PREPARING LAUNCH...' : 'LAUNCH COLLECTION'}
          </span>
        </button>

        {isMinting && (
          <div className="space-y-3 px-2">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
              <span>{progress.status}</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-primary-orange shadow-[0_0_10px_rgba(255,120,43,0.5)] transition-all duration-700 ease-out" 
                 style={{ width: `${(progress.current / progress.total) * 100}%` }}
               />
            </div>
          </div>
        )}

        {!activeAccount && (
          <div className="flex items-center justify-center gap-2 text-red-400 text-xs font-black uppercase tracking-tighter animate-pulse">
            <MdError size={18} /> Wallet Disconnected
          </div>
        )}
      </div>

      <div className="bg-yellow-900/10 border border-yellow-900/30 p-5 rounded-3xl flex gap-4">
        <div className="text-yellow-500 mt-1 flex-shrink-0"><MdCheckCircle size={20} /></div>
        <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500/80">Pro Tip</p>
          <p className="text-xs text-yellow-200/60 leading-relaxed font-medium">
            Standard minting costs approximately 0.101 ALGO per item. Ensure your balance covers the total ({(previewItems.length * 0.101).toFixed(2)} ALGO) plus network fees.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MintStep;
