import { useEffect } from "react";

interface MetaProps {
  title?: string;
  description?: string;
}

export function Meta({ title, description }: MetaProps) {
  useEffect(() => {
    const baseTitle = "wen.tools";
    const fullTitle = title ? `${title} | ${baseTitle}` : `${baseTitle} | The Definitive Algorand Utility Suite`;
    const fullDesc = description || "The definitive power-user suite for Algorand. High-performance tools for mass-minting (ARC-3/19/69), mass-airdrops, P2P atomic swaps, supply chain provenance (ANCHOR), decentralized hosting (WEN.DEPLOY), post-quantum security, and x402 on-chain agentic payments.";
    
    document.title = fullTitle;

    const updateTag = (selector: string, content: string) => {
      const tag = document.querySelector(selector);
      if (tag) tag.setAttribute("content", content);
    };

    updateTag('meta[name="description"]', fullDesc);
    updateTag('meta[property="og:title"]', fullTitle);
    updateTag('meta[property="og:description"]', fullDesc);
    updateTag('meta[property="og:url"]', window.location.href);
    updateTag('meta[property="twitter:title"]', fullTitle);
    updateTag('meta[property="twitter:description"]', fullDesc);
    updateTag('meta[property="twitter:url"]', window.location.href);
  }, [title, description]);

  return null;
}
