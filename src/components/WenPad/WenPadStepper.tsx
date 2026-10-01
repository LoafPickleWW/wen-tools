import { MdSettings, MdAutoFixHigh, MdVisibility, MdRocketLaunch, MdLayers, MdLock, MdCheck } from 'react-icons/md';
import { useProject } from './ProjectContext';

const WenPadStepper = () => {
  const { activeStep, selectStep, project, previewItems } = useProject();
  
  const hasSomeTraits = layersHaveTraits(project.layers);
  const hasSomeItems = previewItems && previewItems.length > 0;

  const steps = [
    {
      id: 0,
      name: 'Setup',
      icon: <MdSettings />,
      description: 'Collection info',
      disabled: false,
    },
    {
      id: 1,
      name: 'Layers',
      icon: <MdLayers />, // Need to import MdLayers
      description: 'Setup traits',
      disabled: false,
    },
    {
      id: 2,
      name: 'Customs',
      icon: <MdAutoFixHigh />,
      description: 'Define 1/1s',
      disabled: !hasSomeTraits,
      lockedHint: 'add traits first',
    },
    {
      id: 3,
      name: 'Preview',
      icon: <MdVisibility />,
      description: 'Generate images',
      disabled: !hasSomeTraits,
      lockedHint: 'add traits first',
    },
    {
      id: 4,
      name: 'Launch',
      icon: <MdRocketLaunch />,
      description: 'Pin & Mint',
      disabled: !hasSomeItems,
      lockedHint: 'generate a preview first',
    },
  ];

  return (
    <nav aria-label="WenPad steps" className="relative mb-8">
      {/* Progress rail (desktop): fills up to the current step */}
      <div aria-hidden="true" className="absolute left-[10%] right-[10%] top-[1.35rem] hidden h-px bg-white/[0.08] md:block">
        <div
          className="h-full bg-gradient-to-r from-primary-orange to-primary-yellow transition-all duration-500"
          style={{ width: `${(activeStep / (steps.length - 1)) * 100}%` }}
        />
      </div>
      <ol className="relative grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 md:gap-3">
        {steps.map((step) => {
          const isActive = activeStep === step.id;
          const isDone = step.id < activeStep && !step.disabled;
          const locked = step.disabled;
          return (
            <li key={step.id}>
              <button
                onClick={() => !locked && selectStep(step.id)}
                disabled={locked}
                aria-current={isActive ? "step" : undefined}
                className={`group flex h-full w-full flex-col items-center rounded-2xl border px-3 pb-3.5 pt-2 text-center transition-all ${
                  isActive
                    ? "border-primary-orange/50 bg-primary-orange/[0.08] shadow-[0_0_24px_-8px_rgb(var(--brand)/0.6)]"
                    : locked
                    ? "cursor-not-allowed border-dashed border-white/[0.1] bg-transparent"
                    : "border-white/[0.08] bg-banner-grey/50 hover:border-white/20 hover:bg-banner-grey/80"
                }`}
              >
                {/* Node on the rail */}
                <span
                  className={`relative z-10 grid h-9 w-9 place-items-center rounded-full border text-lg transition ${
                    isActive
                      ? "border-primary-orange bg-primary-black text-primary-orange"
                      : isDone
                      ? "border-primary-orange/60 bg-primary-orange text-black"
                      : locked
                      ? "border-white/10 bg-primary-black text-slate-600"
                      : "border-white/15 bg-primary-black text-slate-300 group-hover:text-white"
                  }`}
                >
                  {isDone ? <MdCheck /> : locked ? <MdLock className="text-sm" /> : step.icon}
                </span>
                <span className={`mt-2 font-mono text-[10px] ${isActive ? "text-primary-orange" : "text-slate-500"}`}>
                  {String(step.id + 1).padStart(2, "0")}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    isActive ? "text-white" : locked ? "text-slate-400" : "text-slate-200"
                  }`}
                >
                  {step.name}
                </span>
                <span className={`text-xs ${locked ? "font-mono text-[10px] text-slate-500" : "text-slate-500"}`}>
                  {locked && step.lockedHint ? step.lockedHint : step.description}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

function layersHaveTraits(layers: any[]) {
  if (!layers) return false;
  return layers.some((l) => l.traits && l.traits.length > 0);
}

export default WenPadStepper;
