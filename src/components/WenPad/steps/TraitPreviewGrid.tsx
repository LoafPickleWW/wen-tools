import { useProject } from '../ProjectProvider';
import { MdDelete, MdAutoFixHigh } from 'react-icons/md';
import { RarityType } from '../WenPadTypes';

const TraitPreviewGrid = () => {
  const { activeLayerDetails, activeLayerIndex, form, deleteTrait, autofillRarity } = useProject();
  const traits = activeLayerDetails?.traits || [];

  const handleRarityChange = (traitIndex: number, value: string) => {
    const updatedLayers = [...form.getValues('layers')];
    updatedLayers[activeLayerIndex].traits[traitIndex].rarity = parseFloat(value) || 0;
    form.setValue('layers', updatedLayers);
  };

  const getImageUrl = (data: any) => {
    if (!data) return '';
    const blob = new Blob([data], { type: 'image/png' }); // Assuming PNG for now
    return URL.createObjectURL(blob);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-[#010002]/40 p-4 rounded-2xl border border-gray-800/50">
        <span className="text-xs font-black uppercase tracking-widest text-gray-500">{traits.length} Traits found</span>
        <button 
          onClick={() => autofillRarity(activeLayerIndex)}
          className="text-[10px] flex items-center gap-2 bg-primary-orange/10 text-primary-orange px-4 py-2 rounded-xl border border-primary-orange/20 hover:bg-primary-orange/20 transition-all font-black uppercase tracking-widest"
        >
          <MdAutoFixHigh /> Autofill Rarity
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {traits.map((trait, idx) => (
          <div key={trait.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden group">
            <div className="aspect-square bg-gray-900 relative">
              <img 
                src={getImageUrl(trait.data)} 
                alt={trait.name} 
                className="w-full h-full object-contain"
              />
              <button 
                onClick={() => deleteTrait(activeLayerDetails!, trait)}
                className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MdDelete size={14} />
              </button>
            </div>
            <div className="p-3 space-y-2">
              <p className="text-xs font-bold truncate text-gray-300">{trait.name}</p>
              <div className="flex items-center gap-2">
                <input 
                  type="number"
                  value={trait.rarity}
                  onChange={(e) => handleRarityChange(idx, e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-primary-orange text-center"
                />
                <span className="text-[10px] text-gray-500">{trait.rarityType === RarityType.PERCENT ? '%' : 'Qty'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TraitPreviewGrid;
