import { useEffect } from "react";

interface MetaProps {
  title?: string;
  description?: string;
}

export function Meta({ title, description }: MetaProps) {
  useEffect(() => {
    const baseTitle = "wen.tools";
    const fullTitle = title ? `${title} | ${baseTitle}` : `${baseTitle} | The Definitive Algorand Utility Suite`;
    document.title = fullTitle;

    // Update Meta Description
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        description || "The definitive power-user suite for Algorand: Mass-minting, airdrops, ANCHOR supply chain security, WEN.DEPLOY, and post-quantum resilience."
      );
    }

    // Update Open Graph Title
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute("content", fullTitle);
    }
  }, [title, description]);

  return null;
}
