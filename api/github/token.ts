import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code } = req.body;

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET env vars");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const data = await tokenRes.json();

    if (data.error) {
      return res.status(400).json({
        error: data.error_description || data.error,
      });
    }

    return res.status(200).json({
      access_token: data.access_token,
      token_type: data.token_type,
      scope: data.scope,
    });
  } catch (err: any) {
    console.error("GitHub token exchange failed:", err);
    return res.status(500).json({ error: "Token exchange failed" });
  }
}
