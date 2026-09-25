import { useState } from 'react';
import { useProject } from '../ProjectContext';
import { 
  MdAdd, 
  MdDelete, 
  MdSave, 
  MdRefresh, 
  MdDragIndicator, 
  MdKeyboardArrowUp, 
  MdKeyboardArrowDown 
} from 'react-icons/md';
import { v4 as uuid } from 'uuid';
import TraitPreviewGrid from './TraitPreviewGrid';

const LayersStep = () => {
  const { 
    form, layers, activeLayer, selectLayer, 
    deleteLayer, moveLayer, resetProject, saveProject,
    activeLayerDetails, activeLayerIndex, formatTrait,
    resetOriginalProject
  } = useProject();

  const [newLayerName, setNewLayerName] = useState('');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

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
              <span className="font-bold text-gray-300">
                {layers.reduce((acc, l) => acc + (l.traits?.length || 0), 0)}
              </span>
            </div>
          </div>

          <div className="space-y-4 mt-4">
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

      {/* Main Content: Traits */}
      <div className="flex-1 min-h-[500px]">
        {activeLayer ? (
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
