export enum RarityType {
  NUMBER = 'number',
  PERCENT = 'percent',
}

export type ProjectT = {
  id?: number;
  owner?: string;
  name: string;
  unitName: string;
  description: string;
  website: string;
  size: number;
  imageWidth: number;
  imageHeight: number;
  layers: LayerT[];
  customs: PreviewItemT[];
  previewItems: PreviewItemT[];
};

export type LayerT = {
  id: string;
  name: string;
  traits: TraitT[];
  sameAs?: string;
  excludeFromMetadata: boolean;
  rules?: RuleT[];
};

export type TraitT = {
  id: string;
  name: string;
  size: number;
  type: string;
  data: any;
  alternatives: any[];
  rarity: number;
  rarityType: RarityType;
  sameAs?: string;
  excludeTraitFromRandomGenerations: boolean;
  rules: RuleT[];
};

export type RuleT = {
  type: 'force' | 'block' | 'block_layer';
  layer: string;
  trait: string;
};

export type PreviewItemT = {
  index: number;
  id: string;
  traits: {
    [key: string]: {
      layerId: string;
      traitId: string;
      trait_type: string;
      value: string;
      image: any;
      excludeFromMetadata: boolean;
    };
  };
  rating: number;
  ranking: number;
};
