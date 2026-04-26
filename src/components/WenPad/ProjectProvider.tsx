import React, { useEffect, useState, useCallback } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { v4 as uuid } from 'uuid';
import { toast } from 'react-toastify';
import { saveAs } from 'file-saver';
import { db } from './db';
import { 
  RarityType, 
  ProjectT, 
  LayerT, 
  PreviewItemT, 
  TraitT 
} from './WenPadTypes';
import {
  addRankings,
  addRatings,
  createTraitStore,
  getRandomTrait,
  getTraitsFromTraitStore,
  handleBlockTraits,
  handleForceTraits,
} from './ProjectUtils';

import { ProjectContext } from './ProjectContext';

type Props = {
  children: React.ReactNode;
};

export const ProjectProvider = ({ children }: Props) => {
  const [, setOriginalProject] = useState<ProjectT>();
  const [activeLayer, setActiveLayer] = useState<string>('');
  const [activeStep, setActiveStep] = useState<number>(0);
  const [sortBy, setSortBy] = useState('name');
  const [activeFilters, setActiveFilters] = useState<{ traitType: string; traitValue: string }[]>([]);
  const [localSaving, setLocalSaving] = useState<boolean>(false);
  const [localSaved, setLocalSaved] = useState<boolean>(false);
  const [localDataFetched, setLocalDataFetched] = useState<boolean>();
  const [localError, setLocalError] = useState<string>('');
  const [generateIsLoading, setGenerateIsLoading] = useState<boolean>(false);

  const form = useForm<ProjectT>({
    defaultValues: {
      name: '',
      unitName: '',
      description: '',
      website: '',
      size: 0,
      imageWidth: 1000,
      imageHeight: 1000,
      layers: [],
      customs: [],
      previewItems: [],
    },
    mode: 'onChange',
  });

  const { append } = useFieldArray({
    control: form.control,
    name: 'customs',
  });

  const hasChanges = form.formState.isDirty;
  const project = form.watch();
  const layers = project.layers || [];
  const previewItems = project.previewItems || [];
  const customs = project.customs || [];

  const activeLayerDetails = layers.find((f) => f.id === activeLayer);
  const activeLayerIndex = layers.findIndex((f) => f.id === activeLayer) !== -1 ? layers.findIndex((f) => f.id === activeLayer) : 0;

  const filteredPreviewItems = previewItems
    .filter((item) => {
      const itemTraits = Object.values(item.traits);
      const matches = itemTraits.filter((trait) => {
        const filter = activeFilters.find((f) => f.traitType === trait.trait_type);
        if (!filter) return false;

        const sameAs = layers.find((f) => f.name === trait.trait_type)?.traits.find((f) => f.id === trait.traitId)?.sameAs;
        const sameAsDetails = layers.find((f) => f.name === trait.trait_type)?.traits.find((f) => f.id === sameAs);
        if (sameAsDetails) {
          return filter.traitValue === sameAsDetails.name;
        }

        return filter.traitValue === trait.value;
      });
      return matches.length === activeFilters.length;
    })
    .sort((a: PreviewItemT, b: PreviewItemT) => {
      if (sortBy === 'rank') {
        return a.ranking - b.ranking;
      } else if (sortBy === 'rank-reverse') {
        return b.ranking - a.ranking;
      }
      return 0;
    });

  const selectLayer = (id: string) => {
    setActiveLayer(id);
  };

  const selectStep = (index: number) => {
    setActiveStep(index);
    setGenerateIsLoading(false);
  };

  const saveProjectLocally = async (input: ProjectT) => {
    try {
      setLocalSaving(true);
      setLocalSaved(false);
      setLocalError('');

      input.layers = input.layers.filter((f) => f.name && f.id);

      const projects = await db.projects.toArray();
      if (projects.length > 0) {
        await db.projects.update(projects[0].id!, input);
      } else {
        await db.projects.add(input);
      }
      setOriginalProject(input);
      setLocalSaved(true);
      form.reset(input);

      setTimeout(() => {
        setLocalSaved(false);
      }, 4000);
    } catch (error: any) {
      console.error(error);
      setLocalError(error.message || 'Something went wrong');
    } finally {
      setLocalSaving(false);
    }
  };

  const saveProject = async function () {
    const localProject = form.getValues();
    if (localProject.layers.length === 0) {
      return toast.error('Please add at least one layer');
    }
    saveProjectLocally(localProject);
  };

  const resetProject = async () => {
    if (!window.confirm('Are you sure you want to reset the project?')) return;
    await db.projects.clear();
    form.reset({
      name: '',
      unitName: '',
      description: '',
      website: '',
      size: 0,
      imageWidth: 1000,
      imageHeight: 1000,
      layers: [],
      previewItems: [],
    });
    setActiveLayer('');
    setLocalDataFetched(false);
    setLocalSaved(false);
    setLocalError('');
  };

  const addCustom = () => {
    const _customs = form.getValues('customs');
    const lastIndex = _customs.length || 0;
    const lastCustom = _customs[lastIndex - 1];

    append({
      index: lastCustom ? lastCustom.index + 1 : 1,
      traits: {},
      rating: 0,
      ranking: 0,
      id: uuid(),
    });
    resetOriginalProject();
    toast.success('Custom added');
  };

  const deleteCustom = (id: string) => {
    const _customs = form.getValues('customs');
    const updatedCustoms = _customs.filter((f) => f.id !== id);
    form.setValue('customs', updatedCustoms);
    resetOriginalProject();
    toast.success('Custom deleted');
  };

  const deleteLayer = (index: number) => {
    if (!window.confirm('Are you sure you want to delete this layer?')) return;
    setActiveLayer('');
    const layers = form.getValues('layers');
    layers.splice(index, 1);
    form.setValue('layers', layers);
    resetOriginalProject();
    toast.success('Layer deleted');
  };

  const deleteTrait = (layer: LayerT, trait: TraitT) => {
    if (!window.confirm('Are you sure you want to delete this trait?')) return;
    const traits = layer.traits.filter((f) => f.id !== trait.id);
    const layerIndex = layers.findIndex((f) => f.id === layer.id);
    form.setValue(`layers.${layerIndex}.traits`, traits);
    resetOriginalProject();
    toast.success('Trait deleted');
  };

  const formatTrait = (file: any): TraitT => {
    return {
      id: uuid(),
      name: file.name.replace(/\.[^/.]+$/, ''),
      type: file.type,
      size: file.size,
      data: file.data,
      alternatives: [],
      rules: [],
      rarity: 0,
      sameAs: '',
      excludeTraitFromRandomGenerations: false,
      rarityType: RarityType.PERCENT,
    };
  };

  const generatePreviewItems = async () => {
    const projectSize = form.getValues('size');
    const layers = form.getValues('layers');

    if (layers.length === 0) return toast.error('Please add at least one layer');
    if (projectSize <= 0) return toast.error('Please enter a collection size');

    if (!window.confirm('Are you sure you want to generate new images?')) return;

    form.setValue('previewItems', []);
    setOriginalProject({
      ...form.getValues(),
      previewItems: [],
    });
    setActiveFilters([]);
    setGenerateIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const customs = form.getValues('customs');
    const size = form.getValues('size');
    const items: PreviewItemT[] = [];
    const traitStore = createTraitStore(layers, size);
    const allErrors: string[] = [];

    for (let i = 0; i < size; i++) {
      try {
        const custom = customs.find((f) => f.index === i + 1);
        if (custom) {
          items.push(custom);
        } else {
          const { item, errors } = generatePreviewItem(items);
          allErrors.push(...errors);
          item.index = i + 1;
          items.push(item);
        }
      } catch {
        allErrors.push('Generation failed for item ' + (i + 1));
      }

      if (allErrors.length > 100) {
        toast.error('Cannot create enough unique images. Please check traits and rarity.');
        setGenerateIsLoading(false);
        return;
      }
    }

    addRatings(items, layers);
    addRankings(items);

    form.setValue('previewItems', items);
    resetOriginalProject();
    setGenerateIsLoading(false);

    function generatePreviewItem(existingItems: PreviewItemT[]) {
      const errors = [];
      let previewItem: PreviewItemT = {
        index: 0,
        traits: {},
        rating: 0,
        ranking: 0,
        id: uuid(),
      };

      for (let j = 0; j < layers.length; j++) {
        const layer = layers[j];
        const availableTraits = getTraitsFromTraitStore(traitStore, layer);
        const trait = getRandomTrait(availableTraits);
        if (!trait) {
          errors.push(`No traits for ${layer.name}`);
          continue;
        }
        previewItem.traits[layer.name] = {
          trait_type: layer.name,
          value: trait.name,
          image: trait.data,
          excludeFromMetadata: layer.excludeFromMetadata,
          layerId: layer.id,
          traitId: trait.id,
        };
      }

      previewItem = handleForceTraits(previewItem, layers);
      previewItem = handleBlockTraits(previewItem, layers);

      const itemStrings = existingItems.map((item) =>
        Object.values(item.traits).map((trait) => trait.value).join(',')
      );

      if (itemStrings.includes(Object.values(previewItem.traits).map((trait) => trait.value).join(','))) {
        return generatePreviewItem(existingItems);
      }

      Object.keys(previewItem.traits).forEach((key) => {
        const trait = previewItem.traits[key];
        const traitIndex = traitStore[key].findIndex((f) => f === trait.value);
        if (traitIndex !== -1) traitStore[key].splice(traitIndex, 1);
      });

      return { item: previewItem, errors };
    }
  };

  const autofillRarity = (layerIndex: number) => {
    const layers = form.getValues('layers');
    const traits = layers[layerIndex].traits;
    const rarityPerTrait = 100 / traits.length;
    traits.forEach((trait) => {
      if (trait.rarityType === RarityType.PERCENT) trait.rarity = rarityPerTrait;
    });
    form.setValue(`layers.${layerIndex}.traits`, traits);
    toast.success('Rarity autofilled');
  };

  const filterPreviewItems = (e: any, traitType: string, traitValue: string) => {
    const checked = e.target.checked;
    if (checked) {
      setActiveFilters([...activeFilters, { traitType, traitValue }]);
    } else {
      setActiveFilters(activeFilters.filter((f) => f.traitType !== traitType || f.traitValue !== traitValue));
    }
  };

  const getProjectFromLocalDb = useCallback(async () => {
    try {
      const projects = await db.projects.toArray();
      if (projects[0]) {
        form.reset(projects[0]);
        setOriginalProject(projects[0]);
        setActiveLayer(projects[0].layers[0]?.id || '');
      }
      setLocalDataFetched(true);
    } catch (error) {
      console.error(error);
    }
  }, [form]);

  const resetOriginalProject = () => {
    setOriginalProject(form.getValues());
  };

  const downloadBackup = () => {
    const data = new Blob([JSON.stringify(form.getValues(), null, 2)], { type: 'application/json' });
    saveAs(data, 'wenpad-project.json');
  };

  useEffect(() => {
    getProjectFromLocalDb();
  }, [getProjectFromLocalDb]);

  return (
    <ProjectContext.Provider
      value={{
        form, project, layers, activeLayer, activeLayerDetails, activeLayerIndex,
        previewItems, generateIsLoading, filteredPreviewItems, selectLayer,
        activeStep, activeFilters, sortBy, setOriginalProject,
        localSaving, localSaved, localError, localDataFetched,
        hasChanges, customs, saveProject, selectStep, setSortBy,
        resetProject, formatTrait, deleteTrait, deleteLayer,
        generatePreviewItems, autofillRarity, filterPreviewItems,
        addCustom, deleteCustom, downloadBackup, resetOriginalProject,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};


