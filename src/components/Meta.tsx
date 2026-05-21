import { useEffect } from "react";

interface MetaProps {
  title?: string;
  description?: string;
  image?: string;
}

export function Meta({ title, description, image }: MetaProps) {
  useEffect(() => {
    const baseTitle = "wen.tools";
    const fullTitle = title ? `${title} | ${baseTitle}` : `${baseTitle} | The Definitive Algorand Utility Suite`;
    const fullDesc = description || "The definitive power-user suite for Algorand. High-performance tools for mass-minting (ARC-3/19/69), mass-airdrops, P2P atomic swaps, supply chain provenance (ANCHOR), decentralized hosting (WEN.DEPLOY), post-quantum security, and x402 on-chain agentic payments.";
    
    const defaultImage = "https://wen.tools/banner-large.png";
    let fullImage = defaultImage;
    if (image) {
      if (image.startsWith("http://") || image.startsWith("https://")) {
        fullImage = image;
      } else {
        const cleanedPath = image.startsWith("/") ? image.slice(1) : image;
        fullImage = `https://wen.tools/${cleanedPath}`;
      }
    }

    document.title = fullTitle;

    const updateTag = (selector: string, content: string) => {
      const tag = document.querySelector(selector);
      if (tag) {
        tag.setAttribute("content", content);
      } else {
        const isMetaName = selector.includes('name="');
        const match = selector.match(/["']([^"']+)["']/);
        if (match) {
          const attrValue = match[1];
          const newTag = document.createElement("meta");
          if (isMetaName) {
            newTag.setAttribute("name", attrValue);
          } else {
            newTag.setAttribute("property", attrValue);
          }
          newTag.setAttribute("content", content);
          document.head.appendChild(newTag);
        }
      }
    };

    updateTag('meta[name="description"]', fullDesc);
    updateTag('meta[property="og:title"]', fullTitle);
    updateTag('meta[property="og:description"]', fullDesc);
    updateTag('meta[property="og:url"]', window.location.href);
    updateTag('meta[property="og:image"]', fullImage);
    
    updateTag('meta[name="twitter:title"]', fullTitle);
    updateTag('meta[name="twitter:description"]', fullDesc);
    updateTag('meta[name="twitter:url"]', window.location.href);
    updateTag('meta[name="twitter:image"]', fullImage);
  }, [title, description, image]);

  return null;
}
