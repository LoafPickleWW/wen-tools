import { MdSettings, MdAutoFixHigh, MdVisibility, MdRocketLaunch, MdLayers } from 'react-icons/md';
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
    },
    {
      id: 3,
      name: 'Preview',
      icon: <MdVisibility />,
      description: 'Generate images',
      disabled: !hasSomeTraits,
    },
    {
      id: 4,
      name: 'Launch',
      icon: <MdRocketLaunch />,
      description: 'Pin & Mint',
      disabled: !hasSomeItems,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      {steps.map((step) => {
        const isActive = activeStep === step.id;
        return (
          <button
            key={step.id}
            onClick={() => !step.disabled && selectStep(step.id)}
            disabled={step.disabled}
            className={`flex flex-col items-center p-4 rounded-xl border transition-all ${
              isActive 
                ? 'bg-primary-orange/10 border-primary-orange text-primary-orange shadow-lg shadow-primary-orange/5' 
                : 'bg-gray-900/30 border-gray-800 text-gray-500 hover:border-gray-700'
            } ${step.disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className={`text-2xl mb-2 ${isActive ? 'text-primary-orange' : 'text-gray-600'}`}>
              {step.icon}
            </div>
            <div className="font-bold text-sm uppercase tracking-wider">{step.name}</div>
            <div className="text-xs opacity-60 text-center">{step.description}</div>
          </button>
        );
      })}
    </div>
  );
};

function layersHaveTraits(layers: any[]) {
  if (!layers) return false;
  return layers.some((l) => l.traits && l.traits.length > 0);
}

export default WenPadStepper;
