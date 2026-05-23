import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Image } from "../types";
import { trackEvent } from "../utils";

const CarouselComponent = ({ images }: { images: Image[] }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  //interval to change the image every 3 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) =>
        prevIndex === images.length - 1 ? 0 : prevIndex + 1
      );
    }, 9100);
    return () => clearInterval(interval);
  }, [currentIndex, images.length]);

  return (
    <div className="mx-auto my-2 md:my-4">
      <div>
        {images.map((image, index) => {
          const isExternal = image.url.startsWith("http");
          const imgElement = (
            <img
              src={image.path}
              alt={image.path}
              className={`${
                index === currentIndex ? "block" : "hidden"
              } h-24 md:h-28 mx-auto rounded-md`}
            />
          );

          return isExternal ? (
            <a
              href={image.url}
              target="_blank"
              rel="noreferrer"
              key={index}
              onClick={() => trackEvent("carousel_click", "home", image.path)}
            >
              {imgElement}
            </a>
          ) : (
            <Link
              to={image.url}
              key={index}
              onClick={() => trackEvent("carousel_click", "home", image.path)}
            >
              {imgElement}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default CarouselComponent;
