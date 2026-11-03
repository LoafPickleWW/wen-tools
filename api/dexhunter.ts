import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isSameOrigin, validateSwapRequest } from "./_lib/dexhunterGuard.js";

const BASE_URL = "https://api-us.dexhunterv3.app";
const TIMEOUT_MS = 15_000;

/**
 * Proxy to DexHunter's swap API so the partner key stays on the server.
 *
 *   GET  -> { configured, tokenId }  (whether swapping is set up, and which asset it buys)
 *   POST -> { step: "estimate" | "build" | "sign", ... }
 *
 * Env (server only, never prefixed VITE_):
 *   DEXHUNTER_PARTNER_ID  the partner key, sent as X-Partner-Id
 *   NIGHT_TOKEN_ID        Cardano asset id (policy id + hex asset name) of the official cNIGHT.
 *                         Copy it from Midnight's docs or a block explorer; there is no default.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const partnerId = process.env.DEXHUNTER_PARTNER_ID?.trim();
  const tokenId = process.env.NIGHT_TOKEN_ID?.trim();
  const configured = !!partnerId && !!tokenId;

  if (!isSameOrigin(req.headers.origin, req.headers.host)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (req.method === "GET") {
    return res.status(200).json(configured ? { configured, tokenId } : { configured });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!configured) {
    return res.status(503).json({ error: "Swapping isn't set up on this site yet" });
  }

  let body: unknown = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const checked = validateSwapRequest(body, tokenId!);
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(BASE_URL + checked.path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Partner-Id": partnerId! },
      body: JSON.stringify(checked.payload),
      signal: controller.signal,
    });
    const text = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    if (!upstream.ok) {
      // Pass DexHunter's message along, but never anything that could echo our key
      const message =
        data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string"
          ? (data as { message: string }).message
          : "The swap service returned an error";
      return res.status(upstream.status === 429 ? 429 : 502).json({ error: message });
    }
    if (data === undefined) return res.status(502).json({ error: "The swap service returned an invalid response" });
    return res.status(200).json(data);
  } catch (e) {
    const timedOut = (e as Error)?.name === "AbortError";
    return res.status(504).json({ error: timedOut ? "The swap service timed out" : "Could not reach the swap service" });
  } finally {
    clearTimeout(timer);
  }
}
