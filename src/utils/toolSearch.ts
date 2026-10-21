/**
 * Natural-language-ish search over the TOOLS list.
 *
 * Queries like "mint an nft" or "airdrop tokens to holders" are split into
 * words, filler words are dropped, and each remaining word is matched against
 * a tool's label, description and category (with light stemming, prefix
 * matching for as-you-type, and a small synonym table). Results are ranked so
 * label hits beat description hits and every-word matches beat partial ones.
 */

export interface SearchableTool {
  label: string;
  description: string;
  category?: string;
  hideFromLanding?: boolean;
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "on", "in", "into", "from", "with", "by",
  "my", "your", "our", "me", "i", "we", "you", "it", "its", "this", "that",
  "and", "or", "is", "are", "be", "can", "do", "how", "want", "need", "some",
  "all", "any", "tool", "tools", "algorand", "algo", "using", "via", "at",
]);

/** Words that mean roughly the same thing in this domain (keys are stems). */
const SYNONYMS: Record<string, string[]> = {
  nft: ["collection", "asset", "asa", "arc3", "arc19", "arc69"],
  collection: ["nft"],
  token: ["asset", "asa", "coin", "stablecoin"],
  coin: ["token", "stablecoin"],
  asa: ["asset", "token", "nft"],
  asset: ["asa", "token", "nft"],
  mint: ["create", "generat", "launch"],
  create: ["mint", "generat"],
  make: ["mint", "create", "generat"],
  generat: ["create", "mint"],
  launch: ["mint", "sale"],
  airdrop: ["distribut", "send"],
  distribut: ["airdrop", "send"],
  send: ["transfer", "airdrop", "distribut"],
  transfer: ["send"],
  pay: ["send"],
  update: ["edit", "metadata"],
  edit: ["update"],
  change: ["update"],
  metadata: ["update", "arc69", "arc19"],
  burn: ["destroy"],
  delete: ["destroy"],
  remove: ["destroy", "optout"],
  destroy: ["burn"],
  holder: ["snapshot", "holding", "audit"],
  snapshot: ["holder"],
  holding: ["holder", "portfolio", "balance"],
  portfolio: ["holding", "wallet"],
  balance: ["holding"],
  audit: ["holding", "holder"],
  export: ["download", "csv"],
  download: ["export", "csv"],
  csv: ["export", "download"],
  swap: ["trade", "exchange"],
  trade: ["swap"],
  exchange: ["swap"],
  chat: ["message", "messag"],
  messag: ["chat"],
  dm: ["chat"],
  vote: ["governance", "xgov"],
  governance: ["vote", "xgov"],
  music: ["jukebox"],
  song: ["music", "jukebox"],
  wallet: ["address", "account"],
  address: ["wallet", "account"],
  account: ["wallet", "address"],
  optin: ["opt"],
  optout: ["opt"],
  website: ["site", "deploy", "ipfs"],
  site: ["deploy", "ipfs"],
  host: ["deploy", "ipfs"],
  deploy: ["ipfs"],
  quantum: ["pq", "falcon"],
  pq: ["quantum", "falcon"],
  ai: ["agent"],
  bot: ["agent", "cluster"],
  random: ["shuffle"],
  claim: ["inbox", "vault"],
};

/** Normalizes text so "ARC-19", "opt-in" and "Opt In" compare equal-ish. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/(arc|opt)[\s-]+(\d+|in|out)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crude suffix stripping: minting→mint, holders→holder, airdropped→airdrop. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  for (const suffix of ["ing", "ed", "es", "s", "e"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      const base = word.slice(0, -suffix.length);
      // airdropped → airdropp → airdrop
      return base.length > 3 && base[base.length - 1] === base[base.length - 2]
        ? base.slice(0, -1)
        : base;
    }
  }
  return word;
}

function words(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

/** True if the query term matches any word (exact stem, or as a typed prefix). */
function hits(term: string, fieldStems: string[], fieldWords: string[]): boolean {
  const termStem = stem(term);
  return (
    fieldStems.includes(termStem) ||
    (term.length >= 2 && fieldWords.some((w) => w.startsWith(term))) ||
    (termStem.length >= 3 && fieldStems.some((s) => s.startsWith(termStem)))
  );
}

export function searchTools<T extends SearchableTool>(tools: T[], rawQuery: string): T[] {
  const query = rawQuery.trim();
  if (!query) return tools;

  const allTerms = words(query);
  const terms = allTerms.filter((t) => !STOPWORDS.has(t));
  // Query made only of filler words: fall back to plain matching on them
  const effectiveTerms = terms.length ? terms : allTerms;
  if (!effectiveTerms.length) return tools;

  const scored = tools.map((tool) => {
    const fields = [
      { text: tool.label, weight: 6 },
      { text: tool.description, weight: 2 },
      { text: tool.category ?? "", weight: 1 },
    ].map((f) => {
      const ws = words(f.text);
      return { ...f, words: ws, stems: ws.map(stem) };
    });

    let score = 0;
    let matched = 0;
    for (const term of effectiveTerms) {
      let best = 0;
      const alternatives = SYNONYMS[stem(term)] ?? SYNONYMS[term] ?? [];
      for (const f of fields) {
        if (hits(term, f.stems, f.words)) best = Math.max(best, f.weight);
        else if (alternatives.some((alt) => hits(alt, f.stems, f.words)))
          best = Math.max(best, f.weight * 0.5);
      }
      if (best > 0) matched++;
      score += best;
    }

    // Whole-phrase hits in the label are the strongest signal
    if (normalize(tool.label).includes(normalize(query))) score += 10;
    // Prefer current tools over the legacy/hidden variants
    if (/^legacy\b/i.test(tool.description)) score -= 5;
    if (!tool.hideFromLanding) score += 1;

    return { tool, score, matched };
  });

  const all = scored.filter((s) => s.matched === effectiveTerms.length);
  // Nothing matches every word: show the tools that match the most words
  const pool = all.length
    ? all
    : scored.filter((s) => s.matched > 0 && s.matched >= Math.ceil(effectiveTerms.length / 2));

  pool.sort((a, b) => b.matched - a.matched || b.score - a.score);
  // Trim the long tail of loose synonym-only matches
  const cutoff = (pool[0]?.score ?? 0) * 0.4;
  return pool.filter((s) => s.score >= cutoff).map((s) => s.tool);
}
