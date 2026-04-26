import { useState } from 'react';
import { useProject } from './ProjectProvider';
import { MdEdit, MdCheck, MdClose } from 'react-icons/md';
import WenPadStepper from './WenPadStepper';
import SetupStep from './steps/SetupStep';
import LayersStep from './steps/LayersStep';
import CustomizeStep from './steps/CustomizeStep';
import PreviewStep from './steps/PreviewStep';
import MintStep from './steps/MintStep';

const WenPadGenerator = () => {
  const { activeStep, form, project } = useProject();
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Tool Title (Only on Step 0) */}
      {activeStep === 0 && (
        <div className="text-center space-y-2 mb-8 animate-in fade-in zoom-in duration-700">
          <h1 className="text-4xl font-black uppercase tracking-tighter bg-gradient-to-r from-primary-orange to-secondary-orange bg-clip-text text-transparent">
            Wen Pad
          </h1>
          <p className="text-gray-500 font-medium">The ultimate NFT collection generator and launchpad.</p>
        </div>
      )}

      {/* Project Title Header */}
      {activeStep > 0 && (
        <div className="flex flex-col items-center justify-center space-y-2 mb-4 animate-in fade-in slide-in-from-top-4 duration-500">
          {!isEditing ? (
            <div className="flex items-center gap-3 group">
              <h1 className="text-4xl font-black uppercase tracking-tighter bg-gradient-to-b from-white to-gray-500 bg-clip-text text-transparent">
                {project.name || 'Untitled Collection'}
              </h1>
              <button 
                onClick={() => setIsEditing(true)}
                className="p-2 bg-gray-800/50 rounded-full text-gray-500 opacity-0 group-hover:opacity-100 transition-all hover:text-primary-orange hover:bg-primary-orange/10"
              >
                <MdEdit size={18} />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-4 bg-[#010002]/40 p-4 rounded-3xl border border-primary-orange/20 backdrop-blur-xl">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-primary-orange ml-1">Name</label>
                <input 
                  {...form.register('name')}
                  className="bg-[#1A171A] border border-gray-800 rounded-xl px-4 py-2 text-sm focus:border-primary-orange/50 outline-none w-48"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-primary-orange ml-1">Unit</label>
                <input 
                  {...form.register('unitName')}
                  className="bg-[#1A171A] border border-gray-800 rounded-xl px-4 py-2 text-sm focus:border-primary-orange/50 outline-none w-24"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-primary-orange ml-1">Size</label>
                <input 
                  type="number"
                  {...form.register('size', { valueAsNumber: true })}
                  className="bg-[#1A171A] border border-gray-800 rounded-xl px-4 py-2 text-sm focus:border-primary-orange/50 outline-none w-24"
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="p-2 bg-green-500/20 text-green-500 rounded-xl hover:bg-green-500/30 transition-all"
                >
                  <MdCheck size={20} />
                </button>
                <button 
                  onClick={() => setIsEditing(false)}
                  className="p-2 bg-red-500/20 text-red-500 rounded-xl hover:bg-red-500/30 transition-all"
                >
                  <MdClose size={20} />
                </button>
              </div>
            </div>
          )}
          {activeStep > 0 && !isEditing && (
             <div className="flex items-center gap-4 text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">
               <span>{project.unitName || 'WEN'}</span>
               <span className="w-1 h-1 bg-gray-800 rounded-full" />
               <span>{project.size || 0} NFTs</span>
             </div>
          )}
        </div>
      )}

      <WenPadStepper />
      
      <div className="bg-[#1A171A] p-8 rounded-3xl border border-gray-800 shadow-2xl backdrop-blur-md">
        {activeStep === 0 && <SetupStep />}
        {activeStep === 1 && <LayersStep />}
        {activeStep === 2 && <CustomizeStep />}
        {activeStep === 3 && <PreviewStep />}
        {activeStep === 4 && <MintStep />}
      </div>
    </div>
  );
};

export default WenPadGenerator;
