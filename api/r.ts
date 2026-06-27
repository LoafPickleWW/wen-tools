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

  const { d, e } = req.query;

  if (!d || typeof d !== "string" || !e || typeof e !== "string") {
    return res.status(400).json({ error: "Missing required parameters: d and e" });
  }

  try {
    // Pad base64 if needed
    let base64 = d.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length < 1) {
      return res.status(400).json({ error: "Invalid data parameter" });
    }

    const type = buffer[0];
    let redirectUrl = "";

    if (type === 0 || type === 1) {
      // Contract-nested OpenSea URL
      // 1 byte type + 20 bytes contract + 16 bytes hash2 = 37 bytes
      if (buffer.length < 37) {
        return res.status(400).json({ error: "Invalid data length for type " + type });
      }
      const subdomain = type === 0 ? "raw2" : "i2c";
      const contractBytes = buffer.subarray(1, 21);
      const contract = "0x" + contractBytes.toString("hex");
      const hash2Bytes = buffer.subarray(21, 37);
      const hash2 = hash2Bytes.toString("hex");
      const hash1 = hash2.substring(2);
      
      redirectUrl = `https://${subdomain}.seadn.io/ethereum/${contract}/${hash1}/${hash2}.${e}`;
    } else if (type === 2) {
      // Flat OpenSea URL: i.seadn.io/gcs/files/<hash>.<ext>
      // 1 byte type + 16 bytes hash = 17 bytes
      if (buffer.length < 17) {
        return res.status(400).json({ error: "Invalid data length for type 2" });
      }
      const hashBytes = buffer.subarray(1, 17);
      const hash = hashBytes.toString("hex");
      redirectUrl = `https://i.seadn.io/gcs/files/${hash}.${e}`;
    } else {
      return res.status(400).json({ error: "Unknown type: " + type });
    }

    res.writeHead(302, { Location: redirectUrl });
    res.end();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
