import { useState, useEffect } from 'react';
import { useProject } from '../ProjectContext';
import { 
  MdRocketLaunch, 
  MdCheckCircle, 
  MdError, 
  MdHourglassEmpty, 
  MdCode, 
  MdExpandMore, 
  MdExpandLess,
  MdWarning,
  MdArrowForward,
  MdArrowBack
} from 'react-icons/md';
import { useWallet } from '@txnlab/use-wallet-react';
import { toast } from 'react-toastify';
import confetti from 'canvas-confetti';
import { 
  pinImageToPinata, 
  createARC3AssetMintArrayV2Batch,
  createARC19AssetMintArrayV2Batch,
  createAssetMintArray,
  walletSign,
  chunkGroupsByTxnCount
} from '../../../utils';
import { 
  pinImageToCrust, 
} from '../../../crust';
import { 
  pinImageToFilebase, 
} from '../../../filebase';
import { 
  completeAlgoFileUpload,
  getAlgoFileBatchPaymentRequirements,
  completeAlgoFileBatchUpload,
  uploadFilesToS3,
  confirmAlgoFileBatch
} from '../../../utils/algofile';
import algosdk from 'algosdk';
import { Link } from 'react-router-dom';
import { MdCasino } from 'react-icons/md';
import { buildMintMetadata, renderPreviewToBlob } from '../ProjectUtils';
import { saveLastMint, toSaleNetwork } from '../../../utils/wenpadSale';

const MintStep = () => {
  const { project, previewItems } = useProject();
  const { activeAccount, activeNetwork, transactionSigner, algodClient } = useWallet();
  const [standard, setStandard] = useState<'ARC3' | 'ARC69' | 'ARC19'>('ARC19');
  const [provider, setProvider] = useState<'Filebase' | 'AlgoFile' | 'Crust' | 'Pinata'>('Filebase');
  const [filebaseToken, setFilebaseToken] = useState(
    localStorage.getItem('filebaseToken') || localStorage.getItem('authBasic') || ''
  );
  const [pinataToken, setPinataToken] = useState(
    localStorage.getItem('pinataToken') || ''
  );
  const [ipfsToken, setIpfsToken] = useState(
    localStorage.getItem('authBasic') || ''
  );
  const [isMinting, setIsMinting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: previewItems.length, status: '' });
  const [showMetadataPreview, setShowMetadataPreview] = useState(false);
  const [showFilebaseHelp, setShowFilebaseHelp] = useState(!filebaseToken);
  const [showRawJson, setShowRawJson] = useState(false);
  const [mintComplete, setMintComplete] = useState(false);

  // Batch minting range states
  const maxItems = previewItems.length;
  const [startItem, setStartItem] = useState<number>(1);
  const [endItem, setEndItem] = useState<number>(() => (previewItems.length > 0 ? Math.min(previewItems.length, 500) : 1));

  useEffect(() => {
    if (previewItems.length > 0) {
      setEndItem((prev) => (prev === 1 && previewItems.length > 1 ? Math.min(previewItems.length, 500) : prev));
    }
  }, [previewItems.length]);

  const effectiveStart = Math.max(1, Math.min(startItem, maxItems || 1));
  const effectiveEnd = Math.max(effectiveStart, Math.min(endItem, maxItems || 1));
  const selectedCount = maxItems > 0 ? (effectiveEnd - effectiveStart + 1) : 0;

  const selectPreset = (start: number, end: number) => {
    setStartItem(Math.max(1, start));
    setEndItem(Math.min(maxItems, end));
  };

  const handleNextBatch = () => {
    const batchSize = Math.max(1, effectiveEnd - effectiveStart + 1);
    const nextStart = effectiveEnd + 1;
    if (nextStart > maxItems) {
      toast.info('Already reached the end of the collection');
      return;
    }
    const nextEnd = Math.min(maxItems, nextStart + batchSize - 1);
    setStartItem(nextStart);
    setEndItem(nextEnd);
  };

  const handlePrevBatch = () => {
    const batchSize = Math.max(1, effectiveEnd - effectiveStart + 1);
    if (effectiveStart <= 1) {
      toast.info('Already at the beginning of the collection');
      return;
    }
    const prevStart = Math.max(1, effectiveStart - batchSize);
    const prevEnd = prevStart + batchSize - 1;
    setStartItem(prevStart);
    setEndItem(prevEnd);
  };

  const sampleItem = previewItems.length > 0 ? previewItems[0] : null;
  const sampleMetadata = sampleItem
    ? buildMintMetadata(sampleItem, project, 'QmSampleCIDHashForDemonstration11111111111111', standard)
    : null;

  const isTestnet = activeNetwork === 'testnet';
  const effectiveProvider = isTestnet && provider === 'Crust' ? 'Filebase' : provider;

  const activeToken = effectiveProvider === 'Filebase'
    ? filebaseToken
    : effectiveProvider === 'Pinata'
    ? pinataToken
    : ipfsToken;

  const generateBlob = async (item: any) => {
    return await renderPreviewToBlob(item, project.layers, project.imageWidth, project.imageHeight);
  };

  const handleMint = async () => {
    if (!activeAccount) return toast.error('Please connect your wallet');
    if (effectiveProvider !== 'AlgoFile' && !activeToken) {
      return toast.error(`Please provide your ${effectiveProvider} API token`);
    }
    if (previewItems.length === 0) return toast.error('No items to mint');

    const itemsToMint = previewItems.slice(effectiveStart - 1, effectiveEnd);
    if (itemsToMint.length === 0) return toast.error('Selected mint range is empty');

    const totalToMint = itemsToMint.length;
    setIsMinting(true);
    setProgress({ current: 0, total: totalToMint, status: `Starting batch launch (${totalToMint} NFTs)...` });

    try {
      const mintedData = [];
      
      // 1. Pinning Step
      if (effectiveProvider === 'AlgoFile') {
        setProgress({ current: 0, total: totalToMint, status: 'Generating image assets...' });
        const imageBlobs: Blob[] = [];
        for (let i = 0; i < itemsToMint.length; i++) {
          const blob = await generateBlob(itemsToMint[i]);
          imageBlobs.push(blob);
          setProgress({ current: i + 1, total: totalToMint, status: `Generating image #${itemsToMint[i].index} (${i + 1}/${totalToMint})...` });
        }

        // 1. Image Bucket Quote
        setProgress({ current: 0, total: totalToMint, status: 'Requesting image storage quote...' });
        const imgItems = imageBlobs.map((blob, idx) => ({
          fileName: `image_${itemsToMint[idx].index}.png`,
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

        setProgress({ current: 0, total: totalToMint, status: 'Sign image storage payment in wallet...' });
        const imgSigned = await walletSign([imgPaymentTxn], transactionSigner);
        if (!imgSigned || imgSigned.length === 0) throw new Error('Image storage payment rejected.');
        
        let imgBinary = "";
        for (let k = 0; k < imgSigned[0].byteLength; k++) {
          imgBinary += String.fromCharCode(imgSigned[0][k]);
        }
        const imgSignedB64 = window.btoa(imgBinary);

        setProgress({ current: 0, total: totalToMint, status: 'Uploading images...' });
        const imgBatchRes = await completeAlgoFileBatchUpload(imgItems, [imgSignedB64], 0, imgRequirements);

        const imgUploadItems = imgBatchRes.items.map((item, idx) => ({
          file: imageBlobs[idx],
          uploadUrl: item.uploadUrl,
          contentType: 'image/png'
        }));
        await uploadFilesToS3(imgUploadItems);

        setProgress({ current: 0, total: totalToMint, status: 'Confirming images...' });
        const imgConfirmRes = await confirmAlgoFileBatch(imgBatchRes.bucketName, imgBatchRes.items.map((it, idx) => ({
          key: it.key,
          originalName: it.fileName,
          sizeBytes: imageBlobs[idx].size
        })));

        const imageCidsMap = new Map<string, string>();
        imgConfirmRes.items.forEach(it => {
          imageCidsMap.set(it.fileName, it.cid);
        });
        const missingImage = itemsToMint.find((item) => !imageCidsMap.get(`image_${item.index}.png`));
        if (missingImage) throw new Error(`AlgoFile did not return a CID for image #${missingImage.index}. Nothing was minted.`);

        // 2. Build metadata JSONs
        setProgress({ current: 0, total: totalToMint, status: 'Preparing metadata JSONs...' });
        const metadataList: any[] = [];
        const metadataStrings: string[] = [];
        for (let i = 0; i < itemsToMint.length; i++) {
          const item = itemsToMint[i];
          const imgFileName = `image_${item.index}.png`;
          const imageCid = imageCidsMap.get(imgFileName) || '';

          const metadata = buildMintMetadata(item, project, imageCid, standard);
          metadataList.push(metadata);
          metadataStrings.push(JSON.stringify(metadata));
        }

        if (standard === 'ARC69') {
          for (let i = 0; i < itemsToMint.length; i++) {
            const item = itemsToMint[i];
            const imgFileName = `image_${item.index}.png`;
            const imageCid = imageCidsMap.get(imgFileName) || '';
            const assetData: any = {
              asset_name: metadataList[i].name || `${project.name ? project.name + ' ' : ''}#${item.index}`,
              unit_name: project.unitName,
              total_supply: 1,
              decimals: 0,
              asset_url: `ipfs://${imageCid}`,
              asset_note: metadataList[i],
            };
            mintedData.push(assetData);
          }
        } else {
          setProgress({ current: 0, total: totalToMint, status: 'Requesting metadata storage quote...' });
          const jsonItems = metadataStrings.map((jsonStr, idx) => ({
            fileName: `metadata_${itemsToMint[idx].index}.json`,
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

          setProgress({ current: 0, total: totalToMint, status: 'Sign metadata storage payment in wallet...' });
          const jsonSigned = await walletSign([jsonPaymentTxn], transactionSigner);
          if (!jsonSigned || jsonSigned.length === 0) throw new Error('Metadata storage payment rejected.');

          let jsonBinary = "";
          for (let k = 0; k < jsonSigned[0].byteLength; k++) {
            jsonBinary += String.fromCharCode(jsonSigned[0][k]);
          }
          const jsonSignedB64 = window.btoa(jsonBinary);

          setProgress({ current: 0, total: totalToMint, status: 'Uploading metadata files...' });
          const jsonBatchRes = await completeAlgoFileBatchUpload(jsonItems, [jsonSignedB64], 0, jsonRequirements);

          const jsonUploadItems = jsonBatchRes.items.map((item, idx) => ({
            file: new Blob([metadataStrings[idx]], { type: 'application/json' }),
            uploadUrl: item.uploadUrl,
            contentType: 'application/json'
          }));
          await uploadFilesToS3(jsonUploadItems);

          setProgress({ current: 0, total: totalToMint, status: 'Confirming metadata...' });
          const jsonConfirmRes = await confirmAlgoFileBatch(jsonBatchRes.bucketName, jsonBatchRes.items.map((it, idx) => ({
            key: it.key,
            originalName: it.fileName,
            sizeBytes: new TextEncoder().encode(metadataStrings[idx]).length
          })));

          const jsonCidsMap = new Map<string, string>();
          jsonConfirmRes.items.forEach(it => {
            jsonCidsMap.set(it.fileName, it.cid);
          });
          const missingJson = itemsToMint.find((item) => !jsonCidsMap.get(`metadata_${item.index}.json`));
          if (missingJson) throw new Error(`AlgoFile did not return a CID for metadata #${missingJson.index}. Nothing was minted.`);

          for (let i = 0; i < itemsToMint.length; i++) {
            const item = itemsToMint[i];
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
        for (let i = 0; i < itemsToMint.length; i++) {
          const item = itemsToMint[i];
          setProgress({ current: i + 1, total: totalToMint, status: `Uploading image #${item.index} (${i + 1}/${totalToMint}) to ${effectiveProvider}...` });
          
          const blob = await generateBlob(item);
          const imageFile = new File([blob], `image_${item.index}.png`, { type: 'image/png' });
          
          let imageCid = '';
          if (effectiveProvider === 'Filebase') {
            imageCid = await pinImageToFilebase(filebaseToken, imageFile);
          } else if (effectiveProvider === 'Crust') {
            imageCid = await pinImageToCrust(ipfsToken, blob);
          } else {
            imageCid = await pinImageToPinata(pinataToken, blob);
          }

          const metadata = buildMintMetadata(item, project, imageCid, standard);

          const assetData: any = {
            asset_name: metadata.name || `${project.name ? project.name + ' ' : ''}#${item.index}`,
            unit_name: project.unitName,
            total_supply: 1,
            decimals: 0,
            asset_url: `ipfs://${imageCid}`,
          };

          if (standard === 'ARC69') {
             assetData.asset_note = metadata;
          } else {
             assetData.ipfs_data = metadata;
          }

          mintedData.push(assetData);
          toast.info(`Uploaded image ${i + 1}/${totalToMint}`, { autoClose: 500 });
        }
      }

      // 2. Minting Step
      setProgress({ current: totalToMint, total: totalToMint, status: 'Creating transactions...' });
      
      let txnsGroups: algosdk.Transaction[][] = [];
      let localAlgofileUploads: any[] = [];
      let buildErrors: string[] = [];

      const batchProvider: any = effectiveProvider === 'AlgoFile' ? 'none' : effectiveProvider.toLowerCase();
      const batchToken = effectiveProvider === 'Filebase' ? filebaseToken : effectiveProvider === 'Pinata' ? pinataToken : ipfsToken;
      
      if (standard === 'ARC3') {
        const result = await createARC3AssetMintArrayV2Batch(
          mintedData,
          activeAccount.address,
          algodClient,
          transactionSigner,
          batchProvider,
          batchToken
        );
        txnsGroups = result.txnsArray;
        buildErrors = result.errors;
        localAlgofileUploads = [];
      } else if (standard === 'ARC19') {
        const result = await createARC19AssetMintArrayV2Batch(
          mintedData,
          activeAccount.address,
          algodClient,
          transactionSigner,
          batchProvider,
          batchToken
        );
        txnsGroups = result.txnsArray;
        buildErrors = result.errors;
        localAlgofileUploads = [];
      } else {
        // ARC69
        const result = await createAssetMintArray(
          mintedData,
          activeAccount.address,
          algodClient
        );
        txnsGroups = result;
        localAlgofileUploads = [];
      }

      // The batch builders skip items that fail (pinning, bad CID, network) instead of throwing,
      // so make sure every selected item produced a transaction group before asking for signatures.
      if (txnsGroups.length !== totalToMint) {
        const reason = buildErrors[0] ? ` First error: ${buildErrors[0]}` : ' See the browser console for details.';
        throw new Error(`Only ${txnsGroups.length} of ${totalToMint} mint transactions could be prepared, so nothing was sent.${reason}`);
      }

      // 3. Signing Loop
      setProgress({ current: totalToMint, total: totalToMint, status: 'Awaiting signatures...' });
      
      // One wallet prompt per chunk of up to 500 transactions (250 NFTs of 2-txn groups);
      // walletSign flattens each chunk's groups into a single sign request.
      const chunks = chunkGroupsByTxnCount(txnsGroups);
      const createdAssetIds: number[] = [];
      let groupsBefore = 0;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkStart = groupsBefore;
        groupsBefore += chunk.length;
        setProgress({ 
          current: Math.round(((i + 1) / chunks.length) * totalToMint), 
          total: totalToMint, 
          status: chunks.length === 1
            ? `Approve all ${chunk.length} NFTs in your wallet (one request)...`
            : `Approve batch ${i + 1} of ${chunks.length} in your wallet (${chunk.length} NFTs)...`
        });
        const signedTxns = await walletSign(chunk, transactionSigner);
        
        if (signedTxns.length !== chunk.flat().length) {
          throw new Error(`Wallet returned ${signedTxns.length} of ${chunk.flat().length} signed transactions. Nothing in this batch was sent.`);
        }

        const createTxIds: string[] = [];
        let offset = 0;
        for (let j = 0; j < chunk.length; j++) {
          const createTxn = chunk[j].find((t: algosdk.Transaction) => t.type === algosdk.TransactionType.acfg);
          if (createTxn) createTxIds.push(createTxn.txID());
          const gLen = chunk[j].length;
          const groupBytes = signedTxns.slice(offset, offset + gLen);
          offset += gLen;
          const globalIndex = chunkStart + j;
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
        
        // Don't report success until the network has actually created the assets.
        setProgress({
          current: Math.round(((i + 1) / chunks.length) * totalToMint),
          total: totalToMint,
          status: `Confirming batch ${i + 1} of ${chunks.length} on-chain...`
        });
        for (const txId of createTxIds) {
          const confirmed = await algosdk.waitForConfirmation(algodClient, txId, 10);
          const assetId = Number(confirmed['asset-index'] || 0);
          if (!assetId) throw new Error(`Transaction ${txId} confirmed but no asset was created.`);
          createdAssetIds.push(assetId);
        }

        toast.success(`Batch ${i + 1} of ${chunks.length} confirmed!`);
      }

      if (createdAssetIds.length !== totalToMint) {
        throw new Error(`Only ${createdAssetIds.length} of ${totalToMint} assets were confirmed on-chain.`);
      }
      console.log('WenPad minted asset IDs:', createdAssetIds);

      setProgress({ current: totalToMint, total: totalToMint, status: `Batch Minted! Asset IDs: ${createdAssetIds[0]}${createdAssetIds.length > 1 ? `–${createdAssetIds[createdAssetIds.length - 1]}` : ''}` });
      confetti({
        particleCount: 200,
        spread: 100,
        origin: { y: 0.6 }
      });
      toast.success(`Successfully launched ${totalToMint} NFTs (Items #${effectiveStart}–#${effectiveEnd})!`);

      // Hand the collection details to the sale launcher so it can pre-fill
      saveLastMint({
        network: toSaleNetwork(activeNetwork),
        creator: activeAccount.address,
        name: project.name || '',
        unitName: project.unitName || '',
        standard,
        count: totalToMint,
        mintedAt: Date.now(),
      });
      setMintComplete(true);

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
        <div className="mx-auto w-20 h-20 rounded-3xl bg-primary-orange/10 border border-primary-orange/30 flex items-center justify-center text-primary-orange shadow-[0_0_40px_-12px_rgb(var(--brand)/0.7)]">
          <MdRocketLaunch size={40} />
        </div>
        <h2 className="text-4xl font-black bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent uppercase tracking-tighter">
          Final Launch
        </h2>
        <p className="text-gray-400 font-medium">Your collection is ready. Let's send it to the blockchain.</p>
      </div>

      <div className="bg-banner-grey/30 border border-white/[0.12] p-6 rounded-3xl backdrop-blur-md space-y-6">
        {/* Mint Batch Range Selector */}
        <div className="p-5 rounded-2xl bg-primary-black/70 border border-white/[0.08] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em]">
                  Mint Batch Range
                </label>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-orange/15 text-primary-orange border border-primary-orange/20">
                  {selectedCount} of {maxItems} selected
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Mint in batches to stay within wallet transaction limits (Pera &le; 750) or free IPFS quotas.
              </p>
            </div>

            {/* Batch Navigation Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handlePrevBatch}
                disabled={effectiveStart <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-white/[0.08] bg-asset-detail-bg/60 hover:bg-banner-grey text-xs font-bold text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                title="Shift to previous batch"
              >
                <MdArrowBack size={14} />
                <span>Prev Batch</span>
              </button>
              <button
                type="button"
                onClick={handleNextBatch}
                disabled={effectiveEnd >= maxItems}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-white/[0.08] bg-asset-detail-bg/60 hover:bg-banner-grey text-xs font-bold text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                title="Shift to next batch"
              >
                <span>Next Batch</span>
                <MdArrowForward size={14} />
              </button>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mr-1">Presets:</span>
            <button
              type="button"
              onClick={() => selectPreset(1, maxItems)}
              className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                effectiveStart === 1 && effectiveEnd === maxItems
                  ? 'bg-primary-orange/20 border-primary-orange text-primary-orange'
                  : 'bg-asset-detail-bg/50 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.12]'
              }`}
            >
              All ({maxItems})
            </button>
            {maxItems > 100 && (
              <button
                type="button"
                onClick={() => selectPreset(1, 100)}
                className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  effectiveStart === 1 && effectiveEnd === 100
                    ? 'bg-primary-orange/20 border-primary-orange text-primary-orange'
                    : 'bg-asset-detail-bg/50 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.12]'
                }`}
              >
                1 – 100 (Free Tier)
              </button>
            )}
            {maxItems > 250 && (
              <button
                type="button"
                onClick={() => selectPreset(1, 250)}
                className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  effectiveStart === 1 && effectiveEnd === 250
                    ? 'bg-primary-orange/20 border-primary-orange text-primary-orange'
                    : 'bg-asset-detail-bg/50 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.12]'
                }`}
              >
                1 – 250 (Safe Batch)
              </button>
            )}
            {maxItems > 500 && (
              <button
                type="button"
                onClick={() => selectPreset(1, 500)}
                className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  effectiveStart === 1 && effectiveEnd === 500
                    ? 'bg-primary-orange/20 border-primary-orange text-primary-orange'
                    : 'bg-asset-detail-bg/50 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/[0.12]'
                }`}
              >
                1 – 500 (Max Recommended)
              </button>
            )}
          </div>

          {/* Inputs for Start and End Index */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 ml-1">
                From Item # (1 to {maxItems})
              </label>
              <input
                type="number"
                min={1}
                max={maxItems}
                value={startItem}
                onChange={(e) => setStartItem(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-asset-detail-bg/70 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white font-bold focus:border-primary-orange/50 outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 ml-1">
                To Item # ({effectiveStart} to {maxItems})
              </label>
              <input
                type="number"
                min={effectiveStart}
                max={maxItems}
                value={endItem}
                onChange={(e) => setEndItem(Math.max(effectiveStart, parseInt(e.target.value) || effectiveStart))}
                className="w-full bg-asset-detail-bg/70 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white font-bold focus:border-primary-orange/50 outline-none"
              />
            </div>
          </div>

          {/* Pera Wallet Limit Alert */}
          {selectedCount > 750 && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <MdWarning size={18} className="shrink-0 mt-0.5 text-amber-400" />
              <div>
                <span className="font-bold">Pera Wallet Warning:</span> Signing more than 750 items ({selectedCount} selected) often times out or crashes mobile wallets like Pera. We strongly recommend reducing your batch to 250–500 items at a time.
              </div>
            </div>
          )}

          {/* Pinata Free Tier Alert */}
          {effectiveProvider === 'Pinata' && selectedCount > 100 && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs">
              <MdCheckCircle size={18} className="shrink-0 mt-0.5 text-blue-400" />
              <div>
                <span className="font-bold">Pinata Free Tier Notice:</span> Free Pinata accounts allow 100 pins. If using multiple free accounts, mint up to 100 items at a time, then update your Pinata JWT below before clicking &ldquo;Next Batch&rdquo;.
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">NFT Standard</label>
            <div className="grid grid-cols-3 gap-2">
              {['ARC3', 'ARC69', 'ARC19'].map((s) => (
                <button
                  key={s}
                  onClick={() => setStandard(s as any)}
                  className={`h-11 px-3 rounded-2xl border text-xs font-black transition-all flex items-center justify-center whitespace-nowrap ${
                    standard === s ? 'bg-primary-orange text-black border-primary-orange shadow-lg shadow-primary-orange/20' : 'bg-asset-detail-bg/50 border-white/[0.08] text-gray-500 hover:border-white/[0.12]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">IPFS Provider</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['Filebase', 'AlgoFile', 'Crust', 'Pinata'] as const).map((p) => {
                const disabled = isTestnet && p === 'Crust';
                return (
                  <button
                    key={p}
                    disabled={disabled}
                    onClick={() => setProvider(p)}
                    className={`h-11 px-2 rounded-2xl border text-xs font-black transition-all flex items-center justify-center whitespace-nowrap ${
                      effectiveProvider === p ? 'bg-primary-orange text-black border-primary-orange shadow-lg shadow-primary-orange/20' : 'bg-asset-detail-bg/50 border-white/[0.08] text-gray-500 hover:border-white/[0.12]'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            {isTestnet && provider === 'Crust' && (
              <p className="mt-2 text-xs text-amber-500 font-medium">
                ⚠️ Crust pinning is disabled on Testnet. Filebase, Pinata, or AlgoFile can be used instead.
              </p>
            )}
          </div>
        </div>

        {effectiveProvider === 'AlgoFile' ? (
          <div className="bg-asset-detail-bg/40 p-5 border border-white/[0.08] rounded-3xl text-xs text-gray-400 font-medium leading-relaxed">
            ℹ️ AlgoFile utilizes on-chain x402 pay-per-use payments. No API token or signup is required. You will be prompted to approve a USDC/ALGO storage fee transaction for each upload.
          </div>
        ) : effectiveProvider === 'Filebase' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">Filebase API Token</label>
              <a
                href="https://console.filebase.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-primary-orange hover:underline font-bold"
              >
                Get Filebase Key →
              </a>
            </div>
            <input 
              type="password"
              value={filebaseToken}
              onChange={(e) => {
                 setFilebaseToken(e.target.value);
                 localStorage.setItem('filebaseToken', e.target.value);
              }}
              placeholder="Paste your Filebase API Token here..."
              className="w-full bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
            />
            <p className="text-[11px] text-gray-500 ml-1">
              Filebase offers 5 GB free IPFS storage. Your token is saved only in this browser and is sent only to Filebase.
            </p>

            <div className="bg-asset-detail-bg/40 border border-white/[0.08] rounded-3xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFilebaseHelp(!showFilebaseHelp)}
                className="w-full px-5 py-4 flex items-center justify-between text-xs font-black text-gray-300 hover:bg-white/[0.02] transition-colors"
              >
                <span>{filebaseToken ? 'How to get a Filebase token' : 'New to Filebase? Get started in 4 steps'}</span>
                {showFilebaseHelp ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
              </button>
              {showFilebaseHelp && (
                <div className="px-5 pb-5 space-y-4 text-xs text-gray-400 font-medium leading-relaxed">
                  <ol className="space-y-3">
                    <li className="flex gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary-orange/10 border border-primary-orange/30 text-primary-orange font-black flex items-center justify-center text-[11px]">1</span>
                      <span>
                        <span className="text-gray-200 font-bold">Create a free account</span> at{' '}
                        <a href="https://console.filebase.com/signup" target="_blank" rel="noreferrer" className="text-primary-orange hover:underline">filebase.com</a>{' '}
                        and confirm your email. No credit card is needed for the free tier.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary-orange/10 border border-primary-orange/30 text-primary-orange font-black flex items-center justify-center text-[11px]">2</span>
                      <span>
                        <span className="text-gray-200 font-bold">Create an IPFS bucket.</span> Open{' '}
                        <a href="https://console.filebase.com/buckets" target="_blank" rel="noreferrer" className="text-primary-orange hover:underline">Buckets</a>,
                        click <span className="text-gray-200">Create Bucket</span>, give it a name (e.g. your collection name) and make sure the storage network is <span className="text-gray-200">IPFS</span>.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary-orange/10 border border-primary-orange/30 text-primary-orange font-black flex items-center justify-center text-[11px]">3</span>
                      <span>
                        <span className="text-gray-200 font-bold">Generate the IPFS RPC token.</span> Go to{' '}
                        <a href="https://console.filebase.com/keys" target="_blank" rel="noreferrer" className="text-primary-orange hover:underline">Access Keys</a>,
                        scroll to the <span className="text-gray-200">IPFS RPC API</span> section, and choose your bucket from the dropdown. Copy the token it generates.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary-orange/10 border border-primary-orange/30 text-primary-orange font-black flex items-center justify-center text-[11px]">4</span>
                      <span>
                        <span className="text-gray-200 font-bold">Paste it in the field above</span>, then hit mint. Your images and metadata will be pinned into that bucket and you can browse them in the Filebase console afterwards.
                      </span>
                    </li>
                  </ol>
                  <div className="flex gap-2 p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-amber-500/90">
                    <MdWarning size={16} className="shrink-0 mt-0.5" />
                    <span>
                      Use the <span className="font-bold">IPFS RPC token</span>, not the S3 Key / Secret pair shown at the top of the Access Keys page. Those will fail with an authorization error.
                    </span>
                  </div>
                  <p className="text-gray-500">
                    Tip: for large collections, mint a small test batch first to confirm your token works before uploading everything.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : effectiveProvider === 'Pinata' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">Pinata JWT Token</label>
              <a
                href="https://app.pinata.cloud/developers/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-primary-orange hover:underline font-bold"
              >
                Get Pinata Key →
              </a>
            </div>
            <input 
              type="password"
              value={pinataToken}
              onChange={(e) => {
                 setPinataToken(e.target.value);
                 localStorage.setItem('pinataToken', e.target.value);
              }}
              placeholder="Paste your Pinata JWT here..."
              className="w-full bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] ml-1">Crust API Token</label>
            <input 
              type="password"
              value={ipfsToken}
              onChange={(e) => {
                 setIpfsToken(e.target.value);
                 localStorage.setItem('authBasic', e.target.value);
              }}
              placeholder="Paste your Crust API Key here..."
              className="w-full bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
            />
          </div>
        )}
      </div>

      {sampleMetadata && (
        <div className="bg-banner-grey/30 border border-white/[0.12] rounded-3xl backdrop-blur-md overflow-hidden transition-all">
          <div 
            onClick={() => setShowMetadataPreview(!showMetadataPreview)}
            className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary-orange/10 border border-primary-orange/30 flex items-center justify-center text-primary-orange font-bold">
                <MdCode size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-black text-white">Trait Metadata Verification</h4>
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-orange/20 text-primary-orange border border-primary-orange/40">
                    {standard}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  Inspect the exact trait attributes and properties attached to your NFT mints
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
              <span>{sampleMetadata.attributes?.length || 0} traits</span>
              <button type="button" className="p-1 text-gray-400 hover:text-white">
                {showMetadataPreview ? <MdExpandLess size={22} /> : <MdExpandMore size={22} />}
              </button>
            </div>
          </div>

          {showMetadataPreview && (
            <div className="p-5 pt-0 border-t border-white/[0.08] space-y-4">
              <div className="flex items-center justify-between text-xs pt-4">
                <span className="text-gray-400 font-medium">Sample Preview: <span className="text-white font-bold">{sampleMetadata.name || `#${sampleItem?.index}`}</span></span>
                <button
                  type="button"
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="px-3 py-1 rounded-xl bg-asset-detail-bg border border-white/[0.12] text-gray-300 hover:text-white text-xs font-semibold transition-colors"
                >
                  {showRawJson ? 'View Visual Traits' : 'View Raw JSON'}
                </button>
              </div>

              {!showRawJson ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {sampleMetadata.attributes?.map((attr: any, idx: number) => (
                    <div key={idx} className="bg-asset-detail-bg/70 border border-white/[0.08] rounded-2xl p-3 flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-wider text-primary-orange/80 truncate">
                        {attr.trait_type}
                      </span>
                      <span className="text-xs font-bold text-white mt-0.5 truncate">
                        {attr.value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 text-[11px] font-mono text-emerald-400 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(sampleMetadata, null, 2)}
                </pre>
              )}

              <p className="text-[11px] text-gray-500 leading-normal">
                ✓ Validated: All {selectedCount} selected items ({effectiveStart} to {effectiveEnd}) will have these ARC-compliant trait structures embedded directly into their metadata and on-chain records.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <button 
          onClick={handleMint}
          disabled={isMinting || !activeAccount || selectedCount === 0}
          className="group relative w-full overflow-hidden bg-white text-black font-black py-5 rounded-3xl shadow-2xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-30 disabled:grayscale disabled:hover:scale-100 cursor-pointer"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary-orange to-secondary-orange opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative flex items-center justify-center gap-3 text-lg tracking-tight group-hover:text-black">
            {isMinting ? (
               <MdHourglassEmpty className="animate-spin" />
            ) : (
               <MdRocketLaunch size={24} />
            )}
            {isMinting
              ? `LAUNCHING BATCH (${progress.current}/${progress.total})...`
              : selectedCount === maxItems
              ? `LAUNCH ALL ${maxItems} NFTS`
              : `LAUNCH BATCH (${selectedCount} NFTS: #${effectiveStart}–#${effectiveEnd})`}
          </span>
        </button>

        {isMinting && (
          <div className="space-y-3 px-2">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
              <span>{progress.status}</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 bg-banner-grey rounded-full overflow-hidden">
               <div 
                 className="h-full bg-primary-orange shadow-[0_0_10px_rgba(255,120,43,0.5)] transition-all duration-700 ease-out" 
                 style={{ width: `${(progress.current / progress.total) * 100}%` }}
               />
            </div>
          </div>
        )}

        {mintComplete && (
          <div className="p-6 rounded-3xl border border-primary-orange/40 bg-primary-orange/10 flex flex-col sm:flex-row items-center gap-5 text-left">
            <MdCasino size={44} className="text-primary-orange shrink-0" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-black text-white uppercase tracking-tight">Now sell it as a random mint</p>
              <p className="text-xs text-gray-300 leading-relaxed">
                Launch a Shuffle: buyers pay and receive a random NFT from your collection, handed out by a smart
                contract. No keys shared with anyone, and your sale shows up on the wen.tools Shuffle page.
              </p>
            </div>
            <Link
              to="/shuffle?tab=launch"
              className="shrink-0 px-5 py-3 rounded-2xl bg-primary-orange text-black font-black text-sm uppercase tracking-wider hover:brightness-110 transition-all"
            >
              Launch a Shuffle →
            </Link>
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
            Standard minting costs approximately 0.101 ALGO per item. Ensure your wallet balance covers this batch (~{(selectedCount * 0.101).toFixed(2)} ALGO for {selectedCount} items) plus network fees.
            {maxItems > selectedCount && (
              <span className="block mt-1 text-yellow-300/80">
                Total collection ({maxItems} items): ~{(maxItems * 0.101).toFixed(2)} ALGO.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

export default MintStep;
