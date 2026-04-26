import React, { useCallback, useEffect, useState } from 'react';
import { MdLayers, MdLoop } from 'react-icons/md';
import { PreviewItemT } from './WenPadTypes';
import { loadImage } from './ProjectUtils';

type Props = {
  item: PreviewItemT;
  width: number;
  height: number;
};

const imageCache = new Map();

const PreviewImage = ({ item, width, height }: Props) => {
  const [image, setImage] = useState('');
  const [loading, setLoading] = useState(true);

  const drawImage = useCallback(async () => {
    setLoading(true);
    setImage('');
    const traits = Object.values(item.traits)
      .filter((trait) => trait.image)
      .map((trait) => trait.image);
    
    if (traits.length === 0) {
      setLoading(false);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    for (const trait of traits) {
      try {
        const traitImage: any = await loadImage(trait, imageCache);
        ctx.drawImage(traitImage, 0, 0, width, height);
      } catch (error) {
        console.error('Error loading trait image:', error);
      }
    }

    const dataUrl = canvas.toDataURL('image/webp');
    setImage(dataUrl);
    setLoading(false);
  }, [item, width, height]);

  useEffect(() => {
    drawImage();
  }, [drawImage]);

  return (
    <div className="relative w-full h-full bg-gray-800 rounded-lg overflow-hidden min-h-[300px] flex items-center justify-center">
      {!image && !loading && (
        <div className='flex flex-col items-center justify-center text-white/50'>
          <MdLayers size={48} />
          <span className='mt-2 text-sm font-semibold'>No traits added</span>
        </div>
      )}

      {loading && (
        <div className='absolute inset-0 z-20 flex items-center justify-center bg-gray-800/50'>
          <MdLoop size={48} className='animate-spin text-primary-orange' />
        </div>
      )}

      {image && (
        <img 
          className='absolute inset-0 z-10 h-full w-full object-contain' 
          src={image} 
          alt={'preview'} 
          loading='lazy' 
        />
      )}
    </div>
  );
};

export default PreviewImage;
