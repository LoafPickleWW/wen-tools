import { useProject } from '../ProjectContext';
import { MdRefresh } from 'react-icons/md';
import PreviewImage from '../PreviewImage';

const PreviewStep = () => {
  const { 
    generatePreviewItems, previewItems, generateIsLoading, 
    sortBy, setSortBy, project 
  } = useProject();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Preview Collection</h2>
          <p className="text-sm text-gray-400">Review your generated {project.size} items.</p>
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="flex-1 md:w-40 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm focus:outline-none"
          >
            <option value="name">Sort by Name</option>
            <option value="rank">Sort by Rarity (Rare first)</option>
            <option value="rank-reverse">Sort by Rarity (Common first)</option>
          </select>
          
          <button 
            onClick={generatePreviewItems}
            disabled={generateIsLoading}
            className="flex items-center gap-2 bg-primary-orange text-black px-6 py-2 rounded-xl font-bold hover:bg-primary-orange/80 transition-all disabled:opacity-50"
          >
            <MdRefresh className={generateIsLoading ? 'animate-spin' : ''} /> 
            {previewItems.length > 0 ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-6">
        {previewItems.map((item) => (
          <div key={item.id} className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden hover:border-primary-orange/50 transition-all group shadow-lg">
            <div className="aspect-square relative">
              <PreviewImage 
                item={item} 
                width={project.imageWidth || 1000} 
                height={project.imageHeight || 1000} 
              />
              <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-[10px] px-2 py-0.5 rounded-full text-primary-orange border border-primary-orange/30">
                Rank #{item.ranking}
              </div>
            </div>
            <div className="p-3">
              <p className="text-xs font-bold text-gray-300">#{item.index} {project.name}</p>
              <p className="text-[10px] text-gray-500 mt-1">Score: {item.rating}</p>
            </div>
          </div>
        ))}

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
      </div>
    </div>
  );
};

export default PreviewStep;
