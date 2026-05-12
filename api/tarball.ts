import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const repo = (req.query.repo as string) || "LoafPickleWW/wen-tools";
  const ref  = (req.query.ref  as string) || "main";

  // Security: You can add an ALLOWED_OWNERS check here if desired
  
  const githubUrl = `https://api.github.com/repos/${repo}/tarball/${ref}`;
  const userToken = req.headers.authorization;

  try {
    const upstream = await fetch(githubUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "wen-tools-proxy/1.0",
        ...(userToken ? { Authorization: userToken } : {}),
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `GitHub returned ${upstream.status}`,
      });
    }

    const contentType = upstream.headers.get("content-type") || "application/x-gzip";
    res.setHeader("Content-Type", contentType);
    
    // THE MAGIC HEADER: This allows WebContainer to read the data under isolation
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=300");

    // Convert the fetch readable stream to a format Vercel can handle
    const reader = upstream.body?.getReader();
    if (!reader) {
      return res.status(502).json({ error: "No response body from GitHub" });
    }

    res.status(200);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err: any) {
    console.error("Tarball proxy error:", err);
    return res.status(500).json({ error: "Proxy fetch failed" });
  }
}
