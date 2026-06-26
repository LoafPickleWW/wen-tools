import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers for local/cross-origin access
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { slug, next, limit = "50" } = req.query;

  if (!slug || typeof slug !== "string") {
    return res.status(400).json({ error: "Collection slug is required" });
  }

  const apiKey = process.env.OPENSEA_API_KEY || process.env.VITE_OPENSEA_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "OpenSea API Key is not configured on the server" });
  }

  try {
    const params = new URLSearchParams({ limit: typeof limit === "string" ? limit : "50" });
    if (next && typeof next === "string") {
      params.append("next", next);
    }

    const openseaUrl = `https://api.opensea.io/api/v2/collection/${slug}/nfts?${params.toString()}`;
    const response = await fetch(openseaUrl, {
      headers: {
        "Accept": "application/json",
        "X-API-KEY": apiKey,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `OpenSea API error: ${errText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
