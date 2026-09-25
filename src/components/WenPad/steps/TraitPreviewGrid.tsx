import React, { useState, useEffect, useMemo } from 'react';
import { useProject } from '../ProjectContext';
import { MdDelete, MdAutoFixHigh, MdCheckCircle, MdWarning, MdSearch, MdClose } from 'react-icons/md';
import { RarityType, TraitT } from '../WenPadTypes';

// Cache blob URLs by trait ID to avoid recreating object URLs and causing image flickers
const traitBlobUrlCache = new Map<string, string>();

export const getTraitImageUrl = (trait: TraitT) => {
  if (!trait.data) return '';
  if (traitBlobUrlCache.has(trait.id)) {
    return traitBlobUrlCache.get(trait.id)!;
  }
  let blob: Blob;
  if (trait.data instanceof Blob) {
    blob = trait.data;
  } else if (trait.data instanceof ArrayBuffer || ArrayBuffer.isView(trait.data)) {
    blob = new Blob([trait.data as BlobPart], { type: trait.type || 'image/png' });
  } else {
    try {
      blob = new Blob([trait.data as BlobPart], { type: trait.type || 'image/png' });
    } catch {
      return '';
    }
  }
  const url = URL.createObjectURL(blob);
  traitBlobUrlCache.set(trait.id, url);
  return url;
};

// Isolated input so user can backspace, clear, and type decimals without snapping back to 0
const TraitRarityInput = ({
  rarity,
  onChange,
}: {
  rarity: number;
  onChange: (val: number) => void;
}) => {
  const [text, setText] = useState<string>(() => (rarity === 0 ? '0' : rarity.toString()));

  useEffect(() => {
    setText((prev) => {
      const parsed = parseFloat(prev);
      if (!isNaN(parsed) && parsed === rarity) return prev;
      return rarity.toString();
    });
  }, [rarity]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setText(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    const parsed = parseFloat(text);
    if (isNaN(parsed) || parsed < 0) {
      setText('0');
      onChange(0);
    } else {
      setText(parsed.toString());
      onChange(parsed);
    }
  };

  return (
    <input
      type="number"
      step="any"
      min="0"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-primary-orange text-center text-gray-200"
    />
  );
};

const TraitPreviewGrid = () => {
  const { activeLayerDetails, activeLayerIndex, form, deleteTrait, autofillRarity, resetOriginalProject } = useProject();
  const traits = activeLayerDetails?.traits || [];
  const [layerFilter, setLayerFilter] = useState('');

  const filteredTraits = useMemo(() => {
    if (!layerFilter.trim()) return traits;
    const q = layerFilter.trim().toLowerCase();
    return traits.filter(t => t.name.toLowerCase().includes(q));
  }, [traits, layerFilter]);

  const handleRarityChange = (traitIndex: number, newRarity: number) => {
    const currentLayers = form.getValues('layers');
    const updatedLayers = currentLayers.map((layer, lIdx) => {
      if (lIdx !== activeLayerIndex) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t, tIdx) => {
          if (tIdx !== traitIndex) return t;
          return { ...t, rarity: newRarity };
        }),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
  };

  const handleRarityTypeToggle = (traitIndex: number) => {
    const currentLayers = form.getValues('layers');
    const updatedLayers = currentLayers.map((layer, lIdx) => {
      if (lIdx !== activeLayerIndex) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t, tIdx) => {
          if (tIdx !== traitIndex) return t;
          const nextType = t.rarityType === RarityType.PERCENT ? RarityType.NUMBER : RarityType.PERCENT;
          return { ...t, rarityType: nextType };
        }),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
  };

  const handleSetAllRarityType = (type: RarityType) => {
    const currentLayers = form.getValues('layers');
    const updatedLayers = currentLayers.map((layer, lIdx) => {
      if (lIdx !== activeLayerIndex) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t) => ({ ...t, rarityType: type })),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
  };

  // Compute total percentage if traits use PERCENT
  const { totalPercent, isAllPercent } = useMemo(() => {
    const percentTraits = traits.filter((t) => t.rarityType === RarityType.PERCENT);
    const sum = percentTraits.reduce((acc, t) => acc + (t.rarity || 0), 0);
    return {
      totalPercent: Math.round(sum * 100) / 100,
      isAllPercent: percentTraits.length === traits.length && traits.length > 0,
    };
  }, [traits]);

  const isExact100 = Math.abs(totalPercent - 100) < 0.05;

  return (
    <div className="space-y-4">
      {/* Layer Stats & Quick Actions Toolbar */}
      <div className="flex flex-wrap justify-between items-center bg-[#010002]/40 p-4 rounded-2xl border border-gray-800/80 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-black uppercase tracking-widest text-gray-400">
            {traits.length} {traits.length === 1 ? 'Trait' : 'Traits'}
          </span>

          {isAllPercent && (
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
              isExact100 
                ? 'bg-green-500/15 text-green-400 border-green-500/30' 
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}>
              {isExact100 ? <MdCheckCircle size={14} /> : <MdWarning size={14} />}
              <span>
                Total: {totalPercent}%
                {!isExact100 && (
                  totalPercent < 100 
                    ? ` (needs +${(100 - totalPercent).toFixed(1)}%)`
                    : ` (exceeds by +${(totalPercent - 100).toFixed(1)}%)`
                )}
              </span>
            </div>
          )}

          {/* In-layer search input */}
          {traits.length > 3 && (
            <div className="relative w-36 sm:w-44">
              <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input
                value={layerFilter}
                onChange={(e) => setLayerFilter(e.target.value)}
                placeholder="Filter traits..."
                className="w-full bg-gray-900 border border-gray-700/80 rounded-xl pl-7 pr-6 py-1 text-xs focus:outline-none focus:border-primary-orange text-gray-200 placeholder:text-gray-600"
              />
              {layerFilter && (
                <button 
                  type="button"
                  onClick={() => setLayerFilter('')} 
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <MdClose size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick toggle all units */}
          <div className="flex items-center bg-gray-900 border border-gray-700/80 rounded-xl p-0.5 text-[10px] font-bold">
            <button
              type="button"
              onClick={() => handleSetAllRarityType(RarityType.PERCENT)}
              className="px-2.5 py-1 rounded-lg hover:text-white transition-colors text-gray-400 hover:bg-gray-800"
            >
              All %
            </button>
            <button
              type="button"
              onClick={() => handleSetAllRarityType(RarityType.NUMBER)}
              className="px-2.5 py-1 rounded-lg hover:text-white transition-colors text-gray-400 hover:bg-gray-800"
            >
              All Qty
            </button>
          </div>

          <button 
            type="button"
            onClick={() => autofillRarity(activeLayerIndex)}
            className="text-[10px] flex items-center gap-1.5 bg-primary-orange/10 text-primary-orange px-4 py-2 rounded-xl border border-primary-orange/20 hover:bg-primary-orange/20 transition-all font-black uppercase tracking-widest"
          >
            <MdAutoFixHigh size={14} /> Autofill Rarity (100%)
          </button>
        </div>
      </div>

      {/* Grid of Traits */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {filteredTraits.map((trait) => {
          const originalIndex = traits.findIndex(t => t.id === trait.id);
          return (
            <div 
              key={trait.id} 
              className="bg-gray-800/90 rounded-2xl border border-gray-700 overflow-hidden group hover:border-primary-orange/50 transition-all flex flex-col justify-between"
            >
              <div className="aspect-square bg-gray-900/80 relative flex items-center justify-center p-2">
                <img 
                  src={getTraitImageUrl(trait)} 
                  alt={trait.name} 
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
                <button 
                  type="button"
                  onClick={() => deleteTrait(activeLayerDetails!, trait)}
                  className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  title="Delete trait"
                >
                  <MdDelete size={14} />
                </button>
              </div>

              <div className="p-3 space-y-2 bg-gray-800">
                <p className="text-xs font-bold truncate text-gray-200" title={trait.name}>
                  {trait.name}
                </p>

                <div className="flex items-center gap-1.5">
                  <div className="flex-1">
                    <TraitRarityInput
                      rarity={trait.rarity}
                      onChange={(val) => handleRarityChange(originalIndex, val)}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRarityTypeToggle(originalIndex)}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all border ${
                      trait.rarityType === RarityType.PERCENT
                        ? 'bg-primary-orange/20 text-primary-orange border-primary-orange/40 hover:bg-primary-orange/30'
                        : 'bg-blue-500/20 text-blue-400 border-blue-500/40 hover:bg-blue-500/30'
                    }`}
                    title="Click to switch between % and Qty"
                  >
                    {trait.rarityType === RarityType.PERCENT ? '%' : 'Qty'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {traits.length > 0 && filteredTraits.length === 0 && (
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-500 bg-gray-900/20 rounded-2xl border border-gray-800">
            <p className="text-sm">No traits matching "{layerFilter}"</p>
            <button 
              onClick={() => setLayerFilter('')} 
              className="mt-2 text-xs text-primary-orange hover:underline font-bold"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TraitPreviewGrid;
