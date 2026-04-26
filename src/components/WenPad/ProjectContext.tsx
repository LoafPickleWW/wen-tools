import { createContext, useContext } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { ProjectT, LayerT, PreviewItemT, TraitT } from './WenPadTypes';

export type ContextT = {
  form: UseFormReturn<ProjectT, any, any>;
  project: ProjectT;
  layers: LayerT[];
  customs: PreviewItemT[];
  activeLayer: string;
  activeLayerDetails?: LayerT;
  activeLayerIndex: number;
  activeStep: number;
  sortBy: string;
  generateIsLoading: boolean;
  previewItems: PreviewItemT[];
  filteredPreviewItems: PreviewItemT[];
  activeFilters: { traitType: string; traitValue: string }[];
  localSaving: boolean;
  localSaved: boolean;
  localError: string;
  localDataFetched?: boolean;
  hasChanges?: boolean;
  setOriginalProject: (project: ProjectT) => void;
  saveProject: () => void;
  selectLayer: (index: string) => void;
  selectStep: (index: number) => void;
  setSortBy: (sortBy: string) => void;
  resetProject: () => void;
  formatTrait: (file: any) => TraitT;
  deleteLayer: (index: number) => void;
  deleteTrait: (layer: LayerT, trait: TraitT) => void;
  generatePreviewItems: () => void;
  autofillRarity: (layerIndex: number) => void;
  filterPreviewItems: (e: any, traitType: string, traitValue: string) => void;
  addCustom: () => void;
  deleteCustom: (index: string) => void;
  downloadBackup: () => void;
  resetOriginalProject: () => void;
};

export const ProjectContext = createContext<ContextT>({} as ContextT);

export const useProject = () => useContext(ProjectContext);
