import type { VercelRequest, VercelResponse } from "@vercel/node";
import wenpadReveal from "./_keepers/wenpad-reveal.js";
import voteKeeper from "./_keepers/vote.js";

/**
 * One serverless function for the site's background keepers. The Vercel Hobby plan allows at most
 * 12 functions per deployment, and files under api/_keepers/ (leading underscore) are not counted.
 *
 *   /api/keeper?job=wenpad   Shuffle reveals + auto-close   (old path /api/wenpad-reveal, rewritten here)
 *   /api/keeper?job=vote     Vote Tool recounts + settling  (old path /api/vote-keeper, rewritten here)
 *   GET /api/keeper          Vote Tool cron sweep (the only GET job)
 *
 * Each job keeps its own docs, auth and limits in its file.
 */

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const job = String(req.query.job ?? "");
  if (job === "wenpad") return wenpadReveal(req, res);
  if (job === "vote" || (!job && req.method === "GET")) return voteKeeper(req, res);
  return res.status(400).json({ error: "Unknown keeper job" });
}
