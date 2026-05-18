import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * GET /api/agents
 *
 * Reads the on-chain agent registry (factory contract boxes → child app global states)
 * and returns a structured agents.json response.
 *
 * Also served at /.well-known/agents.json via vercel.json rewrite.
 */

const FACTORY_APP_IDS: Record<string, number> = {
  mainnet: Number(process.env.FACTORY_APP_ID_MAINNET || 3562772718),
  testnet: Number(process.env.FACTORY_APP_ID_TESTNET || 762783309),
};

const INDEXER_URLS: Record<string, string> = {
  mainnet: "https://mainnet-idx.algonode.cloud",
  testnet: "https://testnet-idx.algonode.cloud",
};

const ALGOD_URLS: Record<string, string> = {
  mainnet: "https://mainnet-api.4160.nodely.dev",
  testnet: "https://testnet-api.4160.nodely.dev",
};

function decodeStateValue(sv: { type: number; bytes?: string; uint?: number }): string | number {
  if (sv.type === 1) {
    return Buffer.from(sv.bytes || "", "base64").toString("utf-8");
  }
  return sv.uint ?? 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const network = (req.query.network as string) || "mainnet";
  const factoryId = FACTORY_APP_IDS[network];

  if (!factoryId) {
    return res.status(200).json({
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      network,
      factory_app_id: 0,
      agents: [],
    });
  }

  const indexerBase = INDEXER_URLS[network];
  const algodBase = ALGOD_URLS[network];

  try {
    // 1. Get all boxes from the factory
    const boxesRes = await fetch(`${indexerBase}/v2/applications/${factoryId}/boxes?limit=100`);
    if (!boxesRes.ok) throw new Error(`Indexer returned ${boxesRes.status}`);
    const boxesData = await boxesRes.json();
    const boxes: Array<{ name: string }> = boxesData.boxes || [];

    // 2. Read each child app's global state
    const agents: any[] = [];

    for (const box of boxes) {
      try {
        // Read box value to get child app ID
        const boxValueRes = await fetch(
          `${algodBase}/v2/applications/${factoryId}/box?name=b64:${box.name}`
        );
        if (!boxValueRes.ok) continue;
        const boxValueData = await boxValueRes.json();

        // Decode uint64 from 8-byte value
        const valueBytes = Buffer.from(boxValueData.value, "base64");
        let childAppId = 0;
        for (let i = 0; i < 8; i++) {
          childAppId = childAppId * 256 + valueBytes[i];
        }

        if (childAppId === 0) continue;

        // Read child app global state
        const appRes = await fetch(`${indexerBase}/v2/applications/${childAppId}`);
        if (!appRes.ok) continue;
        const appData = await appRes.json();
        const globalState = appData.application?.params?.["global-state"];
        if (!globalState) continue;

        // Decode global state
        const kv: Record<string, string | number> = {};
        for (const entry of globalState) {
          const key = Buffer.from(entry.key, "base64").toString("utf-8");
          kv[key] = decodeStateValue(entry.value);
        }

        if (kv["active"] !== 1) continue;

        const priceMicro = typeof kv["price_algo"] === "number" ? kv["price_algo"] : 0;

        agents.push({
          id: childAppId,
          name: kv["name"] || "",
          description: kv["description"] || "",
          endpoint_url: kv["endpoint_url"] || "",
          price_per_call_algo: priceMicro / 1_000_000,
          category: kv["category"] || "other",
          wallet_address: kv["wallet_address"] || "",
          x402_compatible: true,
        });
      } catch {
        continue;
      }
    }

    // Cache for 60 seconds
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("Content-Type", "application/json");

    return res.status(200).json({
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      network,
      factory_app_id: factoryId,
      agents,
    });
  } catch (err: any) {
    console.error("Agent registry error:", err);
    return res.status(500).json({ error: "Failed to read agent registry" });
  }
}
