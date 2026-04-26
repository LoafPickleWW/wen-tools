import { useProject } from '../ProjectContext';
import { MdRocketLaunch, MdArrowForward } from 'react-icons/md';

const SetupStep = () => {
  const { form, selectStep } = useProject();

  return (
    <div className="max-w-3xl mx-auto space-y-8 py-10">
      <div className="text-center space-y-4">
        <div className="inline-block p-4 bg-primary-orange/10 rounded-full text-primary-orange shadow-2xl shadow-primary-orange/20">
          <MdRocketLaunch size={48} />
        </div>
        <h2 className="text-4xl font-black uppercase tracking-tighter">Start Your Collection</h2>
        <p className="text-gray-400 font-medium max-w-md mx-auto">
          Let's gather some basic information about your project before we dive into the layers and traits.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#010002]/40 p-8 rounded-3xl border border-gray-800">
        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-orange ml-1">Collection Name</label>
          <input 
            {...form.register('name')}
            placeholder="e.g. Astro Punks"
            className="w-full bg-[#1A171A] border border-gray-800 rounded-2xl px-6 py-4 text-lg font-bold focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-orange ml-1">Unit Name</label>
          <input 
            {...form.register('unitName')}
            placeholder="e.g. ASTRO"
            className="w-full bg-[#1A171A] border border-gray-800 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-orange ml-1">Collection Size</label>
          <input 
            type="number"
            {...form.register('size', { valueAsNumber: true })}
            placeholder="How many NFTs?"
            className="w-full bg-[#1A171A] border border-gray-800 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700"
          />
        </div>

        <div className="col-span-full space-y-1 pt-4">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-orange ml-1">Description</label>
          <textarea 
            {...form.register('description')}
            placeholder="Tell us about your collection..."
            rows={3}
            className="w-full bg-[#1A171A] border border-gray-800 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-primary-orange/50 transition-all placeholder:text-gray-700 resize-none"
          />
        </div>
      </div>

      <div className="flex justify-center">
        <button 
          onClick={() => selectStep(1)}
          className="group flex items-center gap-3 bg-white text-black font-black px-10 py-5 rounded-3xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-2xl shadow-white/10"
        >
          NEXT: CONFIGURE LAYERS
          <MdArrowForward className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  );
};

export default SetupStep;
