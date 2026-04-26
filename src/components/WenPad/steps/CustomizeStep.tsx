import { useProject } from '../ProjectProvider';
import { MdAdd, MdDelete, MdAutoFixHigh } from 'react-icons/md';

const CustomizeStep = () => {
  const { 
    customs, addCustom, deleteCustom, layers, 
    form, resetOriginalProject 
  } = useProject();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter">Custom 1/1s</h2>
          <p className="text-sm text-gray-500 font-medium">Define specific combinations for legendary items.</p>
        </div>
        <button 
          onClick={addCustom}
          className="flex items-center gap-2 bg-primary-orange text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs hover:opacity-80 transition-all shadow-lg shadow-primary-orange/20"
        >
          <MdAdd size={20} /> Add Custom
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {customs.map((custom) => (
          <div key={custom.id} className="bg-gray-800 border border-gray-700 p-4 rounded-xl space-y-4">
            <div className="flex justify-between items-center">
              <span className="font-bold text-primary-orange">Custom #{custom.index}</span>
              <button 
                onClick={() => deleteCustom(custom.id)}
                className="text-red-400 hover:text-red-300"
              >
                <MdDelete size={20} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              {layers.map(layer => (
                <div key={layer.id} className="space-y-1">
                  <label className="text-[10px] uppercase text-gray-500">{layer.name}</label>
                  <select 
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-primary-orange"
                    value={custom.traits[layer.name]?.value || ''}
                    onChange={(e) => {
                      const trait = layer.traits.find(t => t.name === e.target.value);
                      if (trait) {
                        const updatedCustoms = [...customs];
                        const cIdx = updatedCustoms.findIndex(c => c.id === custom.id);
                        updatedCustoms[cIdx].traits[layer.name] = {
                          layerId: layer.id,
                          traitId: trait.id,
                          trait_type: layer.name,
                          value: trait.name,
                          image: trait.data,
                          excludeFromMetadata: layer.excludeFromMetadata
                        };
                        form.setValue('customs', updatedCustoms, { shouldDirty: true });
                        resetOriginalProject();
                      }
                    }}
                  >
                    <option value="">Random</option>
                    {layer.traits.map(t => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}

        {customs.length === 0 && (
          <div className="col-span-full py-20 border-2 border-dashed border-gray-800 rounded-2xl flex flex-col items-center justify-center text-gray-500">
             <MdAutoFixHigh size={48} className="opacity-10 mb-4" />
             <p>No customs defined yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomizeStep;
