// src/Carousel.js
import React, { useState } from "react";
import { Image } from "../types";

const CarouselComponent = ({ images }: { images: Image[] }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  //interval to change the image every 3 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) =>
        prevIndex === images.length - 1 ? 0 : prevIndex + 1
      );
    }, 6000);
    return () => clearInterval(interval);
  }, [currentIndex, images.length]);

  return (
    <div className="mx-auto my-2 md:my-4">
      <div>
        {images.map((image, index) => (
          <a href={image.url} target="_blank" rel="noreferrer">
            <img
              key={index}
              src={image.path}
              alt={image.path}
              className={`${
                index === currentIndex ? "block" : "hidden"
              } h-24 md:h-28 mx-auto rounded-md`}
            />
          </a>
        ))} 
      </div>
    </div>
  );
};

export default CarouselComponent;
