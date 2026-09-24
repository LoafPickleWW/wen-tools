import { useCallback, useEffect, useState } from 'react';
import { MdLayers, MdLoop } from 'react-icons/md';
import { PreviewItemT, LayerT } from './WenPadTypes';
import { loadImage } from './ProjectUtils';

type Props = {
  item: PreviewItemT;
  layers?: LayerT[];
  width: number;
  height: number;
};

// Global caches for trait HTMLImageElements and composite preview data URLs
export const traitImageCache = new Map<any, HTMLImageElement>();
export const compositePreviewCache = new Map<string, string>();

export const clearPreviewCaches = () => {
  traitImageCache.clear();
  compositePreviewCache.clear();
};

const PreviewImage = ({ item, layers, width, height }: Props) => {
  const [image, setImage] = useState<string>(() => compositePreviewCache.get(item.id) || '');
  const [loading, setLoading] = useState<boolean>(!compositePreviewCache.has(item.id));

  const drawImage = useCallback(async () => {
    // Check composite cache first
    const cachedUrl = compositePreviewCache.get(item.id);
    if (cachedUrl) {
      setImage(cachedUrl);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Get traits ordered according to layer definitions if layers are provided
    let traits: any[] = [];
    if (layers && layers.length > 0) {
      traits = layers
        .map((layer) => item.traits[layer.name]?.image)
        .filter(Boolean);
    } else {
      traits = Object.values(item.traits)
        .filter((trait) => trait.image)
        .map((trait) => trait.image);
    }

    if (traits.length === 0) {
      setLoading(false);
      return;
    }

    // Scale canvas to preview thumbnail size (max 400px) to prevent memory crashes
    const MAX_THUMB = 400;
    let thumbWidth = width || 1000;
    let thumbHeight = height || 1000;
    if (thumbWidth > MAX_THUMB || thumbHeight > MAX_THUMB) {
      const scale = Math.min(MAX_THUMB / thumbWidth, MAX_THUMB / thumbHeight);
      thumbWidth = Math.round(thumbWidth * scale);
      thumbHeight = Math.round(thumbHeight * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      setLoading(false);
      return;
    }

    try {
      for (const traitData of traits) {
        try {
          const traitImage = await loadImage(traitData, traitImageCache);
          ctx.drawImage(traitImage, 0, 0, thumbWidth, thumbHeight);
        } catch (error) {
          console.warn('Error loading trait image for preview:', error);
        }
      }

      const dataUrl = canvas.toDataURL('image/webp', 0.88);
      compositePreviewCache.set(item.id, dataUrl);
      setImage(dataUrl);
    } catch (err) {
      console.error('Failed to generate preview image data URL:', err);
    } finally {
      setLoading(false);
    }
  }, [item, layers, width, height]);

  useEffect(() => {
    drawImage();
  }, [drawImage]);

  return (
    <div className="relative w-full h-full bg-gray-800 rounded-lg overflow-hidden min-h-[220px] flex items-center justify-center">
      {!image && !loading && (
        <div className="flex flex-col items-center justify-center text-white/50">
          <MdLayers size={40} />
          <span className="mt-2 text-xs font-semibold">No traits added</span>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-800/60 backdrop-blur-xs">
          <MdLoop size={36} className="animate-spin text-primary-orange" />
        </div>
      )}

      {image && (
        <img 
          className="absolute inset-0 z-10 h-full w-full object-contain" 
          src={image} 
          alt={`Preview item #${item.index}`} 
          loading="lazy" 
        />
      )}
    </div>
  );
};

export default PreviewImage;
