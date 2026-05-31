import algosdk from "algosdk";

// ── Constants ────────────────────────────────────────────────────────────
export const MAX_SWAP_TXS = 16;
export const SWAP_RECEIVER = "RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ";
export const TX_NOTE = "via wen.tools | wen swap";
const INDEXER = "https://mainnet-idx.algonode.cloud";
const NODE = "https://mainnet-api.4160.nodely.dev";
const algod = new algosdk.Algodv2("", NODE, "");

// ── Types ────────────────────────────────────────────────────────────────
export interface SwapItem {
  id: number;
  sender: string;
  receiver: string;
  assetId: number | null;
  amount: number | null;
  txType: "pay" | "axfer" | "optin" | "";
  assetUrl?: string;
  assetReserve?: string;
}

export interface DecodedSwapTx {
  swap: SwapItem;
  isSigned: boolean;
  bytes: Uint8Array;
}

// ── Helpers ──────────────────────────────────────────────────────────────
export async function getAssetInfo(id: number, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`${INDEXER}/v2/assets/${id}?include-all=true`);
      if (r.status === 429 || r.status >= 500) {
        if (i < retries) {
          await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
          continue;
        }
      }
      if (!r.ok) throw new Error("Invalid Asset ID");
      const d = await r.json();
      return d.asset as { index: number; params: { name: string; decimals: number; "unit-name": string; url?: string; reserve?: string; total?: number } };
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw new Error("Failed to fetch asset info after retries");
}

export async function resolveNfd(domain: string): Promise<string> {
  domain = domain.toLowerCase();
  try {
    const r = await fetch(`https://api.nf.domains/nfd/${domain}?view=tiny`);
    if (r.ok) { const d = await r.json(); return d.depositAccount || ""; }
  } catch { /* ignore */ }
  return "";
}

async function resolveAddr(addr: string): Promise<string> {
  if (addr.endsWith(".algo")) {
    const resolved = await resolveNfd(addr);
    if (!resolved) throw new Error(`Cannot resolve NFD: ${addr}`);
    return resolved;
  }
  return addr;
}

export async function getAccountAssets(addr: string): Promise<Set<number>> {
  const s = new Set<number>();
  try {
    const r = await fetch(`${INDEXER}/v2/accounts/${addr}/assets?include-all=false`);
    const d = await r.json();
    for (const a of d.assets || []) s.add(a["asset-id"]);
  } catch { /* ignore */ }
  return s;
}

export interface WalletAsset {
  id: number;
  name: string;
  unitName: string;
  amount: number;
  decimals: number;
  total?: number;
}

export async function getAccountAssetsWithInfo(
  addr: string,
  onBatch?: (assets: WalletAsset[]) => void
): Promise<WalletAsset[]> {
  const results: WalletAsset[] = [{ id: 1, name: "Algo", unitName: "ALGO", amount: 0, decimals: 6 }];
  onBatch?.([...results]);
  try {
    // Resolve NFD if needed
    const resolved = addr.endsWith(".algo") ? await resolveNfd(addr) : addr;
    if (!resolved) return results;
    // 1. Fetch all held asset IDs (paginated, fast)
    let url: string | null = `${INDEXER}/v2/accounts/${resolved}/assets?include-all=false`;
    const assetIds: { id: number; amount: number }[] = [];
    while (url) {
      let success = false;
      let ad: any = null;
      for (let retries = 0; retries < 3; retries++) {
        try {
          const ar: Response = await fetch(url);
          if (ar.status === 429 || ar.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, 300 * (retries + 1)));
            continue;
          }
          if (!ar.ok) {
            break;
          }
          ad = await ar.json();
          success = true;
          break;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 300 * (retries + 1)));
        }
      }
      
      if (!success || !ad) {
        console.warn(`Indexer page fetch failed permanently for: ${url}`);
        break;
      }
      
      for (const a of ad.assets || []) assetIds.push({ id: a["asset-id"], amount: a.amount });
      url = ad["next-token"] ? `${INDEXER}/v2/accounts/${resolved}/assets?include-all=false&next=${ad["next-token"]}` : null;
    }

    // 2. Pre-populate name cache from created assets (single call, has name data)
    const nameCache: Record<number, { name: string; unitName: string; decimals: number; total: number }> = {};
    try {
      let createdUrl: string | null = `${INDEXER}/v2/accounts/${resolved}/created-assets?include-all=false`;
      while (createdUrl) {
        let success = false;
        let cd: any = null;
        for (let retries = 0; retries < 3; retries++) {
          try {
            const cr: Response = await fetch(createdUrl);
            if (cr.status === 429 || cr.status >= 500) {
              await new Promise(resolve => setTimeout(resolve, 300 * (retries + 1)));
              continue;
            }
            if (!cr.ok) break;
            cd = await cr.json();
            success = true;
            break;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 300 * (retries + 1)));
          }
        }
        if (!success || !cd) break;
        for (const a of cd.assets || []) {
          nameCache[a.index] = { name: a.params?.name || "", unitName: a.params?.["unit-name"] || "", decimals: a.params?.decimals || 0, total: a.params?.total || 0 };
        }
        createdUrl = cd["next-token"] ? `${INDEXER}/v2/accounts/${resolved}/created-assets?include-all=false&next=${cd["next-token"]}` : null;
      }
    } catch (err) {
      console.warn("Failed to fetch created assets for name cache:", err);
    }

    // 3. Resolve names in parallel batches of 10, streaming results
    const BATCH_SIZE = 10;
    for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
      const batch = assetIds.slice(i, i + BATCH_SIZE);
      const resolvedBatch = await Promise.all(batch.map(async ({ id, amount }) => {
        if (nameCache[id]) {
          return { id, name: nameCache[id].name, unitName: nameCache[id].unitName, amount, decimals: nameCache[id].decimals, total: nameCache[id].total };
        }
        try {
          const info = await getAssetInfo(id);
          return { id, name: info.params.name, unitName: info.params["unit-name"], amount, decimals: info.params.decimals, total: info.params.total };
        } catch {
          return { id, name: `ASA #${id}`, unitName: "", amount, decimals: 0, total: 0 };
        }
      }));
      results.push(...resolvedBatch);
      onBatch?.([...results]);
    }
  } catch (err) {
    console.error("Error in getAccountAssetsWithInfo:", err);
  }
  return results;
}

// ── Build & Sign Swap Group ──────────────────────────────────────────────
export async function buildSwapGroup(items: SwapItem[]) {
  const decimals: Record<number, number> = {};
  const resolved: Record<string, string> = {};

  for (const item of items) {
    if (item.txType === "pay") item.assetId = 1;
    if (item.txType === "optin") { item.amount = 0; item.receiver = item.sender; }

    // resolve NFDs
    for (const addr of [item.sender, item.receiver]) {
      if (addr && !(addr in resolved)) resolved[addr] = await resolveAddr(addr);
    }
    // fetch decimals
    if (item.assetId && item.assetId !== 1 && !(item.assetId in decimals)) {
      const info = await getAssetInfo(item.assetId);
      decimals[item.assetId] = info.params.decimals;
    }
  }

  const params = await algod.getTransactionParams().do();
  const txns: algosdk.Transaction[] = [];

  for (const item of items) {
    const from = resolved[item.sender] || item.sender;
    const to = resolved[item.receiver] || item.receiver;
    if (item.txType === "pay") {
      txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from, to, amount: algosdk.algosToMicroalgos(item.amount || 0), suggestedParams: params,
      }));
    } else if (item.txType === "axfer") {
      txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from, to, amount: (item.amount || 0) * Math.pow(10, decimals[item.assetId!] || 0),
        assetIndex: item.assetId!, suggestedParams: params,
      }));
    } else if (item.txType === "optin") {
      txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from, to: from, amount: 0, assetIndex: item.assetId!, suggestedParams: params,
      }));
    }
  }

  const gid = algosdk.computeGroupID(txns);
  txns.forEach(t => { t.group = gid; });
  return txns;
}

// ── Concatenation Protocol ───────────────────────────────────────────────
function concat(arrays: Uint8Array[]): Uint8Array {
  const meta = new TextEncoder().encode(`${arrays.length}:${arrays.map(a => a.length).join(":")}$`);
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(meta.length + total);
  out.set(meta, 0);
  let off = meta.length;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function deconcat(data: Uint8Array): Uint8Array[] {
  const text = new TextDecoder().decode(data);
  const [header] = text.split("$");
  const [countStr, ...lenStrs] = header.split(":");
  const count = Number(countStr);
  const result: Uint8Array[] = [];
  let off = header.length + 1;
  for (let i = 0; i < count; i++) {
    const len = Number(lenStrs[i]);
    result.push(data.slice(off, off + len));
    off += len;
  }
  return result;
}

// ── Share Transaction (store swap in notes) ──────────────────────────────
export async function createShareTx(
  sender: string, signedSwap: Uint8Array[],
  signer: (txns: algosdk.Transaction[], indices: number[]) => Promise<Uint8Array[]>
) {
  const blob = concat(signedSwap);
  const notes: Uint8Array[] = [];
  for (let i = 0; i < blob.length; i += 1000) {
    notes.push(blob.slice(i, i + 1000));
  }
  const params = await algod.getTransactionParams().do();
  const txns = notes.map(note =>
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: sender, to: SWAP_RECEIVER, amount: 0, suggestedParams: params, note,
    })
  );
  if (txns.length > 1) {
    const gid = algosdk.computeGroupID(txns);
    txns.forEach(t => { t.group = gid; });
  }
  const signed = await signer(txns, txns.map((_, i) => i));
  const { txId } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txId, 4);
  return txns.map(t => t.txID());
}

// ── Fetch & Decode a shared swap ─────────────────────────────────────────
export async function fetchSwapFromTxIds(txIds: string[]): Promise<DecodedSwapTx[]> {
  const notes: Uint8Array[] = [];
  for (const txId of txIds) {
    const r = await fetch(`${INDEXER}/v2/transactions/${txId}`);
    if (!r.ok) throw new Error(`Transaction not found: ${txId}`);
    const d = await r.json();
    const note64 = d.transaction?.note;
    if (!note64) continue;
    // Check if this is a group tx
    const groupId = d.transaction?.group;
    if (groupId && txIds.length === 1) {
      // Fetch all txns in group
      const gr = await fetch(`${INDEXER}/v2/transactions?group-id=${encodeURIComponent(groupId)}`);
      const gd = await gr.json();
      const sortedTxns = (gd.transactions || []).sort((a: any, b: any) =>
        (a["intra-round-offset"] || 0) - (b["intra-round-offset"] || 0)
      );
      notes.length = 0;
      for (const t of sortedTxns) {
        if (t.note) notes.push(Uint8Array.from(atob(t.note), c => c.charCodeAt(0)));
      }
      break;
    }
    notes.push(Uint8Array.from(atob(note64), c => c.charCodeAt(0)));
  }

  const merged = new Uint8Array(notes.reduce((s, n) => s + n.length, 0));
  let off = 0;
  for (const n of notes) { merged.set(n, off); off += n.length; }

  const rawTxns = deconcat(merged);
  const results: DecodedSwapTx[] = [];

  for (let i = 0; i < rawTxns.length; i++) {
    let txn: algosdk.Transaction;
    let isSigned = false;
    try {
      txn = algosdk.decodeUnsignedTransaction(rawTxns[i]);
    } catch {
      const st = algosdk.decodeSignedTransaction(rawTxns[i]);
      txn = st.txn;
      isSigned = true;
    }

    const from = algosdk.encodeAddress(txn.from.publicKey);
    const to = txn.to ? algosdk.encodeAddress(txn.to.publicKey) : from;

    if (txn.type === "pay") {
      results.push({
        swap: { id: i, sender: from, receiver: to, assetId: 1, amount: algosdk.microalgosToAlgos(txn.amount as number), txType: "pay" },
        isSigned, bytes: rawTxns[i],
      });
    } else if (txn.type === "axfer") {
      const isOptin = from === to && (txn.amount === undefined || txn.amount === 0);
      if (isOptin) {
        results.push({
          swap: { id: i, sender: from, receiver: to, assetId: txn.assetIndex, amount: 0, txType: "optin" },
          isSigned, bytes: rawTxns[i],
        });
      } else {
        let dec = 0;
        let url = "";
        let reserve = "";
        try { 
          const info = await getAssetInfo(txn.assetIndex); 
          dec = info.params.decimals; 
          url = info.params.url || "";
          reserve = info.params.reserve || "";
        } catch { /* ignore */ }
        results.push({
          swap: { id: i, sender: from, receiver: to, assetId: txn.assetIndex,
            amount: (txn.amount as number) / Math.pow(10, dec), txType: "axfer",
            assetUrl: url, assetReserve: reserve },
          isSigned, bytes: rawTxns[i],
        });
      }
    }
  }
  return results;
}

// ── Sign claimer's portion & broadcast ───────────────────────────────────
export async function claimSwap(
  decodedTxns: DecodedSwapTx[],
  signer: (txns: algosdk.Transaction[], indices: number[]) => Promise<Uint8Array[]>
) {
  // Rebuild transaction objects from bytes
  const allTxnBytes = decodedTxns.map(d => d.bytes);
  const unsignedTxns: algosdk.Transaction[] = [];
  const signerIndices: number[] = [];

  for (let i = 0; i < decodedTxns.length; i++) {
    let txn: algosdk.Transaction;
    try { txn = algosdk.decodeUnsignedTransaction(allTxnBytes[i]); }
    catch { txn = algosdk.decodeSignedTransaction(allTxnBytes[i]).txn; }
    unsignedTxns.push(txn);
    if (!decodedTxns[i].isSigned) signerIndices.push(i);
  }

  const signed = await signer(unsignedTxns, signerIndices);

  // Merge: use newly signed txns for unsigned, keep original bytes for already-signed
  const merged: Uint8Array[] = [];
  let signedIdx = 0;
  for (let i = 0; i < decodedTxns.length; i++) {
    if (signerIndices.includes(i)) {
      merged.push(signed[signedIdx++]);
    } else {
      merged.push(allTxnBytes[i]);
    }
  }

  const { txId } = await algod.sendRawTransaction(merged).do();
  await algosdk.waitForConfirmation(algod, txId, 4);
  return txId;
}
