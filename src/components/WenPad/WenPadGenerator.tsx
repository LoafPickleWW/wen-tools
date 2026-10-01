import { ToolHero } from "../cypher/ToolKit";
import { useState } from 'react';
import { useProject } from './ProjectContext';
import { MdEdit, MdCheck, MdClose, MdRestorePage, MdArrowForward } from 'react-icons/md';
import WenPadStepper from './WenPadStepper';
import SetupStep from './steps/SetupStep';
import LayersStep from './steps/LayersStep';
import CustomizeStep from './steps/CustomizeStep';
import PreviewStep from './steps/PreviewStep';
import MintStep from './steps/MintStep';

const WenPadGenerator = () => {
  const { activeStep, form, project, resumePrompt, acceptResume, dismissResume } = useProject();
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Tool Title (Only on Step 0) */}
      {activeStep === 0 && (
        <ToolHero
          tag="wenpad"
          title="WenPad"
          description="Generate an NFT collection, layered art and metadata, in your browser, then take it straight to minting."
          meta={["setup", "layers", "customize", "preview", "mint"]}
        />
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
                className="p-2 bg-banner-grey/50 rounded-full text-gray-500 opacity-0 group-hover:opacity-100 transition-all hover:text-primary-orange hover:bg-primary-orange/10"
              >
                <MdEdit size={18} />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-4 bg-primary-black/40 p-4 rounded-3xl border border-primary-orange/20 backdrop-blur-xl">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-primary-orange ml-1">Name</label>
                <input 
                  {...form.register('name')}
                  className="bg-asset-detail-bg border border-white/[0.08] rounded-xl px-4 py-2 text-sm focus:border-primary-orange/50 outline-none w-48"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-primary-orange ml-1">Unit</label>
                <input 
                  {...form.register('unitName')}
                  className="bg-asset-detail-bg border border-white/[0.08] rounded-xl px-4 py-2 text-sm focus:border-primary-orange/50 outline-none w-24"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-primary-orange ml-1">Size</label>
                <input 
                  type="number"
                  {...form.register('size', { valueAsNumber: true })}
                  className="bg-asset-detail-bg border border-white/[0.08] rounded-xl px-4 py-2 text-sm focus:border-primary-orange/50 outline-none w-24"
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
               <span className="w-1 h-1 bg-banner-grey rounded-full" />
               <span>{project.size || 0} NFTs</span>
             </div>
          )}
        </div>
      )}

      {/* Resume Prompt Card */}
      {resumePrompt && (
        <div className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-primary-orange/30 bg-asset-detail-bg/95 p-5 sm:p-6 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl animate-in fade-in slide-in-from-top-3 duration-400">
          {/* Ambient decorative glow */}
          <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-primary-orange/15 blur-2xl" />

          {/* Quick dismiss button */}
          <button
            type="button"
            onClick={dismissResume}
            className="absolute right-3.5 top-3.5 rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
            title="Dismiss notification"
          >
            <MdClose size={18} />
          </button>

          <div className="flex items-start gap-4 pr-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-orange/10 border border-primary-orange/30 text-primary-orange shadow-inner">
              <MdRestorePage size={26} />
            </div>

            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-orange/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary-orange border border-primary-orange/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary-orange animate-pulse" />
                  Saved Draft Found
                </span>
                <span className="text-xs text-gray-400">
                  Last active on <span className="font-semibold text-gray-200">Step {resumePrompt.step + 1}: {resumePrompt.stepName}</span>
                </span>
              </div>

              <div>
                <h3 className="text-base sm:text-lg font-bold text-white">
                  Pick up where you left off with <span className="text-primary-orange font-black">&ldquo;{resumePrompt.projectName}&rdquo;</span>?
                </h3>
                <p className="mt-1 text-xs text-gray-400 leading-relaxed">
                  {resumePrompt.layersCount > 0 ? `${resumePrompt.layersCount} layer${resumePrompt.layersCount === 1 ? '' : 's'}` : '0 layers'}
                  {resumePrompt.itemsCount > 0 ? ` • ${resumePrompt.itemsCount} generated preview items` : ''}
                  {' '}• Reconnect and associate this draft with your current wallet.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={acceptResume}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary-orange to-secondary-orange px-5 py-2.5 text-xs font-black uppercase tracking-wider text-black shadow-lg shadow-primary-orange/25 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                >
                  <span>Resume Session</span>
                  <MdArrowForward size={15} />
                </button>
                <button
                  type="button"
                  onClick={dismissResume}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  Start Fresh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <WenPadStepper />
      
      <div className="bg-asset-detail-bg p-8 rounded-3xl border border-white/[0.08] shadow-2xl backdrop-blur-md">
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
