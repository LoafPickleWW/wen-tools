import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "redis";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const url = process.env.KV_URL || process.env.REDIS_URL || process.env.STORAGE_URL || "";

  if (req.method === "GET") {
    const appId = req.query.appId as string;
    if (!appId) return res.status(400).json({ error: "appId query parameter required" });

    if (!url) {
      return res.status(404).json({ error: "Storage not configured" });
    }

    const client = createClient({ url });
    try {
      await client.connect();
      const raw = await client.get(`wenpad:collection:${appId}`);
      await client.disconnect();
      if (!raw) return res.status(404).json({ error: "Collection not found" });
      return res.status(200).json(JSON.parse(raw));
    } catch (err: any) {
      try {
        await client.disconnect();
      } catch {}
      return res.status(500).json({ error: err?.message || "Failed to fetch collection" });
    }
  }

  if (req.method === "POST") {
    const { appId, collectionJson } = req.body || {};
    if (!appId || !collectionJson) {
      return res.status(400).json({ error: "appId and collectionJson required" });
    }

    if (!url) {
      return res.status(200).json({ ok: true, note: "Storage not configured in environment" });
    }

    const client = createClient({ url });
    try {
      await client.connect();
      await client.set(`wenpad:collection:${appId}`, JSON.stringify(collectionJson));
      await client.disconnect();
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      try {
        await client.disconnect();
      } catch {}
      return res.status(500).json({ error: err?.message || "Failed to store collection" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
