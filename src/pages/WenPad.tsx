import { ProjectProvider } from '../components/WenPad/ProjectProvider';
import WenPadGenerator from '../components/WenPad/WenPadGenerator';

export function WenPad() {
  return (
    <ProjectProvider>
      <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-full gap-y-2 min-h-screen p-4">
        <WenPadGenerator />
      </div>
    </ProjectProvider>
  );
}
