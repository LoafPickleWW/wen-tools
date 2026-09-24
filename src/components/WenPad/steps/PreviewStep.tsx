import { useState, useMemo } from 'react';
import { useProject } from '../ProjectContext';
import { MdRefresh, MdNavigateBefore, MdNavigateNext, MdSearch, MdClose, MdInfoOutline } from 'react-icons/md';
import PreviewImage from '../PreviewImage';
import { PreviewItemT } from '../WenPadTypes';

const PreviewStep = () => {
  const { 
    generatePreviewItems, previewItems, filteredPreviewItems, generateIsLoading, 
    sortBy, setSortBy, project 
  } = useProject();

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(24);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<PreviewItemT | null>(null);

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
        {paginatedItems.map((item) => (
          <div 
            key={item.id} 
            onClick={() => setSelectedItem(item)}
            className="bg-gray-800/90 rounded-2xl border border-gray-700/80 overflow-hidden hover:border-primary-orange/60 hover:shadow-xl hover:scale-[1.01] transition-all group shadow-md cursor-pointer flex flex-col"
          >
            <div className="aspect-square relative w-full bg-gray-900/60">
              <PreviewImage 
                item={item} 
                layers={project.layers}
                width={project.imageWidth || 1000} 
                height={project.imageHeight || 1000} 
              />
              <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md text-[10px] font-bold px-2 py-0.5 rounded-full text-primary-orange border border-primary-orange/30">
                Rank #{item.ranking}
              </div>
            </div>
            <div className="p-3 flex-1 flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold text-gray-200 truncate">#{item.index} {project.name || 'NFT'}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Score: <span className="font-semibold text-gray-300">{item.rating}</span></p>
              </div>
              <div className="mt-2 text-[10px] text-primary-orange/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 font-semibold">
                <MdInfoOutline size={12} /> Click to inspect
              </div>
            </div>
          </div>
        ))}

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

      {/* Item Detail Modal */}
      {selectedItem && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedItem(null)}
        >
          <div 
            className="bg-[#1A171A] border border-gray-700 rounded-3xl max-w-2xl w-full p-6 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
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
                onClick={() => setSelectedItem(null)}
                className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              >
                <MdClose size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
              <div className="aspect-square bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
                <PreviewImage 
                  item={selectedItem} 
                  layers={project.layers}
                  width={project.imageWidth || 1000} 
                  height={project.imageHeight || 1000} 
                />
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-gray-400">Traits</h4>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {Object.entries(selectedItem.traits).map(([layerName, trait]) => (
                    <div 
                      key={layerName} 
                      className="flex justify-between items-center p-2.5 bg-gray-900/60 rounded-xl border border-gray-800 text-xs"
                    >
                      <span className="text-gray-500 uppercase tracking-wide font-semibold text-[10px]">{layerName}</span>
                      <span className="font-bold text-gray-200">{trait.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreviewStep;
