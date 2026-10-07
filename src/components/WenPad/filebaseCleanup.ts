import axios from 'axios';
import algosdk from 'algosdk';
import { CID } from 'multiformats/cid';
import { MAINNET_ALGONODE_INDEXER, TESTNET_ALGONODE_INDEXER } from '../../constants';
import { catFromFilebase, FilebasePinT, listFilebasePins, unpinFromFilebase } from '../../filebase';

// Compares CIDs by multihash so v0/v1 and raw/dag-pb spellings of the same content match.
const keyForCid = (cid: string): string | null => {
  try {
    return Buffer.from(CID.parse(cid).multihash.bytes).toString('hex');
  } catch {
    return null;
  }
};

const keyForArc19Reserve = (reserve: string): string | null => {
  try {
    const digest = algosdk.decodeAddress(reserve).publicKey;
    return Buffer.from([0x12, 0x20, ...digest]).toString('hex'); // sha2-256 multihash
  } catch {
    return null;
  }
};

// Pulls the CID out of ipfs://CID/..., https://gateway/ipfs/CID/..., or a bare CID.
const cidFromUrl = (url?: string): string | null => {
  if (!url) return null;
  const match = url.match(/ipfs:\/\/([A-Za-z0-9]+)/) || url.match(/\/ipfs\/([A-Za-z0-9]+)/);
  if (match) return match[1];
  return keyForCid(url.trim()) ? url.trim() : null;
};

type CreatedAssetT = { index: number; params: { url?: string; reserve?: string; name?: string } };

async function getCreatedAssets(indexer: string, address: string): Promise<CreatedAssetT[]> {
  const assets: CreatedAssetT[] = [];
  let next: string | undefined;
  do {
    const { data } = await axios.get(`${indexer}/v2/accounts/${address}/created-assets`, {
      params: { limit: 1000, next, 'include-all': false },
    });
    assets.push(...(data.assets || []));
    next = data['next-token'];
  } while (next);
  return assets;
}

export type PurgePlanT = {
  pins: FilebasePinT[];
  keep: FilebasePinT[];
  remove: FilebasePinT[];
  assetsChecked: number;
  unreadableMetadata: number;
};

export type ProgressFn = (message: string) => void;

/**
 * Lists everything in the bucket and splits it into pins still used by NFTs the wallet created
 * (on mainnet and testnet) and pins nothing references.
 */
export async function planFilebasePurge(token: string, creator: string | null, onProgress: ProgressFn): Promise<PurgePlanT> {
  onProgress('Listing files in your Filebase bucket...');
  const pins = await listFilebasePins(token);
  if (!creator) {
    return { pins, keep: [], remove: pins, assetsChecked: 0, unreadableMetadata: 0 };
  }

  const pinByKey = new Map<string, FilebasePinT>();
  for (const pin of pins) {
    const key = keyForCid(pin.cid);
    if (key) pinByKey.set(key, pin);
  }

  onProgress('Finding NFTs your wallet created...');
  const assets = [
    ...(await getCreatedAssets(MAINNET_ALGONODE_INDEXER, creator)),
    ...(await getCreatedAssets(TESTNET_ALGONODE_INDEXER, creator)),
  ];

  const protectedKeys = new Set<string>();
  const metadataToRead: string[] = []; // CIDs of ARC3/ARC19 metadata JSON
  for (const asset of assets) {
    const url = asset.params.url || '';
    if (url.startsWith('template-ipfs://') && asset.params.reserve) {
      const key = keyForArc19Reserve(asset.params.reserve);
      if (key) {
        protectedKeys.add(key);
        const pin = pinByKey.get(key);
        if (pin) metadataToRead.push(pin.cid);
      }
      continue;
    }
    const cid = cidFromUrl(url);
    const key = cid ? keyForCid(cid) : null;
    if (!cid || !key) continue;
    protectedKeys.add(key);
    if (url.includes('#arc3') && pinByKey.has(key)) metadataToRead.push(cid);
  }

  // Metadata points at the image, so read each metadata file that lives in this bucket.
  let unreadableMetadata = 0;
  let done = 0;
  const queue = [...new Set(metadataToRead)];
  const worker = async () => {
    while (queue.length) {
      const cid = queue.shift()!;
      try {
        const meta = JSON.parse(await catFromFilebase(token, cid));
        for (const ref of [meta.image, meta.animation_url, meta.external_url_media]) {
          const refCid = cidFromUrl(ref);
          const refKey = refCid ? keyForCid(refCid) : null;
          if (refKey) protectedKeys.add(refKey);
        }
      } catch {
        unreadableMetadata++;
      }
      done++;
      if (done % 10 === 0) onProgress(`Reading NFT metadata (${done}/${metadataToRead.length})...`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  const keep: FilebasePinT[] = [];
  const remove: FilebasePinT[] = [];
  for (const pin of pins) {
    const key = keyForCid(pin.cid);
    (key && protectedKeys.has(key) ? keep : remove).push(pin);
  }
  return { pins, keep, remove, assetsChecked: assets.length, unreadableMetadata };
}

export async function executeFilebasePurge(
  token: string,
  pins: FilebasePinT[],
  onProgress: (done: number, failed: number) => void,
  shouldStop: () => boolean
) {
  let done = 0;
  let failed = 0;
  const queue = [...pins];
  const worker = async () => {
    while (queue.length && !shouldStop()) {
      const pin = queue.shift()!;
      try {
        await unpinFromFilebase(token, pin.cid);
        done++;
      } catch (err) {
        console.error('Filebase unpin failed', pin.cid, err);
        failed++;
      }
      onProgress(done, failed);
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return { done, failed, stopped: shouldStop() && queue.length > 0 };
}
