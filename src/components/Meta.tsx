import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import SEO_ROUTES from "../seo/routes.json";

/** The production host. Must match the primary domain configured in Vercel. */
const SITE_URL = "https://www.wen.tools";

const DEFAULT_TITLE = "Free Algorand Tools: Mint, Airdrop & Manage ASAs | wen.tools";
const DEFAULT_DESC =
  "Free, open-source Algorand tools. Mass-mint ARC-3/19/69 NFTs, airdrop to thousands of wallets, bulk opt-in and opt-out, P2P atomic swaps and more. No accounts, no platform fees.";

interface RouteSeo {
  title?: string;
  description?: string;
  canonical?: string;
}

interface MetaProps {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  /** Keep this page out of search results (e.g. 404s, private views) */
  noindex?: boolean;
}

const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/**
 * Sets the document head for a page. Entries in src/seo/routes.json take
 * priority so the runtime head always matches the prerendered HTML that
 * scripts/prerender-seo.mjs writes at build time.
 */
export function Meta({ title, description, image, canonical, noindex }: MetaProps) {
  const { pathname } = useLocation();

  useEffect(() => {
    const path = normalize(pathname);
    const table = SEO_ROUTES as Record<string, RouteSeo>;
    const entry = table[path];
    // Alias routes borrow their canonical target's copy (same as the build)
    const route = entry?.canonical
      ? { ...table[entry.canonical], canonical: entry.canonical }
      : entry;

    const fullTitle = route?.title ?? (title ? `${title} | wen.tools` : DEFAULT_TITLE);
    const fullDesc = route?.description ?? description ?? DEFAULT_DESC;

    const defaultImage = `${SITE_URL}/banner-large.png`;
    let fullImage = defaultImage;
    if (image) {
      if (image.startsWith("http://") || image.startsWith("https://")) {
        fullImage = image;
      } else {
        const cleanedPath = image.startsWith("/") ? image.slice(1) : image;
        fullImage = `${SITE_URL}/${cleanedPath}`;
      }
    }

    const canonicalPath = canonical ?? route?.canonical ?? path;
    const canonicalUrl = canonicalPath.startsWith("http")
      ? canonicalPath
      : `${SITE_URL}${canonicalPath === "/" ? "/" : canonicalPath}`;

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
    updateTag('meta[property="og:url"]', canonicalUrl);
    updateTag('meta[property="og:image"]', fullImage);

    updateTag('meta[name="twitter:title"]', fullTitle);
    updateTag('meta[name="twitter:description"]', fullDesc);
    updateTag('meta[name="twitter:url"]', canonicalUrl);
    updateTag('meta[name="twitter:image"]', fullImage);

    updateTag('meta[name="robots"]', noindex ? "noindex, follow" : "index, follow");

    let canonicalTag = document.querySelector('link[rel="canonical"]');
    if (!canonicalTag) {
      canonicalTag = document.createElement("link");
      canonicalTag.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalTag);
    }
    canonicalTag.setAttribute("href", canonicalUrl);
  }, [pathname, title, description, image, canonical, noindex]);

  return null;
}
