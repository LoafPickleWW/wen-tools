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
    const layer = layers.find((f) => f.name === trait.trait_type);
    const traitDetails = layer?.traits.find((f) => f.name === trait.value);
    const traitRules = traitDetails?.rules || [];
    for (const rule of traitRules) {
      const ruleLayerDetails = layers.find((f) => f.id === rule.layer);
      const ruleTraitDetails = ruleLayerDetails?.traits.find((f) => f.id === rule.trait);
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
    const layer = layers.find((f) => f.name === trait.trait_type);
    const traitDetails = layer?.traits.find((f) => f.name === trait.value);
    const traitRules = traitDetails?.rules || [];
    for (const rule of traitRules) {
      const ruleLayerDetails = layers.find((f) => f.id === rule.layer);
      const ruleTraitDetails = ruleLayerDetails?.traits.find((f) => f.id === rule.trait);
      if (!ruleLayerDetails || !ruleTraitDetails) continue;
      if (rule.type === 'block') {
        const targetLayer = layers.find((f) => f.name === ruleLayerDetails.name);
        const hasTargetTrait = Object.values(previewItem.traits).find((f) => f.trait_type === targetLayer?.name && f.value === ruleTraitDetails.name);
        if (hasTargetTrait) {
          const availableTraits = ruleLayerDetails.traits
            .filter((trait) => !trait.sameAs && trait.excludeTraitFromRandomGenerations !== true)
            .filter((f) => f.name !== ruleTraitDetails.name);
          const newTrait = getRandomTrait(availableTraits);
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
  });

  return previewItem;
}

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

export function sanitizeProject(project: ProjectT): ProjectT {
  if (!project || !project.layers) return project;

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

  // 1. Sanitize customs: remove any traits whose layer or trait no longer exists
  const sanitizedCustoms = (project.customs || []).map((custom) => {
    const cleanedTraits: typeof custom.traits = {};
    for (const [layerName, traitObj] of Object.entries(custom.traits || {})) {
      const validNames = validTraitsByLayer.get(layerName);
      if (validNames && validNames.has(traitObj.value)) {
        cleanedTraits[layerName] = traitObj;
      }
    }
    return {
      ...custom,
      traits: cleanedTraits,
    };
  });

  // 2. Sanitize previewItems: remove any traits whose layer or trait no longer exists
  const sanitizedPreviewItems = (project.previewItems || []).map((item) => {
    const cleanedTraits: typeof item.traits = {};
    for (const [layerName, traitObj] of Object.entries(item.traits || {})) {
      const validNames = validTraitsByLayer.get(layerName);
      if (validNames && validNames.has(traitObj.value)) {
        cleanedTraits[layerName] = traitObj;
      }
    }
    return {
      ...item,
      traits: cleanedTraits,
    };
  });

  // 3. Sanitize layers: clean orphaned sameAs and rules
  const sanitizedLayers = project.layers.map((layer) => ({
    ...layer,
    traits: (layer.traits || []).map((trait) => ({
      ...trait,
      sameAs: validTraitIds.has(trait.sameAs || '') ? trait.sameAs : '',
      rules: (trait.rules || []).filter((rule) => validTraitIds.has(rule.trait)),
    })),
  }));

  return {
    ...project,
    layers: sanitizedLayers,
    customs: sanitizedCustoms,
    previewItems: sanitizedPreviewItems,
  };
}
