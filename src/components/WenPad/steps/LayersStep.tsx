import { useState } from 'react';
import { useProject } from '../ProjectContext';
import { MdAdd, MdDelete, MdSave, MdRefresh } from 'react-icons/md';
import { v4 as uuid } from 'uuid';
import TraitPreviewGrid from './TraitPreviewGrid';

const LayersStep = () => {
  const { 
    form, layers, activeLayer, selectLayer, 
    deleteLayer, resetProject, saveProject,
    activeLayerDetails, activeLayerIndex, formatTrait,
    resetOriginalProject
  } = useProject();

  const [newLayerName, setNewLayerName] = useState('');

  const handleAddLayer = () => {
    if (!newLayerName) return;
    const newLayer = {
      id: uuid(),
      name: newLayerName,
      traits: [],
      excludeFromMetadata: false
    };
    const updatedLayers = [...layers, newLayer];
    form.setValue('layers', updatedLayers);
    resetOriginalProject();
    setNewLayerName('');
    selectLayer(newLayer.id);
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
      form.setValue('layers', updatedLayers);
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
            <h3 className="text-lg font-bold text-gray-200">Layers</h3>
            <div className="flex gap-2">
              <input 
                value={newLayerName}
                onChange={(e) => setNewLayerName(e.target.value)}
                placeholder="Layer Name"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-orange"
              />
              <button 
                onClick={handleAddLayer}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                <MdAdd size={20} />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {layers.map((layer, idx) => (
                <div 
                  key={layer.id}
                  onClick={() => selectLayer(layer.id)}
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                    activeLayer === layer.id ? 'bg-primary-orange/20 border border-primary-orange/50' : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <span className="text-sm font-medium">{layer.name}</span>
                  <div className="flex gap-1">
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteLayer(idx); }}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
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
