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
  TraitT,
  RuleT 
} from './WenPadTypes';
import {
  addRankings,
  addRatings,
  createTraitStore,
  getRandomTrait,
  getTraitsFromTraitStore,
  handleBlockTraits,
  handleForceTraits,
  sanitizeProject,
  purgeInvalidPreviewItems,
} from './ProjectUtils';
import { clearPreviewCaches, compositePreviewCache } from './PreviewImage';

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

  const moveLayer = (fromIndex: number, toIndex: number) => {
    const currentLayers = form.getValues('layers');
    if (toIndex < 0 || toIndex >= currentLayers.length) return;
    const updated = [...currentLayers];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    form.setValue('layers', updated, { shouldDirty: true });
    resetOriginalProject();
    clearPreviewCaches();
  };

  const deleteLayer = (index: number) => {
    if (!window.confirm('Are you sure you want to delete this layer?')) return;
    setActiveLayer('');
    const currentValues = form.getValues();
    const initialItemsCount = (currentValues.previewItems || []).length;
    currentValues.layers.splice(index, 1);
    const cleaned = sanitizeProject(currentValues);
    const purgedCount = initialItemsCount - (cleaned.previewItems || []).length;
    form.reset(cleaned);
    resetOriginalProject();
    clearPreviewCaches();
    if (purgedCount > 0) {
      toast.success(`Layer deleted & purged ${purgedCount} affected assets`);
    } else {
      toast.success('Layer deleted');
    }
  };

  const deleteTrait = (layer: LayerT, trait: TraitT) => {
    if (!window.confirm('Are you sure you want to delete this trait?')) return;
    const currentValues = form.getValues();
    const initialItemsCount = (currentValues.previewItems || []).length;
    const layerIndex = currentValues.layers.findIndex((f) => f.id === layer.id);
    if (layerIndex !== -1) {
      currentValues.layers[layerIndex].traits = currentValues.layers[layerIndex].traits.filter((f) => f.id !== trait.id);
    }
    const cleaned = sanitizeProject(currentValues);
    const purgedCount = initialItemsCount - (cleaned.previewItems || []).length;
    form.reset(cleaned);
    resetOriginalProject();
    clearPreviewCaches();
    if (purgedCount > 0) {
      toast.success(`Trait deleted & purged ${purgedCount} affected assets`);
    } else {
      toast.success('Trait deleted');
    }
  };

  const purgeDeletedTraitAssets = () => {
    const currentValues = form.getValues();
    const { project: cleaned, purgedCount } = purgeInvalidPreviewItems(currentValues);
    if (purgedCount > 0) {
      form.reset(cleaned);
      resetOriginalProject();
      clearPreviewCaches();
      toast.success(`Purged ${purgedCount} assets with deleted traits and renumbered collection`);
    } else {
      toast.info('All assets are clean! No assets contain deleted traits.');
    }
    return purgedCount;
  };

  const addTraitRule = (sourceLayerId: string, sourceTraitId: string, rule: RuleT) => {
    const currentValues = form.getValues();
    const updatedLayers = currentValues.layers.map((layer) => {
      if (layer.id !== sourceLayerId && layer.name !== sourceLayerId) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t) => {
          if (t.id !== sourceTraitId && t.name !== sourceTraitId) return t;
          const existingRules = t.rules || [];
          const alreadyExists = existingRules.some(
            (r) => r.type === rule.type && r.layer === rule.layer && r.trait === rule.trait
          );
          if (alreadyExists) return t;
          return {
            ...t,
            rules: [...existingRules, rule],
          };
        }),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
    toast.success(`Rule saved: ${rule.type === 'block' ? 'Never use with' : 'Always use with'}`);
  };

  const deleteTraitRule = (sourceLayerId: string, sourceTraitId: string, ruleIndex: number) => {
    const currentValues = form.getValues();
    const updatedLayers = currentValues.layers.map((layer) => {
      if (layer.id !== sourceLayerId && layer.name !== sourceLayerId) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t) => {
          if (t.id !== sourceTraitId && t.name !== sourceTraitId) return t;
          const existingRules = [...(t.rules || [])];
          existingRules.splice(ruleIndex, 1);
          return {
            ...t,
            rules: existingRules,
          };
        }),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
    toast.success('Rule removed');
  };

  const addLayerRule = (layerId: string, rule: RuleT) => {
    const currentValues = form.getValues();
    const updatedLayers = currentValues.layers.map((layer) => {
      if (layer.id !== layerId && layer.name !== layerId) return layer;
      const existingRules = layer.rules || [];
      return {
        ...layer,
        rules: [...existingRules, rule],
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
    toast.success('Category rule added');
  };

  const deleteLayerRule = (layerId: string, ruleIndex: number) => {
    const currentValues = form.getValues();
    const updatedLayers = currentValues.layers.map((layer) => {
      if (layer.id !== layerId && layer.name !== layerId) return layer;
      const existingRules = [...(layer.rules || [])];
      existingRules.splice(ruleIndex, 1);
      return {
        ...layer,
        rules: existingRules,
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
    toast.success('Category rule removed');
  };

  const updateTraitName = (layerId: string, traitId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error('Trait name cannot be empty');
      return;
    }
    const currentValues = form.getValues();
    let oldName = '';
    let targetLayerName = '';

    const updatedLayers = currentValues.layers.map((layer) => {
      if (layer.id !== layerId && layer.name !== layerId) return layer;
      targetLayerName = layer.name;
      return {
        ...layer,
        traits: layer.traits.map((t) => {
          if (t.id !== traitId && t.name !== traitId) return t;
          oldName = t.name;
          return { ...t, name: trimmed };
        }),
      };
    });

    const currentPreviews = currentValues.previewItems || [];
    const updatedPreviews = currentPreviews.map((item) => {
      if (!item.traits || !item.traits[targetLayerName]) return item;
      const currentTrait = item.traits[targetLayerName];
      if (currentTrait.traitId === traitId || currentTrait.value === oldName) {
        return {
          ...item,
          traits: {
            ...item.traits,
            [targetLayerName]: {
              ...currentTrait,
              value: trimmed,
            },
          },
        };
      }
      return item;
    });

    const currentCustoms = currentValues.customs || [];
    const updatedCustoms = currentCustoms.map((custom) => {
      if (!custom.traits || !custom.traits[targetLayerName]) return custom;
      const currentTrait = custom.traits[targetLayerName];
      if (currentTrait.traitId === traitId || currentTrait.value === oldName) {
        return {
          ...custom,
          traits: {
            ...custom.traits,
            [targetLayerName]: {
              ...currentTrait,
              value: trimmed,
            },
          },
        };
      }
      return custom;
    });

    form.setValue('layers', updatedLayers, { shouldDirty: true });
    form.setValue('previewItems', updatedPreviews, { shouldDirty: true });
    form.setValue('customs', updatedCustoms, { shouldDirty: true });
    resetOriginalProject();
    toast.success(`Renamed trait to "${trimmed}"`);
  };

  const updatePreviewItemTraitName = (itemIndex: number, layerName: string, newValue: string) => {
    const currentPreviews = form.getValues('previewItems') || [];
    const idx = currentPreviews.findIndex((item) => item.index === itemIndex);
    if (idx === -1) return;

    const item = currentPreviews[idx];
    if (!item.traits || !item.traits[layerName]) return;

    const updatedItem = {
      ...item,
      traits: {
        ...item.traits,
        [layerName]: {
          ...item.traits[layerName],
          value: newValue,
        },
      },
    };

    const newPreviews = [...currentPreviews];
    newPreviews[idx] = updatedItem;
    form.setValue('previewItems', newPreviews, { shouldDirty: true });
    resetOriginalProject();
    toast.success(`Updated trait on #${itemIndex}`);
  };

  const updatePreviewItemTrait = (
    itemIndex: number,
    layerName: string,
    traitId: string | null
  ): PreviewItemT | undefined => {
    const currentPreviews = form.getValues('previewItems') || [];
    const idx = currentPreviews.findIndex((item) => item.index === itemIndex);
    if (idx === -1) return;

    const item = currentPreviews[idx];
    const allLayers = form.getValues('layers') || [];
    const layer = allLayers.find((l) => l.name === layerName || l.id === layerName);
    if (!layer) return;

    const updatedTraits = { ...(item.traits || {}) };

    if (!traitId || traitId === 'none' || traitId === 'empty') {
      delete updatedTraits[layer.name];
    } else {
      const trait = layer.traits?.find((t) => t.id === traitId || t.name === traitId);
      if (!trait) return;

      updatedTraits[layer.name] = {
        layerId: layer.id,
        traitId: trait.id,
        trait_type: layer.name,
        value: trait.name,
        image: trait.data,
        excludeFromMetadata: layer.excludeFromMetadata,
      };
    }

    // Duplicate check: ensure this manually swapped combination isn't a duplicate of another generated NFT
    const getFingerprint = (traits: PreviewItemT['traits']) => {
      return allLayers.map((l) => `${l.name}=${traits?.[l.name]?.value || 'none'}`).join('|');
    };

    const candidateFingerprint = getFingerprint(updatedTraits);
    const duplicateItem = currentPreviews.find(
      (otherItem, otherIdx) => otherIdx !== idx && getFingerprint(otherItem.traits) === candidateFingerprint
    );

    if (duplicateItem) {
      toast.error(
        `Cannot swap: This trait combination already exists on NFT #${duplicateItem.index}. Each NFT must be unique.`,
        { autoClose: 4500 }
      );
      return;
    }

    const updatedItem: PreviewItemT = {
      ...item,
      id: uuid(), // New ID forces PreviewImage canvas to redraw immediately
      traits: updatedTraits,
    };

    const newPreviews = [...currentPreviews];
    newPreviews[idx] = updatedItem;

    addRatings(newPreviews, allLayers);
    addRankings(newPreviews);

    // Invalidate composite preview cache for the previous item ID
    compositePreviewCache.delete(item.id);

    // If this item was a custom 1/1, sync with customs array too
    const currentCustoms = form.getValues('customs') || [];
    const cIdx = currentCustoms.findIndex((c) => c.id === item.id || c.index === item.index);
    if (cIdx !== -1) {
      const updatedCustoms = [...currentCustoms];
      updatedCustoms[cIdx] = {
        ...updatedCustoms[cIdx],
        traits: updatedTraits,
      };
      form.setValue('customs', updatedCustoms, { shouldDirty: true });
    }

    form.setValue('previewItems', newPreviews, { shouldDirty: true });
    resetOriginalProject();

    if (traitId && traitId !== 'none' && traitId !== 'empty') {
      toast.success(`Updated ${layer.name} to "${updatedTraits[layer.name]?.value}" on #${itemIndex}`);
    } else {
      toast.success(`Removed ${layer.name} trait on #${itemIndex}`);
    }

    return newPreviews[idx];
  };

  const updateCustomTraitName = (customId: string, layerName: string, newValue: string) => {
    const currentCustoms = form.getValues('customs') || [];
    const idx = currentCustoms.findIndex((c) => c.id === customId);
    if (idx === -1) return;

    const custom = currentCustoms[idx];
    if (!custom.traits || !custom.traits[layerName]) return;

    const updatedCustom = {
      ...custom,
      traits: {
        ...custom.traits,
        [layerName]: {
          ...custom.traits[layerName],
          value: newValue,
        },
      },
    };

    const newCustoms = [...currentCustoms];
    newCustoms[idx] = updatedCustom;
    form.setValue('customs', newCustoms, { shouldDirty: true });
    resetOriginalProject();
    toast.success(`Updated trait on Custom #${custom.index}`);
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
    const projectSize = Number(form.getValues('size')) || 0;
    const layers = form.getValues('layers') || [];

    if (layers.length === 0) return toast.error('Please add at least one layer');
    if (projectSize <= 0) return toast.error('Please enter a collection size');

    if (!window.confirm('Are you sure you want to generate new images?')) return;

    clearPreviewCaches();
    
    // Sanitize any orphaned traits from customs or previews
    const cleanedProject = sanitizeProject(form.getValues());
    form.setValue('customs', cleanedProject.customs, { shouldDirty: true });
    
    form.setValue('previewItems', []);
    setOriginalProject({
      ...cleanedProject,
      previewItems: [],
    });
    setActiveFilters([]);
    setGenerateIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const customs = cleanedProject.customs || [];
    const size = projectSize;
    const items: PreviewItemT[] = [];
    const traitStore = createTraitStore(layers, size);
    const existingFingerprints = new Set<string>();

    const getFingerprint = (traits: PreviewItemT['traits']) => {
      return layers.map((l) => `${l.name}=${traits[l.name]?.value || 'none'}`).join('|');
    };

    // 1. Process custom 1/1s first
    for (let i = 0; i < size; i++) {
      const custom = customs.find((f) => f.index === i + 1);
      if (custom) {
        const customItem: PreviewItemT = {
          ...custom,
          traits: { ...custom.traits },
        };
        for (const layer of layers) {
          if (!customItem.traits[layer.name]) {
            const available = getTraitsFromTraitStore(traitStore, layer);
            const picked = getRandomTrait(available.length > 0 ? available : layer.traits);
            if (picked) {
              customItem.traits[layer.name] = {
                trait_type: layer.name,
                value: picked.name,
                image: picked.data,
                excludeFromMetadata: layer.excludeFromMetadata,
                layerId: layer.id,
                traitId: picked.id,
              };
            }
          }
        }
        items.push(customItem);
        existingFingerprints.add(getFingerprint(customItem.traits));
      }
    }

    // 2. Generate random items iteratively (never recursive, preventing stack overflow)
    let consecutiveFails = 0;
    for (let i = items.length; i < size; i++) {
      if (i % 50 === 0) {
        // Yield to event loop to keep the UI smooth and prevent freezing
        await new Promise((r) => setTimeout(r, 0));
      }

      let foundUnique = false;
      let previewItem: PreviewItemT | null = null;
      const MAX_ATTEMPTS = 500;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidate: PreviewItemT = {
          index: i + 1,
          traits: {},
          rating: 0,
          ranking: 0,
          id: uuid(),
        };

        for (let j = 0; j < layers.length; j++) {
          const layer = layers[j];
          let availableTraits: TraitT[] = [];

          // Try traitStore pool first to respect rarity counts.
          // If after 5 attempts it collides, draw from the full valid trait pool for that layer.
          if (attempt < 5) {
            availableTraits = getTraitsFromTraitStore(traitStore, layer);
          }
          if (availableTraits.length === 0) {
            availableTraits = layer.traits.filter(
              (t) => !t.sameAs && t.excludeTraitFromRandomGenerations !== true
            );
          }

          const trait = getRandomTrait(availableTraits.length > 0 ? availableTraits : layer.traits);
          if (trait) {
            candidate.traits[layer.name] = {
              trait_type: layer.name,
              value: trait.name,
              image: trait.data,
              excludeFromMetadata: layer.excludeFromMetadata,
              layerId: layer.id,
              traitId: trait.id,
            };
          }
        }

        let processed = handleForceTraits(candidate, layers);
        processed = handleBlockTraits(processed, layers);

        const fp = getFingerprint(processed.traits);
        if (!existingFingerprints.has(fp)) {
          foundUnique = true;
          previewItem = processed;
          existingFingerprints.add(fp);

          // Deduct from traitStore pool
          Object.keys(processed.traits).forEach((key) => {
            const trait = processed.traits[key];
            if (traitStore[key]) {
              const traitIndex = traitStore[key].findIndex((f) => f === trait.value);
              if (traitIndex !== -1) traitStore[key].splice(traitIndex, 1);
            }
          });

          break;
        }
      }

      if (foundUnique && previewItem) {
        previewItem.index = i + 1;
        items.push(previewItem);
        consecutiveFails = 0;
      } else {
        consecutiveFails++;
        if (consecutiveFails >= 15) {
          // Reached theoretical maximum combinations
          console.warn(`Reached maximum possible unique combinations at ${items.length} items.`);
          break;
        }
      }
    }

    // Renumber to ensure strictly sequential 1..N indices
    items.forEach((item, index) => {
      item.index = index + 1;
    });

    addRatings(items, layers);
    addRankings(items);

    form.setValue('previewItems', items, { shouldDirty: true });
    resetOriginalProject();
    setGenerateIsLoading(false);

    if (items.length < size) {
      toast.warn(
        `Generated ${items.length} unique items. You have reached the maximum unique combinations possible with your current traits and rules.`,
        { autoClose: 6000 }
      );
    } else {
      toast.success(`Successfully generated all ${items.length} items!`);
    }
  };

  const autofillRarity = (layerIndex: number) => {
    const currentLayers = form.getValues('layers');
    const layer = currentLayers[layerIndex];
    if (!layer || !layer.traits || layer.traits.length === 0) return;

    const count = layer.traits.length;
    const baseRarity = Math.floor((100 / count) * 100) / 100;
    const remainder = Math.round((100 - baseRarity * count) * 100) / 100;

    const updatedLayers = currentLayers.map((l, lIdx) => {
      if (lIdx !== layerIndex) return l;
      return {
        ...l,
        traits: l.traits.map((t, tIdx) => ({
          ...t,
          rarityType: RarityType.PERCENT,
          rarity: tIdx === 0 ? Math.round((baseRarity + remainder) * 100) / 100 : baseRarity,
        })),
      };
    });

    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
    toast.success('Rarity autofilled (100% total)');
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
        const cleaned = sanitizeProject(projects[0]);
        form.reset(cleaned);
        setOriginalProject(cleaned);
        setActiveLayer(cleaned.layers[0]?.id || '');
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
        resetProject, formatTrait, deleteTrait, deleteLayer, moveLayer,
        generatePreviewItems, autofillRarity, filterPreviewItems,
        addCustom, deleteCustom, downloadBackup, resetOriginalProject,
        purgeDeletedTraitAssets, addTraitRule, deleteTraitRule,
        addLayerRule, deleteLayerRule, updateTraitName,
        updatePreviewItemTraitName, updatePreviewItemTrait, updateCustomTraitName,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};


