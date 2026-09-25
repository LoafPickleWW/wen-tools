import { useState, useMemo } from 'react';
import { useProject } from '../ProjectContext';
import { 
  MdRefresh, 
  MdNavigateBefore, 
  MdNavigateNext, 
  MdSearch, 
  MdClose, 
  MdInfoOutline, 
  MdDeleteSweep, 
  MdWarning,
  MdDownload,
  MdBlock,
  MdElectricBolt,
  MdDelete,
  MdAdd,
  MdRule,
  MdDataObject,
  MdEdit,
  MdCheck
} from 'react-icons/md';
import { saveAs } from 'file-saver';
import { toast } from 'react-toastify';
import PreviewImage from '../PreviewImage';
import { PreviewItemT, RuleT } from '../WenPadTypes';
import { renderPreviewToBlob, buildItemMetadata, buildCollectionTraitSummary } from '../ProjectUtils';

const PreviewStep = () => {
  const { 
    generatePreviewItems, previewItems, filteredPreviewItems, generateIsLoading, 
    sortBy, setSortBy, project, purgeDeletedTraitAssets,
    addTraitRule, deleteTraitRule, updatePreviewItemTraitName
  } = useProject();

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(24);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<PreviewItemT | null>(null);

  // In-modal trait editing state
  const [editingItemTraitLayer, setEditingItemTraitLayer] = useState<string | null>(null);
  const [editingItemTraitVal, setEditingItemTraitVal] = useState<string>('');

  // Previews export state
  const [exportingZip, setExportingZip] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  // In-modal rule creator state
  const [ruleCreator, setRuleCreator] = useState<{
    sourceLayerId: string;
    sourceTraitId: string;
    sourceLayerName: string;
    sourceTraitName: string;
    ruleType: 'block' | 'force';
    targetLayerId: string;
    targetTraitId: string;
  } | null>(null);

  // Single preview item PNG download
  const handleDownloadSingle = async (item: PreviewItemT) => {
    try {
      const blob = await renderPreviewToBlob(item, project.layers, project.imageWidth, project.imageHeight);
      const safeProjectName = (project.name || 'NFT').replace(/[^a-zA-Z0-9_-]/g, '_');
      saveAs(blob, `#${item.index}_${safeProjectName}.png`);
      toast.success(`Downloaded preview #${item.index}`);
    } catch (err) {
      console.error('Download error:', err);
      toast.error('Failed to download preview image');
    }
  };

  // Single preview item Metadata JSON download
  const handleDownloadSingleJson = (item: PreviewItemT) => {
    try {
      const safeProjectName = (project.name || 'NFT').replace(/[^a-zA-Z0-9_-]/g, '_');
      const itemMetadata = buildItemMetadata(item, project, `#${item.index}_${safeProjectName}.png`);
      const blob = new Blob([JSON.stringify(itemMetadata, null, 2)], { type: 'application/json' });
      saveAs(blob, `#${item.index}_${safeProjectName}.json`);
      toast.success(`Downloaded metadata for #${item.index}`);
    } catch (err) {
      console.error('Download metadata error:', err);
      toast.error('Failed to download metadata JSON');
    }
  };

  // Bulk Metadata-only JSON export
  const handleDownloadMetadataOnly = (itemsToExport: PreviewItemT[], label: string) => {
    if (itemsToExport.length === 0) {
      toast.info('No items to export');
      return;
    }
    try {
      const safeProjectName = (project.name || 'NFT').replace(/[^a-zA-Z0-9_-]/g, '_');
      const allMetadataList = itemsToExport.map((item) => {
        const paddedIndex = String(item.index).padStart(4, '0');
        return buildItemMetadata(item, project, `images/${paddedIndex}_${safeProjectName}.png`);
      });

      const jsonStr = JSON.stringify(allMetadataList, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      saveAs(blob, `${safeProjectName}_metadata_${label}.json`);
      toast.success(`Exported metadata JSON for ${itemsToExport.length} items!`);
      setDownloadMenuOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to export metadata JSON');
    }
  };

  // Bulk ZIP download (includes images + metadata JSON files + master _metadata.json)
  const handleDownloadZip = async (itemsToExport: PreviewItemT[], label: string) => {
    if (itemsToExport.length === 0) {
      toast.info('No items to export');
      return;
    }
    setDownloadMenuOpen(false);
    setExportingZip(true);
    setExportProgress({ current: 0, total: itemsToExport.length });

    try {
      const zipData: { [filename: string]: Uint8Array } = {};
      const safeProjectName = (project.name || 'NFT').replace(/[^a-zA-Z0-9_-]/g, '_');
      const encoder = new TextEncoder();
      const allMetadataList: any[] = [];

      for (let i = 0; i < itemsToExport.length; i++) {
        const item = itemsToExport[i];
        setExportProgress({ current: i + 1, total: itemsToExport.length });

        const paddedIndex = String(item.index).padStart(4, '0');
        const imgFileName = `${paddedIndex}_${safeProjectName}.png`;

        // Render preview image
        const blob = await renderPreviewToBlob(item, project.layers, project.imageWidth || 1000, project.imageHeight || 1000);
        const arrayBuffer = await blob.arrayBuffer();

        // Save image into images/ folder
        zipData[`images/${imgFileName}`] = new Uint8Array(arrayBuffer);

        // Build item metadata JSON
        const itemMetadata = buildItemMetadata(item, project, `images/${imgFileName}`);
        allMetadataList.push(itemMetadata);

        const itemJsonStr = JSON.stringify(itemMetadata, null, 2);
        const itemJsonBytes = encoder.encode(itemJsonStr);

        // Save individual metadata files into metadata/ folder
        zipData[`metadata/${paddedIndex}_${safeProjectName}.json`] = itemJsonBytes;
        zipData[`metadata/${item.index}.json`] = itemJsonBytes;
      }

      // Add master collection metadata files at root of ZIP
      const masterMetadataStr = JSON.stringify(allMetadataList, null, 2);
      const masterMetadataBytes = encoder.encode(masterMetadataStr);
      zipData['_metadata.json'] = masterMetadataBytes;
      zipData['metadata.json'] = masterMetadataBytes;

      // Add collection trait summary distribution report
      const traitSummary = buildCollectionTraitSummary(itemsToExport, project);
      zipData['trait_summary.json'] = encoder.encode(JSON.stringify(traitSummary, null, 2));

      const { zip } = await import('fflate');
      zip(zipData, (err, out) => {
        if (err) {
          toast.error('Failed to compress ZIP');
          setExportingZip(false);
          setExportProgress(null);
          return;
        }
        const zipBlob = new Blob([out as any], { type: 'application/zip' });
        saveAs(zipBlob, `${safeProjectName}_previews_${label}.zip`);
        toast.success(`Exported ${itemsToExport.length} preview images & metadata!`);
        setExportingZip(false);
        setExportProgress(null);
      });
    } catch (err) {
      console.error(err);
      toast.error('Error exporting previews');
      setExportingZip(false);
      setExportProgress(null);
    }
  };

  // Check how many preview items are corrupted (have deleted traits or no valid traits)
  const corruptedItemsCount = useMemo(() => {
    if (!previewItems || previewItems.length === 0) return 0;
    const validTraitsByLayer = new Map<string, Set<string>>();
    for (const layer of project.layers || []) {
      validTraitsByLayer.set(layer.name, new Set((layer.traits || []).map((t) => t.name)));
    }

    let count = 0;
    for (const item of previewItems) {
      if (!item.traits || Object.keys(item.traits).length === 0) {
        count++;
        continue;
      }
      let invalid = false;
      for (const [layerName, traitObj] of Object.entries(item.traits)) {
        const validNames = validTraitsByLayer.get(layerName);
        if (!validNames || !validNames.has(traitObj.value)) {
          invalid = true;
          break;
        }
      }
      if (invalid) {
        count++;
        continue;
      }
      const hasImages = (project.layers || []).some((l) => Boolean(item.traits[l.name]?.image));
      if (!hasImages) {
        count++;
      }
    }
    return count;
  }, [previewItems, project.layers]);

  // Active rules on selected item in modal
  const activeRulesOnSelectedItem = useMemo(() => {
    if (!selectedItem || !project.layers) return [];
    const rulesList: {
      sourceLayer: { id: string; name: string };
      sourceTrait: { id: string; name: string };
      rule: RuleT;
      targetLayerName: string;
      targetTraitName: string;
      ruleIndex: number;
    }[] = [];

    project.layers.forEach((layer) => {
      const itemTraitObj = selectedItem.traits[layer.name];
      if (!itemTraitObj) return;
      const traitDetails = layer.traits.find(
        (t) => t.name === itemTraitObj.value || t.id === itemTraitObj.traitId
      );
      if (!traitDetails || !traitDetails.rules) return;

      traitDetails.rules.forEach((rule, ruleIndex) => {
        const targetLayer = project.layers.find(
          (l) => l.id === rule.layer || l.name === rule.layer
        );
        const targetTrait = targetLayer?.traits.find(
          (t) => t.id === rule.trait || t.name === rule.trait
        );
        const isCategoryBlock = rule.type === 'block_layer' || rule.trait === '*' || rule.trait === 'ALL';
        rulesList.push({
          sourceLayer: { id: layer.id, name: layer.name },
          sourceTrait: { id: traitDetails.id, name: traitDetails.name },
          rule,
          targetLayerName: targetLayer?.name || rule.layer,
          targetTraitName: isCategoryBlock ? 'Entire Category' : (targetTrait?.name || rule.trait),
          ruleIndex,
        });
      });
    });

    return rulesList;
  }, [selectedItem, project.layers]);

  // Open rule creator from a trait row in the modal
  const handleOpenRuleCreator = (layerName: string, traitName: string, layerId: string, traitId: string) => {
    const otherLayers = (project.layers || []).filter((l) => l.id !== layerId && l.name !== layerName);
    const defaultTargetLayer = otherLayers.find((l) => Boolean(selectedItem?.traits[l.name])) || otherLayers[0];

    setRuleCreator({
      sourceLayerId: layerId,
      sourceTraitId: traitId,
      sourceLayerName: layerName,
      sourceTraitName: traitName,
      ruleType: 'block', // Default to Never Use with
      targetLayerId: defaultTargetLayer?.id || '',
      targetTraitId: '*', // Default to blocking entire category
    });
  };

  const handleSaveRule = () => {
    if (!ruleCreator || !ruleCreator.targetLayerId) {
      toast.error('Please select target layer');
      return;
    }

    const isCategoryBlock = ruleCreator.ruleType === 'block' && (ruleCreator.targetTraitId === '*' || !ruleCreator.targetTraitId);
    if (!isCategoryBlock && !ruleCreator.targetTraitId) {
      toast.error('Please select target trait');
      return;
    }

    addTraitRule(ruleCreator.sourceLayerId, ruleCreator.sourceTraitId, {
      type: isCategoryBlock ? 'block_layer' : ruleCreator.ruleType,
      layer: ruleCreator.targetLayerId,
      trait: isCategoryBlock ? '*' : ruleCreator.targetTraitId,
    });

    setRuleCreator(null);
  };

  // Apply search query by index/number or trait value
  const displayedItems = useMemo(() => {
    let items = filteredPreviewItems || [];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase().replace('#', '');
      items = items.filter((item) => {
        if (item.index.toString() === q) return true;
        return Object.values(item.traits).some((t) => 
          t.value.toLowerCase().includes(q) || t.trait_type.toLowerCase().includes(q)
        );
      });
    }
    return items;
  }, [filteredPreviewItems, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(displayedItems.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safeCurrentPage - 1) * itemsPerPage;
    return displayedItems.slice(start, start + itemsPerPage);
  }, [displayedItems, safeCurrentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 300, behavior: 'smooth' });
    }
  };

  const handleSaveItemTraitName = (layerName: string) => {
    if (!selectedItem) return;
    const trimmed = editingItemTraitVal.trim();
    if (trimmed && trimmed !== selectedItem.traits[layerName]?.value) {
      updatePreviewItemTraitName(selectedItem.index, layerName, trimmed);
      setSelectedItem({
        ...selectedItem,
        traits: {
          ...selectedItem.traits,
          [layerName]: {
            ...selectedItem.traits[layerName],
            value: trimmed,
          },
        },
      });
    }
    setEditingItemTraitLayer(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Preview Collection</h2>
          <p className="text-sm text-gray-400">
            Review your generated {project.size || previewItems.length} items.
            {previewItems.length > 0 && ` (${previewItems.length} generated)`}
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Search by index or trait */}
          <div className="relative flex-1 md:w-48">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              placeholder="Search # or trait..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-primary-orange"
            />
          </div>

          {/* Sort dropdown */}
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-orange"
          >
            <option value="name">Sort by Name</option>
            <option value="rank">Sort by Rarity (Rare first)</option>
            <option value="rank-reverse">Sort by Rarity (Common first)</option>
          </select>

          {/* Page size dropdown */}
          <select 
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-orange"
          >
            <option value={24}>24 / page</option>
            <option value={48}>48 / page</option>
            <option value={96}>96 / page</option>
          </select>
          
          {/* Purge / Clean button */}
          {previewItems.length > 0 && (
            <button
              type="button"
              onClick={purgeDeletedTraitAssets}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                corruptedItemsCount > 0
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30 shadow-md animate-pulse'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-white'
              }`}
              title="Purge assets minted with deleted traits and renumber remaining collection 1..N"
            >
              <MdDeleteSweep size={16} className={corruptedItemsCount > 0 ? "text-amber-400" : "text-gray-400"} />
              {corruptedItemsCount > 0 ? `Purge Deleted (${corruptedItemsCount})` : 'Clean Traits'}
            </button>
          )}

          {/* Download Previews Button */}
          {previewItems.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDownloadMenuOpen(!downloadMenuOpen)}
                disabled={exportingZip}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                title="Download preview images"
              >
                <MdDownload size={16} className="text-primary-orange" />
                {exportingZip ? 'Exporting...' : 'Download Previews'}
              </button>

              {downloadMenuOpen && (
                <div 
                  className="absolute right-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-2 z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100"
                  onMouseLeave={() => setDownloadMenuOpen(false)}
                >
                  <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary-orange flex items-center justify-between">
                    <span>Export Previews & Traits (ZIP)</span>
                    <span className="text-[9px] text-gray-400 font-normal">PNG + JSON</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDownloadZip(paginatedItems, `page_${safeCurrentPage}`)}
                    className="w-full text-left px-3 py-2 text-xs font-semibold rounded-xl hover:bg-gray-800 text-gray-200 flex items-center justify-between transition-colors"
                  >
                    <span>Current Page</span>
                    <span className="text-[10px] text-gray-500 font-normal">({paginatedItems.length} items)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadZip(previewItems, 'all')}
                    className="w-full text-left px-3 py-2 text-xs font-semibold rounded-xl hover:bg-gray-800 text-primary-orange flex items-center justify-between transition-colors"
                  >
                    <span>All Generated Items</span>
                    <span className="text-[10px] text-gray-500 font-normal">({previewItems.length} items)</span>
                  </button>

                  <div className="my-1 border-t border-gray-800" />

                  <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-400 flex items-center justify-between">
                    <span>Export Metadata Only</span>
                    <span className="text-[9px] text-emerald-400 font-normal">Instant JSON</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDownloadMetadataOnly(previewItems, 'all')}
                    className="w-full text-left px-3 py-2 text-xs font-semibold rounded-xl hover:bg-gray-800 text-gray-200 flex items-center justify-between transition-colors"
                    title="Export master _metadata.json for all items"
                  >
                    <span className="flex items-center gap-1.5">
                      <MdDataObject size={14} className="text-primary-orange" />
                      <span>Collection _metadata.json</span>
                    </span>
                    <span className="text-[10px] text-gray-500 font-normal">({previewItems.length} items)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadMetadataOnly(paginatedItems, `page_${safeCurrentPage}`)}
                    className="w-full text-left px-3 py-2 text-xs font-semibold rounded-xl hover:bg-gray-800 text-gray-300 flex items-center justify-between transition-colors"
                    title="Export metadata JSON for current page"
                  >
                    <span className="flex items-center gap-1.5">
                      <MdDataObject size={14} className="text-gray-400" />
                      <span>Page Metadata JSON</span>
                    </span>
                    <span className="text-[10px] text-gray-500 font-normal">({paginatedItems.length} items)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Regenerate / Generate button */}
          <button 
            onClick={generatePreviewItems}
            disabled={generateIsLoading}
            className="flex items-center gap-2 bg-primary-orange text-black px-5 py-2 rounded-xl font-bold hover:bg-primary-orange/80 transition-all disabled:opacity-50"
          >
            <MdRefresh className={generateIsLoading ? 'animate-spin' : ''} /> 
            {previewItems.length > 0 ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Exporting ZIP Progress Overlay */}
      {exportingZip && exportProgress && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-full bg-primary-orange/20 text-primary-orange mx-auto flex items-center justify-center">
              <MdDownload size={24} className="animate-bounce" />
            </div>
            <div>
              <h4 className="text-base font-bold text-gray-100">Exporting Previews & Metadata</h4>
              <p className="text-xs text-gray-400 mt-1">
                Rendering item {exportProgress.current} of {exportProgress.total}...
              </p>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden border border-gray-700/60">
              <div 
                className="bg-primary-orange h-full transition-all duration-150"
                style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500">
              Rendering composites, generating trait metadata JSON, and packing ZIP...
            </p>
          </div>
        </div>
      )}

      {/* Corrupted / Deleted Traits Alert Banner */}
      {corruptedItemsCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
              <MdWarning size={22} />
            </div>
            <div>
              <p className="text-xs font-black text-gray-100">
                Found {corruptedItemsCount} {corruptedItemsCount === 1 ? 'asset' : 'assets'} minted with deleted traits (e.g. #1).
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Click below to purge these assets, renumber the remaining collection sequentially from #1 to #{previewItems.length - corruptedItemsCount}, and refresh rarity scores.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={purgeDeletedTraitAssets}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <MdDeleteSweep size={18} /> Purge & Renumber ({corruptedItemsCount})
          </button>
        </div>
      )}

      {/* Pagination Bar (Top) */}
      {displayedItems.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#010002]/40 px-4 py-2.5 rounded-xl border border-gray-800/80 text-xs text-gray-400">
          <span>
            Showing <strong className="text-gray-200">{(safeCurrentPage - 1) * itemsPerPage + 1}</strong> - <strong className="text-gray-200">{Math.min(safeCurrentPage * itemsPerPage, displayedItems.length)}</strong> of <strong className="text-primary-orange">{displayedItems.length}</strong> items
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handlePageChange(1)}
              disabled={safeCurrentPage <= 1}
              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-lg transition-colors"
              title="First Page"
            >
              «
            </button>
            <button
              onClick={() => handlePageChange(safeCurrentPage - 1)}
              disabled={safeCurrentPage <= 1}
              className="p-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-lg transition-colors"
              title="Previous Page"
            >
              <MdNavigateBefore size={18} />
            </button>
            <span className="px-3 py-1 font-semibold text-gray-200 bg-gray-900 border border-gray-700 rounded-lg">
              Page {safeCurrentPage} of {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(safeCurrentPage + 1)}
              disabled={safeCurrentPage >= totalPages}
              className="p-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-lg transition-colors"
              title="Next Page"
            >
              <MdNavigateNext size={18} />
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={safeCurrentPage >= totalPages}
              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-lg transition-colors"
              title="Last Page"
            >
              »
            </button>
          </div>
        </div>
      )}

      {/* Grid of Preview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
        {paginatedItems.map((item) => {
          const isTopTier = item.ranking <= Math.max(5, Math.round(previewItems.length * 0.05));
          const hasNoTraits = !item.traits || Object.keys(item.traits).length === 0;

          return (
            <div 
              key={item.id} 
              onClick={() => setSelectedItem(item)}
              className={`bg-gray-800/90 rounded-2xl border overflow-hidden hover:shadow-xl hover:scale-[1.01] transition-all group shadow-md cursor-pointer flex flex-col ${
                hasNoTraits 
                  ? 'border-red-500/40 hover:border-red-500/80 bg-red-950/10' 
                  : 'border-gray-700/80 hover:border-primary-orange/60'
              }`}
            >
              {/* Artwork - 100% clean and unobstructed */}
              <div className="aspect-square relative w-full bg-gray-900/60 overflow-hidden">
                <PreviewImage 
                  item={item} 
                  layers={project.layers}
                  width={project.imageWidth || 1000} 
                  height={project.imageHeight || 1000} 
                />
                
                {/* Subtle hover inspect & download badges */}
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                  <span className="bg-black/80 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full border border-white/20 flex items-center gap-1 shadow-lg pointer-events-auto">
                    <MdInfoOutline size={12} /> Inspect
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadSingle(item);
                    }}
                    className="p-1.5 bg-black/80 hover:bg-primary-orange hover:text-black backdrop-blur-sm text-white rounded-full border border-white/20 transition-all shadow-lg pointer-events-auto"
                    title="Download this preview PNG"
                  >
                    <MdDownload size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadSingleJson(item);
                    }}
                    className="p-1.5 bg-black/80 hover:bg-primary-orange hover:text-black backdrop-blur-sm text-white rounded-full border border-white/20 transition-all shadow-lg pointer-events-auto"
                    title="Download trait metadata JSON"
                  >
                    <MdDataObject size={14} />
                  </button>
                </div>
              </div>

              {/* Card Footer - Structured & Clean Rarity */}
              <div className="p-3 flex-1 flex flex-col justify-between bg-gray-800/90 gap-2">
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-xs font-bold text-gray-200 truncate flex-1" title={`#${item.index} ${project.name || 'NFT'}`}>
                      #{item.index} <span className="text-gray-400 font-normal">{project.name || ''}</span>
                    </p>
                    <span 
                      className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-md border ${
                        hasNoTraits 
                          ? 'bg-red-500/20 text-red-400 border-red-500/40'
                          : isTopTier
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                            : 'bg-primary-orange/15 text-primary-orange border-primary-orange/30'
                      }`}
                      title={`Rarity Rank #${item.ranking}`}
                    >
                      Rank #{item.ranking}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] mt-1.5">
                    <span className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">Rarity Score</span>
                    <span className="font-bold text-gray-200 text-xs">{item.rating}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-700/50 flex items-center justify-between text-[10px] text-gray-500">
                  <span>{Object.keys(item.traits || {}).length} traits</span>
                  <span className="text-primary-orange group-hover:text-primary-orange/80 flex items-center gap-1 font-semibold">
                    Inspect →
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Empty State */}
        {previewItems.length === 0 && !generateIsLoading && (
          <div className="col-span-full py-32 flex flex-col items-center justify-center text-gray-500 bg-gray-900/20 rounded-3xl border-2 border-dashed border-gray-800">
             <MdRefresh size={64} className="opacity-10 mb-4" />
             <p className="text-lg">Ready to generate your collection?</p>
             <button 
               onClick={generatePreviewItems}
               className="mt-4 text-primary-orange hover:underline font-bold"
             >
               Click here to start
             </button>
          </div>
        )}

        {/* Search returned 0 items */}
        {previewItems.length > 0 && displayedItems.length === 0 && (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-gray-500 bg-gray-900/20 rounded-3xl border border-gray-800">
            <p className="text-sm">No items found matching "{searchQuery}"</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-xs text-primary-orange hover:underline font-bold"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>

      {/* Pagination Bar (Bottom) */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 pt-4">
          <button
            onClick={() => handlePageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage <= 1}
            className="flex items-center gap-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-xl text-xs font-bold transition-colors"
          >
            <MdNavigateBefore size={16} /> Previous
          </button>
          <span className="px-4 py-2 text-xs text-gray-400 font-semibold">
            Page {safeCurrentPage} of {totalPages}
          </span>
          <button
            onClick={() => handlePageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage >= totalPages}
            className="flex items-center gap-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 rounded-xl text-xs font-bold transition-colors"
          >
            Next <MdNavigateNext size={16} />
          </button>
        </div>
      )}

      {/* Item Detail Modal with Download & Trait Rules Engine */}
      {selectedItem && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => {
            setSelectedItem(null);
            setRuleCreator(null);
          }}
        >
          <div 
            className="bg-[#1A171A] border border-gray-700 rounded-3xl max-w-3xl w-full p-6 space-y-6 shadow-2xl relative max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-center pb-3 border-b border-gray-800">
              <div>
                <h3 className="text-xl font-black text-gray-100">
                  #{selectedItem.index} {project.name || 'NFT'}
                </h3>
                <div className="flex items-center gap-3 mt-1 text-xs">
                  <span className="text-primary-orange font-bold">Rank #{selectedItem.ranking}</span>
                  <span className="text-gray-500">•</span>
                  <span className="text-gray-400">Rarity Score: <strong className="text-gray-200">{selectedItem.rating}</strong></span>
                </div>
              </div>
              <button 
                onClick={() => {
                  setSelectedItem(null);
                  setRuleCreator(null);
                }}
                className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              >
                <MdClose size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Left Column: Image & Download Button */}
              <div className="space-y-3">
                <div className="aspect-square bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 shadow-xl">
                  <PreviewImage 
                    item={selectedItem} 
                    layers={project.layers}
                    width={project.imageWidth || 1000} 
                    height={project.imageHeight || 1000} 
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadSingle(selectedItem)}
                    className="flex items-center justify-center gap-1.5 py-3 px-3 bg-primary-orange hover:bg-primary-orange/80 text-black font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-primary-orange/20 cursor-pointer truncate"
                    title="Download high-resolution preview PNG"
                  >
                    <MdDownload size={16} /> Preview PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadSingleJson(selectedItem)}
                    className="flex items-center justify-center gap-1.5 py-3 px-3 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer hover:border-gray-600 truncate"
                    title="Download trait metadata as JSON"
                  >
                    <MdDataObject size={16} className="text-primary-orange" /> Metadata JSON
                  </button>
                </div>
              </div>

              {/* Right Column: Traits list & Interactive Rules Builder */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                    Traits <span className="text-[10px] text-gray-500 font-normal">({Object.keys(selectedItem.traits).length})</span>
                  </h4>
                  <span className="text-[10px] text-gray-500">
                    Click <strong>+ Rule</strong> to block/require traits
                  </span>
                </div>

                {/* Traits list */}
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {Object.entries(selectedItem.traits).map(([layerName, trait]) => {
                    const layer = project.layers?.find(l => l.name === layerName || l.id === trait.layerId);
                    const traitDetails = layer?.traits?.find(t => t.name === trait.value || t.id === trait.traitId);
                    const traitRulesCount = traitDetails?.rules?.length || 0;
                    const isEditingThis = editingItemTraitLayer === layerName;

                    return (
                      <div 
                        key={layerName} 
                        className="flex justify-between items-center p-2.5 bg-gray-900/60 rounded-xl border border-gray-800 text-xs hover:border-gray-700 transition-colors"
                      >
                        <div className="truncate mr-2 flex-1">
                          <span className="text-gray-500 uppercase tracking-wide font-semibold text-[10px] block">{layerName}</span>
                          {isEditingThis ? (
                            <div className="flex items-center gap-1.5 mt-1">
                              <input
                                type="text"
                                value={editingItemTraitVal}
                                onChange={(e) => setEditingItemTraitVal(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveItemTraitName(layerName);
                                  if (e.key === 'Escape') setEditingItemTraitLayer(null);
                                }}
                                className="bg-black border border-primary-orange text-white text-xs font-bold rounded px-2 py-0.5 w-full focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveItemTraitName(layerName)}
                                className="p-1 bg-primary-orange text-black rounded hover:bg-primary-orange/80 cursor-pointer"
                                title="Save"
                              >
                                <MdCheck size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingItemTraitLayer(null)}
                                className="p-1 bg-gray-800 text-gray-400 hover:text-white rounded cursor-pointer"
                                title="Cancel"
                              >
                                <MdClose size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group/val">
                              <span className="font-bold text-gray-200 truncate">{trait.value}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItemTraitLayer(layerName);
                                  setEditingItemTraitVal(trait.value);
                                }}
                                className="text-gray-500 hover:text-primary-orange opacity-0 group-hover/val:opacity-100 transition-opacity p-0.5 cursor-pointer"
                                title="Edit trait name for this NFT"
                              >
                                <MdEdit size={12} />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {traitRulesCount > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-orange/20 text-primary-orange border border-primary-orange/40">
                              {traitRulesCount} {traitRulesCount === 1 ? 'rule' : 'rules'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenRuleCreator(
                              layerName, 
                              trait.value, 
                              trait.layerId || layer?.id || '', 
                              trait.traitId || traitDetails?.id || ''
                            )}
                            className="px-2.5 py-1 bg-gray-800 hover:bg-primary-orange hover:text-black text-gray-300 rounded-lg text-[10px] font-bold transition-all border border-gray-700 flex items-center gap-1 cursor-pointer"
                            title={`Add rule for ${layerName}: ${trait.value}`}
                          >
                            <MdAdd size={12} /> Rule
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* In-Modal Rule Creator Card */}
                {ruleCreator && (
                  <div className="p-3.5 bg-gray-950 border border-primary-orange/50 rounded-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                        <MdRule size={16} className="text-primary-orange" />
                        New Rule for <span className="text-primary-orange font-black">{ruleCreator.sourceTraitName}</span>
                      </span>
                      <button 
                        type="button"
                        onClick={() => setRuleCreator(null)}
                        className="text-gray-500 hover:text-white p-1"
                      >
                        <MdClose size={14} />
                      </button>
                    </div>

                    {/* Rule Type Selector */}
                    <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setRuleCreator({ ...ruleCreator, ruleType: 'block' })}
                        className={`py-2 px-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          ruleCreator.ruleType === 'block'
                            ? 'bg-red-500/20 text-red-300 border-red-500/60 shadow-md'
                            : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-white'
                        }`}
                      >
                        <MdBlock size={14} /> Never Use With
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const targetL = project.layers.find(l => l.id === ruleCreator.targetLayerId);
                          setRuleCreator({ 
                            ...ruleCreator, 
                            ruleType: 'force',
                            targetTraitId: targetL?.traits[0]?.id || ''
                          });
                        }}
                        className={`py-2 px-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          ruleCreator.ruleType === 'force'
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/60 shadow-md'
                            : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-white'
                        }`}
                      >
                        <MdElectricBolt size={14} /> Always Use With
                      </button>
                    </div>

                    {/* Target Layer & Trait Selectors */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-400 block mb-1">Target Layer (Category)</label>
                        <select
                          value={ruleCreator.targetLayerId}
                          onChange={(e) => {
                            const newLayerId = e.target.value;
                            const targetL = project.layers.find(l => l.id === newLayerId);
                            setRuleCreator({
                              ...ruleCreator,
                              targetLayerId: newLayerId,
                              targetTraitId: ruleCreator.ruleType === 'block' ? '*' : (targetL?.traits[0]?.id || ''),
                            });
                          }}
                          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-primary-orange"
                        >
                          {project.layers
                            .filter(l => l.id !== ruleCreator.sourceLayerId && l.name !== ruleCreator.sourceLayerName)
                            .map(l => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold text-gray-400 block mb-1">Target Trait</label>
                        <select
                          value={ruleCreator.targetTraitId}
                          onChange={(e) => setRuleCreator({ ...ruleCreator, targetTraitId: e.target.value })}
                          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-primary-orange"
                        >
                          {ruleCreator.ruleType === 'block' && (
                            <option value="*">⛔ Entire Category (All traits)</option>
                          )}
                          {project.layers
                            .find(l => l.id === ruleCreator.targetLayerId)
                            ?.traits.map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                      </div>
                    </div>

                    {/* Summary Sentence */}
                    <div className="text-[11px] text-gray-400 bg-gray-900/80 p-2.5 rounded-xl border border-gray-800">
                      Rule: If <strong className="text-white">{ruleCreator.sourceTraitName}</strong> ({ruleCreator.sourceLayerName}) is selected ➔ <strong className={ruleCreator.ruleType === 'block' ? 'text-red-400' : 'text-blue-400'}>
                        {ruleCreator.ruleType === 'block' ? 'NEVER use with' : 'ALWAYS use with'}
                      </strong> <strong className="text-primary-orange">
                        {ruleCreator.targetTraitId === '*'
                          ? `Entire Category (${project.layers.find(l => l.id === ruleCreator.targetLayerId)?.name || 'target layer'})`
                          : (project.layers.find(l => l.id === ruleCreator.targetLayerId)?.traits.find(t => t.id === ruleCreator.targetTraitId)?.name || 'target trait')}
                      </strong>.
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setRuleCreator(null)}
                        className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveRule}
                        className="px-4 py-1.5 bg-primary-orange hover:bg-primary-orange/80 text-black rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer"
                      >
                        Save Rule
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Rules on this item */}
                {activeRulesOnSelectedItem.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-gray-800">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <MdRule size={14} /> Active Rules on this NFT ({activeRulesOnSelectedItem.length})
                    </span>

                    <div className="space-y-1.5 max-h-[130px] overflow-y-auto pr-1">
                      {activeRulesOnSelectedItem.map(({ sourceLayer, sourceTrait, rule, targetLayerName, targetTraitName, ruleIndex }) => (
                        <div 
                          key={`${sourceTrait.id}-${ruleIndex}`}
                          className="flex items-center justify-between p-2 rounded-xl bg-gray-900/90 border border-gray-800 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5 text-gray-300 truncate mr-2">
                            <span className={`text-[9px] font-black px-1.5 py-0.2 rounded uppercase ${
                              rule.type === 'block' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                            }`}>
                              {rule.type === 'block' ? 'Never' : 'Always'}
                            </span>
                            <span className="truncate">
                              <strong className="text-white">{sourceTrait.name}</strong> ➔ {rule.type === 'block' ? 'never' : 'always'} with <strong className="text-primary-orange">{targetTraitName}</strong> ({targetLayerName})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteTraitRule(sourceLayer.id, sourceTrait.id, ruleIndex)}
                            className="p-1 text-gray-500 hover:text-red-400 transition-colors shrink-0"
                            title="Delete rule"
                          >
                            <MdDelete size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItem(null);
                        setRuleCreator(null);
                        generatePreviewItems();
                      }}
                      className="w-full mt-2 py-2 px-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <MdRefresh size={14} /> Re-Generate collection with updated rules
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreviewStep;
