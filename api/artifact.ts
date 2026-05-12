import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, token } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing url" });
  }

  // Only allow GitHub artifact URLs
  if (!url.startsWith("https://api.github.com/") && !url.startsWith("https://pipelines.actions.githubusercontent.com/")) {
    return res.status(403).json({ error: "URL not permitted" });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "wen-tools-proxy/1.0",
      },
      redirect: "follow", // follow the redirect to S3 signed URL server-side
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `GitHub returned ${upstream.status}` });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    const reader = upstream.body?.getReader();
    if (!reader) return res.status(502).json({ error: "No response body" });

    res.status(200);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err: any) {
    console.error("Artifact proxy error:", err);
    return res.status(500).json({ error: "Proxy fetch failed" });
  }
}
