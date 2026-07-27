import { useState } from 'react';
import { useProject } from '../ProjectContext';
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
import { 
  completeAlgoFileUpload,
  getAlgoFileBatchPaymentRequirements,
  completeAlgoFileBatchUpload,
  uploadFilesToS3,
  confirmAlgoFileBatch
} from '../../../utils/algofile';
import algosdk from 'algosdk';
import { loadImage } from '../ProjectUtils';

const MintStep = () => {
  const { project, previewItems } = useProject();
  const { activeAccount, activeNetwork, transactionSigner } = useWallet();
  const [standard, setStandard] = useState<'ARC3' | 'ARC69' | 'ARC19'>('ARC19');
  const [provider, setProvider] = useState<'AlgoFile' | 'Crust' | 'Pinata'>('AlgoFile');
  const [ipfsToken, setIpfsToken] = useState(localStorage.getItem('authBasic') || '');
  const [isMinting, setIsMinting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: previewItems.length, status: '' });

  const isTestnet = activeNetwork === 'testnet';
  const effectiveProvider = isTestnet && provider === 'Crust' ? 'Pinata' : provider;

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
    if (effectiveProvider !== 'AlgoFile' && !ipfsToken) return toast.error('Please provide an IPFS token');
    if (previewItems.length === 0) return toast.error('No items to mint');

    setIsMinting(true);
    setProgress({ current: 0, total: previewItems.length, status: 'Starting collection launch...' });

    try {
      const mintedData = [];
      const algodClient = new algosdk.Algodv2('', getIndexerURL(activeNetwork!), '');
      
      // 1. Pinning Step
      if (effectiveProvider === 'AlgoFile') {
        setProgress({ current: 0, total: previewItems.length, status: 'Generating image assets...' });
        const imageBlobs: Blob[] = [];
        for (let i = 0; i < previewItems.length; i++) {
          const blob = await generateBlob(previewItems[i]);
          imageBlobs.push(blob);
        }

        // 1. Image Bucket Quote
        setProgress({ current: 0, total: previewItems.length, status: 'Requesting image storage quote...' });
        const imgItems = imageBlobs.map((blob, idx) => ({
          fileName: `image_${previewItems[idx].index}.png`,
          sizeBytes: blob.size,
          contentType: 'image/png'
        }));

        const imgRequirements = await getAlgoFileBatchPaymentRequirements(imgItems);
        const params = await algodClient.getTransactionParams().do();
        const imgAssetId = Number(imgRequirements.asset || 0);
        const imgAmountMicro = BigInt(imgRequirements.amount);
        let imgPaymentTxn;
        if (imgAssetId === 0) {
          imgPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: activeAccount.address,
            to: imgRequirements.payTo,
            amount: imgAmountMicro,
            suggestedParams: params,
          });
        } else {
          imgPaymentTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            from: activeAccount.address,
            to: imgRequirements.payTo,
            amount: imgAmountMicro,
            assetIndex: imgAssetId,
            suggestedParams: params,
          });
        }

        setProgress({ current: 0, total: previewItems.length, status: 'Sign image storage payment in wallet...' });
        const imgSigned = await walletSign([imgPaymentTxn], transactionSigner);
        if (!imgSigned || imgSigned.length === 0) throw new Error('Image storage payment rejected.');
        
        let imgBinary = "";
        for (let k = 0; k < imgSigned[0].byteLength; k++) {
          imgBinary += String.fromCharCode(imgSigned[0][k]);
        }
        const imgSignedB64 = window.btoa(imgBinary);

        setProgress({ current: 0, total: previewItems.length, status: 'Uploading images...' });
        const imgBatchRes = await completeAlgoFileBatchUpload(imgItems, [imgSignedB64], 0, imgRequirements);

        const imgUploadItems = imgBatchRes.items.map((item, idx) => ({
          file: imageBlobs[idx],
          uploadUrl: item.uploadUrl,
          contentType: 'image/png'
        }));
        await uploadFilesToS3(imgUploadItems);

        setProgress({ current: 0, total: previewItems.length, status: 'Confirming images...' });
        const imgConfirmRes = await confirmAlgoFileBatch(imgBatchRes.bucketName, imgBatchRes.items.map((it, idx) => ({
          key: it.key,
          originalName: it.fileName,
          sizeBytes: imageBlobs[idx].size
        })));

        const imageCidsMap = new Map<string, string>();
        imgConfirmRes.items.forEach(it => {
          imageCidsMap.set(it.fileName, it.cid);
        });

        // 2. Build metadata JSONs
        setProgress({ current: 0, total: previewItems.length, status: 'Preparing metadata JSONs...' });
        const metadataList: any[] = [];
        const metadataStrings: string[] = [];
        for (let i = 0; i < previewItems.length; i++) {
          const item = previewItems[i];
          const imgFileName = `image_${item.index}.png`;
          const imageCid = imageCidsMap.get(imgFileName) || '';

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

          metadataList.push(metadata);
          metadataStrings.push(JSON.stringify(metadata));
        }

        if (standard === 'ARC69') {
          for (let i = 0; i < previewItems.length; i++) {
            const assetData: any = {
              asset_name: metadataList[i].name,
              unit_name: project.unitName,
              total_supply: 1,
              decimals: 0,
              asset_url: metadataList[i].image,
              asset_note: metadataList[i],
            };
            mintedData.push(assetData);
          }
        } else {
          setProgress({ current: 0, total: previewItems.length, status: 'Requesting metadata storage quote...' });
          const jsonItems = metadataStrings.map((jsonStr, idx) => ({
            fileName: `metadata_${previewItems[idx].index}.json`,
            sizeBytes: new TextEncoder().encode(jsonStr).length,
            contentType: 'application/json'
          }));

          const jsonRequirements = await getAlgoFileBatchPaymentRequirements(jsonItems);
          const jsonAssetId = Number(jsonRequirements.asset || 0);
          const jsonAmountMicro = BigInt(jsonRequirements.amount);
          let jsonPaymentTxn;
          if (jsonAssetId === 0) {
            jsonPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              from: activeAccount.address,
              to: jsonRequirements.payTo,
              amount: jsonAmountMicro,
              suggestedParams: params,
            });
          } else {
            jsonPaymentTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              from: activeAccount.address,
              to: jsonRequirements.payTo,
              amount: jsonAmountMicro,
              assetIndex: jsonAssetId,
              suggestedParams: params,
            });
          }

          setProgress({ current: 0, total: previewItems.length, status: 'Sign metadata storage payment in wallet...' });
          const jsonSigned = await walletSign([jsonPaymentTxn], transactionSigner);
          if (!jsonSigned || jsonSigned.length === 0) throw new Error('Metadata storage payment rejected.');

          let jsonBinary = "";
          for (let k = 0; k < jsonSigned[0].byteLength; k++) {
            jsonBinary += String.fromCharCode(jsonSigned[0][k]);
          }
          const jsonSignedB64 = window.btoa(jsonBinary);

          setProgress({ current: 0, total: previewItems.length, status: 'Uploading metadata files...' });
          const jsonBatchRes = await completeAlgoFileBatchUpload(jsonItems, [jsonSignedB64], 0, jsonRequirements);

          const jsonUploadItems = jsonBatchRes.items.map((item, idx) => ({
            file: new Blob([metadataStrings[idx]], { type: 'application/json' }),
            uploadUrl: item.uploadUrl,
            contentType: 'application/json'
          }));
          await uploadFilesToS3(jsonUploadItems);

          setProgress({ current: 0, total: previewItems.length, status: 'Confirming metadata...' });
          const jsonConfirmRes = await confirmAlgoFileBatch(jsonBatchRes.bucketName, jsonBatchRes.items.map((it, idx) => ({
            key: it.key,
            originalName: it.fileName,
            sizeBytes: new TextEncoder().encode(metadataStrings[idx]).length
          })));

          const jsonCidsMap = new Map<string, string>();
          jsonConfirmRes.items.forEach(it => {
            jsonCidsMap.set(it.fileName, it.cid);
          });

          for (let i = 0; i < previewItems.length; i++) {
            const item = previewItems[i];
            const jsonFileName = `metadata_${item.index}.json`;
            const jsonCid = jsonCidsMap.get(jsonFileName) || '';

            const assetData: any = {
              asset_name: metadataList[i].name,
              unit_name: project.unitName,
              total_supply: 1,
              decimals: 0,
              asset_url: metadataList[i].image,
              cid: jsonCid,
              ipfs_data: metadataList[i]
            };
            mintedData.push(assetData);
          }
        }
      } else {
        for (let i = 0; i < previewItems.length; i++) {
          const item = previewItems[i];
          setProgress({ current: i + 1, total: previewItems.length, status: `Preparing NFT #${item.index}...` });
          
          const blob = await generateBlob(item);
          
          let imageCid = '';
          if (effectiveProvider === 'Crust') {
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

          const assetData: any = {
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
             if (effectiveProvider === 'Crust') {
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
      }

      // 2. Minting Step
      setProgress({ current: previewItems.length, total: previewItems.length, status: 'Creating transactions...' });
      
      let txnsGroups: algosdk.Transaction[][] = [];
      let localAlgofileUploads: any[] = [];
      
      if (standard === 'ARC3') {
        const result = await createARC3AssetMintArrayV2Batch(
          mintedData,
          activeAccount.address,
          algodClient,
          transactionSigner,
          effectiveProvider === 'AlgoFile' ? 'none' : (effectiveProvider as any),
          ipfsToken
        );
        txnsGroups = result.txnsArray;
        localAlgofileUploads = [];
      } else if (standard === 'ARC19') {
        const result = await createARC19AssetMintArrayV2Batch(
          mintedData,
          activeAccount.address,
          algodClient,
          transactionSigner,
          effectiveProvider === 'AlgoFile' ? 'none' : (effectiveProvider as any),
          ipfsToken
        );
        txnsGroups = result.txnsArray;
        localAlgofileUploads = [];
      } else {
        // ARC69 or Standard
        toast.warning('ARC69 batch minting coming soon. Using ARC19 instead for this demo.');
        const result = await createARC19AssetMintArrayV2Batch(
          mintedData,
          activeAccount.address,
          algodClient,
          transactionSigner,
          effectiveProvider === 'AlgoFile' ? 'none' : (effectiveProvider as any),
          ipfsToken
        );
        txnsGroups = result.txnsArray;
        localAlgofileUploads = [];
      }

      // 3. Signing Loop
      setProgress({ current: previewItems.length, total: previewItems.length, status: 'Awaiting signatures...' });
      
      const chunks = sliceIntoChunks(txnsGroups, 16); // Sign in groups of 16
      const groupSize = effectiveProvider === 'AlgoFile' ? 3 : effectiveProvider === 'Crust' ? 4 : 2;

      for (let i = 0; i < chunks.length; i++) {
        setProgress({ 
          current: previewItems.length, 
          total: previewItems.length, 
          status: `Signing batch ${i + 1} of ${chunks.length}...` 
        });
        const signedTxns = await walletSign(chunks[i], transactionSigner);
        
        // slice the flat array of signed transactions back into their groups
        const signedGroups = sliceIntoChunks(signedTxns, groupSize);
        
        for (let j = 0; j < signedGroups.length; j++) {
          const globalIndex = (i * 16) + j;
          const groupBytes = signedGroups[j];
          await algodClient.sendRawTransaction(groupBytes).do();
          
          if (effectiveProvider === 'AlgoFile' && localAlgofileUploads.length > 0) {
            const upload = localAlgofileUploads.find((u) => u.groupIndex === globalIndex);
            if (upload) {
              try {
                const signedGroupB64 = groupBytes.map((txnBytes: Uint8Array) => {
                  let binary = "";
                  const len = txnBytes.byteLength;
                  for (let k = 0; k < len; k++) {
                    binary += String.fromCharCode(txnBytes[k]);
                  }
                  return window.btoa(binary);
                });

                await completeAlgoFileUpload(
                  upload.file,
                  upload.fileName,
                  signedGroupB64,
                  upload.paymentIndex,
                  upload.requirements
                );
              } catch (uploadErr) {
                console.error("AlgoFile upload failed for index:", globalIndex, uploadErr);
              }
            }
          }
        }
        
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
            <div className="grid grid-cols-3 gap-2">
              {['AlgoFile', 'Crust', 'Pinata'].map((p) => {
                const disabled = isTestnet && p === 'Crust';
                return (
                  <button
                    key={p}
                    disabled={disabled}
                    onClick={() => setProvider(p as any)}
                    className={`py-3 rounded-2xl border text-xs font-black transition-all ${
                      effectiveProvider === p ? 'bg-primary-orange text-black border-primary-orange shadow-lg shadow-primary-orange/20' : 'bg-gray-900/50 border-gray-800 text-gray-500 hover:border-gray-700'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {p === 'AlgoFile' ? 'AlgoFile (USDC)' : p === 'Crust' ? 'Crust' : 'Pinata'}
                  </button>
                );
              })}
            </div>
            {isTestnet && provider === 'Crust' && (
              <p className="mt-2 text-xs text-amber-500 font-medium">
                ⚠️ Crust pinning is disabled on Testnet. Pinata or AlgoFile can be used instead.
              </p>
            )}
          </div>
        </div>

        {effectiveProvider === 'AlgoFile' ? (
          <div className="bg-gray-900/40 p-5 border border-gray-800/80 rounded-3xl text-xs text-gray-400 font-medium leading-relaxed">
            ℹ️ AlgoFile utilizes on-chain x402 pay-per-use payments. No API token or signup is required. You will be prompted to approve a USDC/ALGO storage fee transaction for each upload.
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">{effectiveProvider} API Token</label>
            <input 
              type="password"
              value={ipfsToken}
              onChange={(e) => {
                 setIpfsToken(e.target.value);
                 localStorage.setItem('authBasic', e.target.value);
              }}
              placeholder={`Paste your ${effectiveProvider} API Key here...`}
              className="w-full bg-gray-900/50 border border-gray-800 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
            />
          </div>
        )}
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
