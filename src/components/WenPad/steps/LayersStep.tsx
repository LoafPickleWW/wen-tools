import { useState, useMemo } from 'react';
import { useProject } from '../ProjectContext';
import { 
  MdAdd, 
  MdDelete, 
  MdSave, 
  MdRefresh, 
  MdDragIndicator, 
  MdKeyboardArrowUp, 
  MdKeyboardArrowDown,
  MdSearch,
  MdClose,
  MdSearchOff,
  MdOpenInNew
} from 'react-icons/md';
import { v4 as uuid } from 'uuid';
import TraitPreviewGrid, { getTraitImageUrl } from './TraitPreviewGrid';
import { RarityType } from '../WenPadTypes';

const LayersStep = () => {
  const { 
    form, layers, activeLayer, selectLayer, 
    deleteLayer, deleteTrait, moveLayer, resetProject, saveProject,
    activeLayerDetails, activeLayerIndex, formatTrait,
    resetOriginalProject
  } = useProject();

  const [newLayerName, setNewLayerName] = useState('');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const totalTraitsCount = useMemo(() => {
    return layers.reduce((acc, l) => acc + (l.traits?.length || 0), 0);
  }, [layers]);

  const matchingTraits = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return [];
    return layers.flatMap((layer) => 
      (layer.traits || [])
        .filter((t) => t.name.toLowerCase().includes(trimmed))
        .map((t) => ({ trait: t, layer }))
    );
  }, [layers, searchQuery]);

  const matchesByLayerId = useMemo(() => {
    const map: Record<string, number> = {};
    if (!searchQuery.trim()) return map;
    for (const item of matchingTraits) {
      map[item.layer.id] = (map[item.layer.id] || 0) + 1;
    }
    return map;
  }, [matchingTraits, searchQuery]);

  const handleAddLayer = () => {
    if (!newLayerName.trim()) return;
    const newLayer = {
      id: uuid(),
      name: newLayerName.trim(),
      traits: [],
      excludeFromMetadata: false
    };
    const updatedLayers = [...layers, newLayer];
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
    setNewLayerName('');
    selectLayer(newLayer.id);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIndex) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }
    moveLayer(draggedIdx, targetIndex);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const currentTraits = [...(activeLayerDetails?.traits || [])];
    const newTraitsPromises = Array.from(files).map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          resolve(formatTrait({
            name: file.name,
            type: file.type,
            size: file.size,
            data: event.target?.result
          }));
        };
        reader.readAsArrayBuffer(file);
      });
    });

    Promise.all(newTraitsPromises).then((newTraits: any) => {
      const updatedLayers = [...layers];
      updatedLayers[activeLayerIndex].traits = [...currentTraits, ...newTraits];
      form.setValue('layers', updatedLayers, { shouldDirty: true });
      resetOriginalProject();
    });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Left Sidebar: Collection & Layers */}
      <div className="w-full lg:w-80 flex flex-col gap-6 border-r border-gray-800 pr-0 lg:pr-8">
        <div className="flex flex-col gap-4">
          <button 
            onClick={saveProject}
            className="flex items-center justify-center gap-2 bg-primary-orange hover:opacity-80 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-primary-orange/20 uppercase tracking-widest text-xs"
          >
            <MdSave size={20} /> Save Project
          </button>

          <div className="bg-[#010002]/40 p-4 rounded-2xl border border-gray-800 space-y-2">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-primary-orange">Quick Stats</h4>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Total Layers:</span>
              <span className="font-bold text-gray-300">{layers.length}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Total Traits:</span>
              <span className="font-bold text-gray-300">{totalTraitsCount}</span>
            </div>
          </div>

          {/* Global Trait Search */}
          <div className="bg-[#010002]/40 p-3.5 rounded-2xl border border-gray-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-primary-orange flex items-center gap-1.5">
                <MdSearch size={14} /> Search Traits
              </span>
              {searchQuery && (
                <button 
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-[10px] text-gray-500 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
              <input 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search all traits (e.g. helmet)..."
                className="w-full bg-gray-900 border border-gray-700/80 rounded-xl pl-9 pr-8 py-2 text-xs focus:outline-none focus:border-primary-orange text-gray-200 placeholder:text-gray-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5"
                  title="Clear search"
                >
                  <MdClose size={14} />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <div className="text-[11px] text-gray-400 flex items-center justify-between pt-0.5">
                <span>All layers:</span>
                <span className={`font-bold ${matchingTraits.length > 0 ? 'text-green-400' : 'text-amber-400'}`}>
                  {matchingTraits.length} found
                </span>
              </div>
            )}
          </div>

          <div className="space-y-4 mt-1">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-200">Layers</h3>
              <span className="text-[10px] text-gray-500 font-semibold">1 = Background</span>
            </div>

            <div className="flex gap-2">
              <input 
                value={newLayerName}
                onChange={(e) => setNewLayerName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddLayer()}
                placeholder="Layer Name"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-orange"
              />
              <button 
                onClick={handleAddLayer}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                title="Add Layer"
              >
                <MdAdd size={20} />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {layers.map((layer, idx) => (
                <div 
                  key={layer.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => selectLayer(layer.id)}
                  className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all border select-none ${
                    activeLayer === layer.id 
                      ? 'bg-primary-orange/20 border-primary-orange/60 text-white' 
                      : 'bg-gray-800/90 border-gray-700/60 hover:bg-gray-700/80 text-gray-300'
                  } ${dragOverIdx === idx ? 'border-t-2 border-t-primary-orange bg-gray-700/60' : ''} ${
                    draggedIdx === idx ? 'opacity-40' : 'opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
                    <span 
                      className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300 p-0.5 transition-colors" 
                      title="Drag to reorder layer"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <MdDragIndicator size={18} />
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/40 text-gray-400">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium truncate" title={layer.name}>
                      {layer.name}
                    </span>
                    {matchesByLayerId[layer.id] > 0 && (
                      <span className="text-[10px] font-black px-1.5 py-0.2 rounded-full bg-primary-orange/20 text-primary-orange border border-primary-orange/40 shrink-0">
                        {matchesByLayerId[layer.id]}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button 
                      type="button"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        moveLayer(idx, idx - 1); 
                      }}
                      disabled={idx === 0}
                      className="p-1 text-gray-400 hover:text-white disabled:opacity-20 disabled:hover:text-gray-400 rounded hover:bg-gray-700 transition-colors"
                      title="Move Up (toward background)"
                    >
                      <MdKeyboardArrowUp size={18} />
                    </button>
                    <button 
                      type="button"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        moveLayer(idx, idx + 1); 
                      }}
                      disabled={idx === layers.length - 1}
                      className="p-1 text-gray-400 hover:text-white disabled:opacity-20 disabled:hover:text-gray-400 rounded hover:bg-gray-700 transition-colors"
                      title="Move Down (toward foreground)"
                    >
                      <MdKeyboardArrowDown size={18} />
                    </button>
                    <button 
                      type="button"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        deleteLayer(idx); 
                      }}
                      className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors ml-1"
                      title="Delete Layer"
                    >
                      <MdDelete size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button 
              onClick={resetProject}
              className="mt-4 flex items-center justify-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors w-full py-2 border border-dashed border-red-900/50 rounded-lg"
            >
              <MdRefresh /> Reset Everything
            </button>
          </div>
        </div>
      </div>

      {/* Main Content: Traits or Global Search Results */}
      <div className="flex-1 min-h-[500px]">
        {searchQuery.trim() ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-gray-800">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xl font-bold text-gray-200">
                    Search Results for <span className="text-primary-orange">"{searchQuery.trim()}"</span>
                  </h2>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                    {matchingTraits.length} {matchingTraits.length === 1 ? 'match' : 'matches'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Searched across {layers.length} layers ({totalTraitsCount} total traits)
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors border border-gray-700"
              >
                <MdClose size={14} /> Exit Search
              </button>
            </div>

            {matchingTraits.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
                {matchingTraits.map(({ trait, layer }) => (
                  <div 
                    key={`${layer.id}-${trait.id}`} 
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
                        onClick={() => deleteTrait(layer, trait)}
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

                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span className="truncate max-w-[100px] text-gray-400 font-medium" title={layer.name}>
                          📁 {layer.name}
                        </span>
                        <span className="text-gray-500 font-medium">
                          {trait.rarityType === RarityType.PERCENT ? `${trait.rarity}%` : `${trait.rarity} qty`}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          selectLayer(layer.id);
                          setSearchQuery('');
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-gray-700/60 hover:bg-primary-orange hover:text-white text-gray-300 text-[11px] font-bold transition-all"
                      >
                        <MdOpenInNew size={13} /> Go to Layer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 px-6 text-center bg-[#010002]/40 rounded-3xl border border-gray-800 space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-gray-800/80 flex items-center justify-center text-gray-500">
                  <MdSearchOff size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-200">No Traits Found</h3>
                  <p className="text-sm text-gray-400 mt-1 max-w-md mx-auto">
                    No trait matching <span className="text-primary-orange font-semibold">"{searchQuery.trim()}"</span> was found in any layer.
                  </p>
                  <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl max-w-md mx-auto text-xs text-green-400 text-left">
                    ✓ <strong>Confirmed:</strong> If you previously deleted this trait, it has been completely removed from your project and will not appear in generation.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-xs font-bold transition-colors"
                >
                  Clear Search
                </button>
              </div>
            )}
          </div>
        ) : activeLayer ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-primary-orange">{activeLayerDetails?.name}</h2>
              <label className="bg-primary-orange/10 hover:bg-primary-orange/20 text-primary-orange border border-primary-orange/30 px-6 py-3 rounded-2xl cursor-pointer transition-all flex items-center gap-2 font-black uppercase tracking-widest text-xs">
                <MdAdd size={20} /> Upload Traits
                <input 
                  type="file" 
                  multiple 
                  className="hidden" 
                  accept="image/*"
                  onChange={handleFileUpload}
                />
              </label>
            </div>

            <TraitPreviewGrid />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4 py-20">
            <MdAdd size={64} className="opacity-20" />
            <div className="text-center">
              <p className="text-xl font-bold">No Layers Yet</p>
              <p className="text-sm">Add a layer on the left to start adding traits.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LayersStep;
