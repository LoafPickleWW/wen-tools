import { RarityType, LayerT, PreviewItemT, TraitT, ProjectT } from './WenPadTypes';


export function calculateNftRating(nft: any, allNfts: any[]) {
  const rarityScore = getTraitRarityScore(nft, allNfts);
  return Math.round(rarityScore);
}

function getTraitRarityScore(nft: any, allNfts: any[]) {
  if (!nft?.metadata?.properties || Object.keys(nft.metadata.properties).length === 0) return 0;

  const total = allNfts.length;
  const traitFrequencies = getTraitFrequencies(allNfts);
  const rarityScore = Object.entries(nft.metadata.properties).reduce((acc, [trait, value]) => {
    const traitFrequency = traitFrequencies[`${trait}:${value}`];
    const rarity = 1 / (traitFrequency / total);
    return acc + rarity;
  }, 0);
  return rarityScore;
}

function getTraitFrequencies(allNfts: any[]) {
  const formattedItems = allNfts.map((c) => {
    if (!c.metadata?.properties) {
      return {};
    }
    return {
      ...c.metadata?.properties,
    };
  });

  const traitFrequencies: any = {};
  formattedItems.forEach((nft) => {
    Object.entries(nft).forEach(([trait, value]) => {
      traitFrequencies[`${trait}:${value}`] = (traitFrequencies[`${trait}:${value}`] || 0) + 1;
    });
  });
  return traitFrequencies;
}

export function addRatings(items: PreviewItemT[], allLayers: LayerT[]) {
  const formattedItems = items.map((item) => {
    const formattedItem = {
      metadata: {
        properties: {} as any,
      },
    };
    Object.values(item.traits).forEach((trait) => {
      if (trait.excludeFromMetadata) return;
      const layer = allLayers.find((l) => l.id === trait.layerId);
      const traitDetails = layer?.traits?.find((t) => t.name === trait.value);
      const sameAs = traitDetails?.sameAs;
      const sameAsDetails = layer?.traits?.find((t) => t.id === sameAs);
      if (sameAsDetails) {

        formattedItem.metadata.properties[trait.trait_type] = sameAsDetails.name;
      } else {

        formattedItem.metadata.properties[trait.trait_type] = trait.value;
      }
    });
    return formattedItem;
  });

  items.forEach((item, index) => {
    const rating = calculateNftRating(formattedItems[index], formattedItems);
    item.rating = rating;
  });
}

export function addRankings(items: PreviewItemT[]) {
  const sortedItems = [...items].sort((a, b) => b.rating - a.rating);
  sortedItems.forEach((item, index) => {
    item.ranking = index + 1;
  });
}

export function getTraitsFromTraitStore(traitStore: { [key: string]: string[] }, layer: LayerT) {
  const availableTraitNames = traitStore[layer.name] || [];
  const validTraits = layer.traits.filter((t) => !t.sameAs && t.excludeTraitFromRandomGenerations !== true);
  if (availableTraitNames.length === 0) {
    return validTraits;
  }
  const availableTraits = availableTraitNames
    .map((name) => layer.traits.find((f) => f.name === name)!)
    .filter(Boolean);
  return availableTraits.length > 0 ? availableTraits : validTraits;
}

export function createTraitStore(layers: LayerT[], size: number) {
  const traitStore: { [key: string]: string[] } = {};

  for (const layer of layers) {
    const availableTraits = layer.traits.filter((trait) => !trait.sameAs && trait.excludeTraitFromRandomGenerations !== true);
    if (availableTraits.length === 0) {
      traitStore[layer.name] = [];
      continue;
    }

    const traitRarityArray: string[] = [];
    const totalRarity = availableTraits.reduce((acc, t) => acc + (t.rarity || 0), 0);

    for (const trait of availableTraits) {
      const traitRarity = trait.rarity || 0;
      if (trait.rarityType === RarityType.PERCENT) {
        const effectivePercent = totalRarity === 0 ? (100 / availableTraits.length) : traitRarity;
        const count = Math.max(1, Math.round(size * (effectivePercent / 100)));
        for (let i = 0; i < count; i++) {
          traitRarityArray.push(trait.name);
        }
      } else {
        const count = totalRarity === 0 ? Math.max(1, Math.ceil(size / availableTraits.length)) : Math.max(1, Math.round(traitRarity));
        traitRarityArray.push(...Array(count).fill(trait.name));
      }
    }

    while (traitRarityArray.length < size && availableTraits.length > 0) {
      const randomTrait = availableTraits[Math.floor(Math.random() * availableTraits.length)];
      traitRarityArray.push(randomTrait.name);
    }

    traitStore[layer.name] = traitRarityArray;
  }
  return traitStore;
}

export function getRandomTrait(traits: TraitT[]) {
  const trait = traits[Math.floor(Math.random() * traits.length)];
  return trait;
}

export function handleForceTraits(previewItem: PreviewItemT, layers: LayerT[]) {
  Object.values(previewItem.traits).forEach((trait) => {
    const layer = layers.find((f) => f.name === trait.trait_type || f.id === trait.layerId);
    const traitDetails = layer?.traits.find((f) => f.name === trait.value || f.id === trait.traitId);
    const traitRules = traitDetails?.rules || [];
    for (const rule of traitRules) {
      const ruleLayerDetails = layers.find((f) => f.id === rule.layer || f.name === rule.layer);
      const ruleTraitDetails = ruleLayerDetails?.traits.find((f) => f.id === rule.trait || f.name === rule.trait);
      if (!ruleLayerDetails || !ruleTraitDetails) continue;
      if (rule.type === 'force') {
        previewItem.traits[ruleLayerDetails.name] = {
          trait_type: ruleLayerDetails.name,
          value: ruleTraitDetails.name,
          image: ruleTraitDetails.data,
          excludeFromMetadata: ruleLayerDetails.excludeFromMetadata,
          layerId: ruleLayerDetails.id,
          traitId: ruleTraitDetails.id,
        };
      }
    }
  });

  return previewItem;
}

export function handleBlockTraits(previewItem: PreviewItemT, layers: LayerT[]) {
  Object.values(previewItem.traits).forEach((trait) => {
    const layer = layers.find((f) => f.name === trait.trait_type || f.id === trait.layerId);
    const traitDetails = layer?.traits.find((f) => f.name === trait.value || f.id === trait.traitId);
    const traitRules = traitDetails?.rules || [];
    for (const rule of traitRules) {
      const ruleLayerDetails = layers.find((f) => f.id === rule.layer || f.name === rule.layer);
      const ruleTraitDetails = ruleLayerDetails?.traits.find((f) => f.id === rule.trait || f.name === rule.trait);
      if (!ruleLayerDetails || !ruleTraitDetails) continue;
      if (rule.type === 'block') {
        const targetLayer = layers.find((f) => f.name === ruleLayerDetails.name || f.id === ruleLayerDetails.id);
        const hasTargetTrait = Object.values(previewItem.traits).find(
          (f) => (f.trait_type === targetLayer?.name || f.layerId === targetLayer?.id) &&
                 (f.value === ruleTraitDetails.name || f.traitId === ruleTraitDetails.id)
        );
        if (hasTargetTrait) {
          const availableTraits = ruleLayerDetails.traits
            .filter((t) => !t.sameAs && t.excludeTraitFromRandomGenerations !== true)
            .filter((f) => f.name !== ruleTraitDetails.name && f.id !== ruleTraitDetails.id);
          const newTrait = getRandomTrait(availableTraits);
          if (newTrait) {
            previewItem.traits[ruleLayerDetails.name] = {
              trait_type: ruleLayerDetails.name,
              value: newTrait.name,
              image: newTrait.data,
              excludeFromMetadata: ruleLayerDetails.excludeFromMetadata,
              layerId: ruleLayerDetails.id,
              traitId: newTrait.id,
            };
          }
        }
      }
    }
  });

  return previewItem;
}

export const renderPreviewToBlob = async (
  item: PreviewItemT,
  layers: LayerT[],
  width?: number,
  height?: number
): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = width || 1000;
  canvas.height = height || 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas 2d context');

  let traitsToDraw: any[] = [];
  if (layers && layers.length > 0) {
    traitsToDraw = layers
      .map((layer) => item.traits[layer.name]?.image)
      .filter(Boolean);
  } else {
    traitsToDraw = Object.values(item.traits)
      .filter((t) => t.image)
      .map((t) => t.image);
  }

  for (const traitData of traitsToDraw) {
    try {
      const img = await loadImage(traitData);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      console.warn('Error loading trait image for export:', e);
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate image blob'));
    }, 'image/png');
  });
};

export const loadImage = (src: any, imageCache?: any): Promise<HTMLImageElement> => {
  if (!src) return Promise.reject(new Error('No image source provided'));

  if (imageCache && imageCache.has(src)) {
    return Promise.resolve(imageCache.get(src));
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrlToRevoke: string | null = null;

    try {
      if (typeof src === 'string') {
        img.src = src;
      } else if (src instanceof Blob) {
        objectUrlToRevoke = URL.createObjectURL(src);
        img.src = objectUrlToRevoke;
      } else if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) {
        const blob = new Blob([src as BlobPart], { type: 'image/png' });
        objectUrlToRevoke = URL.createObjectURL(blob);
        img.src = objectUrlToRevoke;
      } else if (src && typeof src === 'object' && src.data) {
        const data = src.data;
        if (data instanceof Blob) {
          objectUrlToRevoke = URL.createObjectURL(data);
          img.src = objectUrlToRevoke;
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          const blob = new Blob([data as BlobPart], { type: src.type || 'image/png' });
          objectUrlToRevoke = URL.createObjectURL(blob);
          img.src = objectUrlToRevoke;
        } else if (typeof data === 'string') {
          img.src = data;
        } else {
          const blob = new Blob([data as BlobPart], { type: src.type || 'image/png' });
          objectUrlToRevoke = URL.createObjectURL(blob);
          img.src = objectUrlToRevoke;
        }
      } else {
        const blob = new Blob([src as BlobPart], { type: 'image/png' });
        objectUrlToRevoke = URL.createObjectURL(blob);
        img.src = objectUrlToRevoke;
      }
    } catch (err) {
      return reject(err);
    }

    img.onload = () => {
      if (imageCache) {
        imageCache.set(src, img);
      }
      resolve(img);
    };

    img.onerror = (err) => {
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
      reject(err);
    };
  });
};

export function purgeInvalidPreviewItems(project: ProjectT): {
  project: ProjectT;
  purgedCount: number;
} {
  if (!project || !project.layers) return { project, purgedCount: 0 };

  const validTraitsByLayer = new Map<string, Set<string>>();
  const validTraitIds = new Set<string>();

  for (const layer of project.layers) {
    const names = new Set<string>();
    for (const trait of layer.traits || []) {
      names.add(trait.name);
      validTraitIds.add(trait.id);
    }
    validTraitsByLayer.set(layer.name, names);
  }

  const initialItemsCount = (project.previewItems || []).length;
  const validPreviewItems: PreviewItemT[] = [];

  for (const item of project.previewItems || []) {
    if (!item.traits || Object.keys(item.traits).length === 0) continue;

    let hasDeletedTrait = false;
    const cleanedTraits: typeof item.traits = {};

    for (const [layerName, traitObj] of Object.entries(item.traits)) {
      const validNames = validTraitsByLayer.get(layerName);
      // If the layer or the trait value no longer exists, asset was minted with deleted traits
      if (!validNames || !validNames.has(traitObj.value)) {
        hasDeletedTrait = true;
        break;
      }
      cleanedTraits[layerName] = traitObj;
    }

    if (hasDeletedTrait) continue;
    if (Object.keys(cleanedTraits).length === 0) continue;

    // Asset must have at least one layer image matching current layers
    const hasAtLeastOneImage = project.layers.some(
      (layer) => Boolean(cleanedTraits[layer.name]?.image)
    );
    if (!hasAtLeastOneImage) continue;

    validPreviewItems.push({
      ...item,
      traits: cleanedTraits,
    });
  }

  // Renumber remaining items sequentially starting from 1
  validPreviewItems.forEach((item, index) => {
    item.index = index + 1;
  });

  // Re-calculate ratings and rankings for remaining items
  if (validPreviewItems.length > 0) {
    addRatings(validPreviewItems, project.layers);
    addRankings(validPreviewItems);
  }

  // Sanitize customs as well
  const validCustoms: PreviewItemT[] = [];
  for (const custom of project.customs || []) {
    if (!custom.traits || Object.keys(custom.traits).length === 0) continue;
    let hasDeletedTrait = false;
    const cleanedTraits: typeof custom.traits = {};
    for (const [layerName, traitObj] of Object.entries(custom.traits)) {
      const validNames = validTraitsByLayer.get(layerName);
      if (!validNames || !validNames.has(traitObj.value)) {
        hasDeletedTrait = true;
        break;
      }
      cleanedTraits[layerName] = traitObj;
    }
    if (hasDeletedTrait || Object.keys(cleanedTraits).length === 0) continue;
    validCustoms.push({
      ...custom,
      traits: cleanedTraits,
    });
  }

  const purgedCount = initialItemsCount - validPreviewItems.length;

  const updatedProject: ProjectT = {
    ...project,
    customs: validCustoms,
    previewItems: validPreviewItems,
    size: validPreviewItems.length > 0 ? validPreviewItems.length : project.size,
  };

  return {
    project: updatedProject,
    purgedCount,
  };
}

export function sanitizeProject(project: ProjectT): ProjectT {
  if (!project || !project.layers) return project;

  const validTraitIds = new Set<string>();
  for (const layer of project.layers) {
    for (const trait of layer.traits || []) {
      validTraitIds.add(trait.id);
    }
  }

  // Sanitize layers: clean orphaned sameAs and rules
  const sanitizedLayers = project.layers.map((layer) => ({
    ...layer,
    traits: (layer.traits || []).map((trait) => ({
      ...trait,
      sameAs: validTraitIds.has(trait.sameAs || '') ? trait.sameAs : '',
      rules: (trait.rules || []).filter((rule) => validTraitIds.has(rule.trait)),
    })),
  }));

  const { project: cleanedProject } = purgeInvalidPreviewItems({
    ...project,
    layers: sanitizedLayers,
  });

  return cleanedProject;
}

export function buildItemMetadata(
  item: PreviewItemT,
  project: ProjectT,
  imageFileName?: string
) {
  const safeProjectName = (project.name || 'NFT').replace(/[^a-zA-Z0-9_-]/g, '_');
  const imgName = imageFileName || `${String(item.index).padStart(4, '0')}_${safeProjectName}.png`;

  const properties: { [key: string]: string } = {};
  const attributes: { trait_type: string; value: string }[] = [];

  const allLayers = project.layers || [];
  const layerOrderMap = new Map<string, number>();
  allLayers.forEach((layer, idx) => {
    layerOrderMap.set(layer.name, idx);
    layerOrderMap.set(layer.id, idx);
  });

  const sortedTraitEntries = Object.entries(item.traits || {}).sort(([aName, aTrait], [bName, bTrait]) => {
    const aIdx = layerOrderMap.has(aTrait.layerId)
      ? layerOrderMap.get(aTrait.layerId)!
      : (layerOrderMap.has(aName) ? layerOrderMap.get(aName)! : 999);
    const bIdx = layerOrderMap.has(bTrait.layerId)
      ? layerOrderMap.get(bTrait.layerId)!
      : (layerOrderMap.has(bName) ? layerOrderMap.get(bName)! : 999);
    return aIdx - bIdx;
  });

  for (const [layerName, trait] of sortedTraitEntries) {
    if (trait.excludeFromMetadata) continue;

    const layer = allLayers.find((l) => l.id === trait.layerId || l.name === layerName);
    if (layer?.excludeFromMetadata) continue;

    const traitDetails = layer?.traits?.find((t) => t.name === trait.value || t.id === trait.traitId);
    let finalValue = trait.value;
    if (traitDetails?.sameAs) {
      const sameAsDetails = layer?.traits?.find((t) => t.id === traitDetails.sameAs);
      if (sameAsDetails) {
        finalValue = sameAsDetails.name;
      }
    }

    const traitType = trait.trait_type || layer?.name || layerName;
    properties[traitType] = finalValue;
    attributes.push({
      trait_type: traitType,
      value: finalValue,
    });
  }

  return {
    name: `${project.name ? project.name + ' ' : ''}#${item.index}`,
    description: project.description || '',
    image: imgName,
    external_url: project.website || '',
    edition: item.index,
    date: Date.now(),
    attributes,
    properties,
    ranking: item.ranking,
    rarity_score: item.rating,
    compiler: 'Wen Tools Generator',
  };
}

export function buildCollectionTraitSummary(items: PreviewItemT[], project: ProjectT) {
  const total = items.length;
  const layersSummary: {
    [layerName: string]: {
      [traitValue: string]: {
        count: number;
        percentage: string;
      };
    };
  } = {};

  items.forEach((item) => {
    Object.entries(item.traits || {}).forEach(([layerName, trait]) => {
      if (trait.excludeFromMetadata) return;
      if (!layersSummary[layerName]) {
        layersSummary[layerName] = {};
      }
      const val = trait.value;
      if (!layersSummary[layerName][val]) {
        layersSummary[layerName][val] = { count: 0, percentage: '0%' };
      }
      layersSummary[layerName][val].count++;
    });
  });

  // Calculate percentages
  Object.keys(layersSummary).forEach((layerName) => {
    Object.keys(layersSummary[layerName]).forEach((traitVal) => {
      const count = layersSummary[layerName][traitVal].count;
      layersSummary[layerName][traitVal].percentage = total > 0 ? `${((count / total) * 100).toFixed(2)}%` : '0%';
    });
  });

  return {
    collection_name: project.name || 'NFT Collection',
    description: project.description || '',
    total_supply: total,
    generated_at: new Date().toISOString(),
    traits_distribution: layersSummary,
  };
}

