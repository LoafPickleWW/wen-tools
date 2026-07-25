import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Support CORS preflight options
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, x-x402-payment-payload");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const headers: Record<string, string> = {};
    if (req.headers["x-api-key"]) {
      headers["x-api-key"] = req.headers["x-api-key"] as string;
    }
    if (req.headers["x-x402-payment-payload"]) {
      headers["x-x402-payment-payload"] = req.headers["x-x402-payment-payload"] as string;
    }
    if (req.headers["content-type"]) {
      headers["content-type"] = req.headers["content-type"] as string;
    }

    // Call AlgoFile API dynamically forwarding the request subpath
    const subpath = req.url ? req.url.replace(/^\/api\/algofile/, "") : "";
    const targetUrl = `https://api.algofile.io/api/algofile${subpath || "/upload"}`;
    
    let bodyToSend: any = req;
    if (req.headers["content-type"]?.includes("application/json")) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      bodyToSend = Buffer.concat(chunks).toString("utf-8");
    }

    const targetRes = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: bodyToSend,
      // @ts-expect-error
      duplex: "half",
    });

    // Expose headers for CORS preflight
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "x-x402-payment-payload");

    // Send status and parse response
    const targetStatus = targetRes.status;
    const bodyText = await targetRes.text();
    
    // Set response headers
    res.status(targetStatus);
    res.setHeader("Content-Type", targetRes.headers.get("content-type") || "application/json");
    
    return res.send(bodyText);
  } catch (err: any) {
    console.error("AlgoFile proxy error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(502).json({
      error: "Failed to connect to AlgoFile API via proxy",
      message: err.message,
    });
  }
}
