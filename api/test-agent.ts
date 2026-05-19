import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * POST /api/test-agent
 *
 * Proxies HTTP requests from the frontend client to registered agent endpoints.
 * This bypasses browser CORS limitations since the request is executed from
 * the server side. Handles forwarding standard headers, including x402
 * protocol headers.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Support CORS preflight options
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Payment, PAYMENT-SIGNATURE");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { endpointUrl, method = "GET", headers = {}, body } = req.body;

  if (!endpointUrl) {
    return res.status(400).json({ error: "endpointUrl is required" });
  }

  try {
    const fetchHeaders: Record<string, string> = {
      ...headers,
      "Accept": "application/json",
    };

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: fetchHeaders,
    };

    if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
      if (!fetchHeaders["Content-Type"]) {
        fetchHeaders["Content-Type"] = "application/json";
      }
    }

    const targetRes = await fetch(endpointUrl, fetchOptions);
    const contentType = targetRes.headers.get("content-type") || "";

    // Set CORS headers for our frontend client
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "payment-required, payment-response, x-payment-response, PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE");

    // Forward x402 specific and other useful headers
    const headersToForward = [
      "payment-required",
      "payment-response",
      "x-payment-response",
      "PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "X-PAYMENT-RESPONSE",
      "content-type",
    ];

    for (const h of headersToForward) {
      const val = targetRes.headers.get(h);
      if (val) {
        res.setHeader(h, val);
      }
    }

    // Read and return the body
    if (contentType.includes("application/json")) {
      const json = await targetRes.json().catch(() => ({}));
      return res.status(targetRes.status).json(json);
    } else {
      const text = await targetRes.text().catch(() => "");
      return res.status(targetRes.status).send(text);
    }
  } catch (err: any) {
    console.error("Proxy agent error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(502).json({
      error: "Failed to connect to agent endpoint",
      message: err.message,
    });
  }
}
