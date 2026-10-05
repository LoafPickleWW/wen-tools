import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { ProjectT, PreviewItemT } from './WenPadTypes';

// A .wenpad bundle (a zip under the hood) holds everything needed to hand a WenPad project to someone else.
// It deliberately isn't named .zip: Safari and "Extract All" would unpack it, and Import needs the single file.
//   project.json             – the project with trait image bytes stripped out
//   images/<traitId>.<ext>   – one file per trait image
//   settings.json            – optional IPFS settings (Filebase token)
// Preview items reference trait images by layerId/traitId and are re-linked on import,
// so each image is stored once no matter how many items use it.

export const BUNDLE_FORMAT = 'wenpad-project';
export const BUNDLE_VERSION = 1;

export type BundleSettingsT = {
  filebaseToken?: string;
};

export type ImportedBundleT = {
  project: ProjectT;
  settings: BundleSettingsT;
  stats: { layers: number; traits: number; items: number; missingImages: number };
};

const extFromType = (type: string) => {
  const sub = (type || '').split('/')[1] || 'png';
  return sub.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
};

// Trait data has been stored in several shapes over time (ArrayBuffer from uploads, typed arrays,
// Blobs, data URLs, and plain {0: n, 1: n} objects from older JSON round-trips).
async function toBytes(data: any): Promise<Uint8Array | null> {
  if (!data) return null;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (typeof data === 'string') {
    const match = data.match(/^data:[^;]*;base64,(.*)$/);
    if (!match) return null;
    const bin = atob(match[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (typeof data === 'object') {
    const vals = Object.values(data);
    if (vals.length > 0 && typeof vals[0] === 'number') return new Uint8Array(vals as number[]);
  }
  return null;
}

const stripItemImages = (items: PreviewItemT[] = []) =>
  items.map((item) => ({
    ...item,
    traits: Object.fromEntries(
      Object.entries(item.traits || {}).map(([key, trait]) => [key, { ...trait, image: undefined }])
    ),
  }));

export async function exportProjectBundle(project: ProjectT, settings: BundleSettingsT = {}): Promise<Blob> {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};

  const layers = [];
  for (const layer of project.layers || []) {
    const traits = [];
    for (const trait of layer.traits || []) {
      const bytes = await toBytes(trait.data);
      let imageFile: string | undefined;
      if (bytes) {
        imageFile = `images/${trait.id}.${extFromType(trait.type)}`;
        // Images are already compressed; storing them avoids burning CPU for no gain.
        files[imageFile] = [bytes, { level: 0 }];
      }
      traits.push({ ...trait, data: undefined, imageFile });
    }
    layers.push({ ...layer, traits });
  }

  const { id: _id, owner: _owner, ...rest } = project;
  const manifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      ...rest,
      layers,
      previewItems: stripItemImages(project.previewItems),
      customs: stripItemImages(project.customs),
    },
  };

  files['project.json'] = strToU8(JSON.stringify(manifest));
  if (settings.filebaseToken) {
    files['settings.json'] = strToU8(JSON.stringify(settings));
  }

  const zipped = zipSync(files as any);
  // Generic type so browsers don't recognise it as a zip and auto-extract or rename it.
  return new Blob([zipped], { type: 'application/octet-stream' });
}

export async function importProjectBundle(file: File): Promise<ImportedBundleT> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf);
  } catch {
    throw new Error('This is not a WenPad project file (.wenpad). If it was unzipped, ask for the original file.');
  }

  if (!entries['project.json']) throw new Error('Bundle is missing project.json.');
  const manifest = JSON.parse(strFromU8(entries['project.json']));
  if (manifest.format !== BUNDLE_FORMAT) throw new Error('This is not a WenPad project bundle.');
  if (manifest.version > BUNDLE_VERSION) {
    throw new Error('This bundle was made by a newer version of WenPad. Refresh the page and try again.');
  }

  const raw = manifest.project as ProjectT & { layers: any[] };
  const imageByTraitId = new Map<string, ArrayBuffer>();
  let traitCount = 0;

  const layers = (raw.layers || []).map((layer: any) => ({
    ...layer,
    traits: (layer.traits || []).map((trait: any) => {
      traitCount++;
      const { imageFile, ...t } = trait;
      const bytes = imageFile ? entries[imageFile] : undefined;
      // Copy into a standalone ArrayBuffer, which is what freshly uploaded traits store.
      const data = bytes ? bytes.slice().buffer : undefined;
      if (data) imageByTraitId.set(t.id, data);
      return { ...t, data };
    }),
  }));

  let missingImages = 0;
  const relink = (items: PreviewItemT[] = []) =>
    items.map((item) => ({
      ...item,
      traits: Object.fromEntries(
        Object.entries(item.traits || {}).map(([key, trait]) => {
          const image = imageByTraitId.get(trait.traitId);
          if (!image && trait.traitId) missingImages++;
          return [key, { ...trait, image }];
        })
      ),
    }));

  const project: ProjectT = {
    ...raw,
    layers,
    previewItems: relink(raw.previewItems),
    customs: relink(raw.customs),
  };

  let settings: BundleSettingsT = {};
  if (entries['settings.json']) {
    try {
      settings = JSON.parse(strFromU8(entries['settings.json']));
    } catch {
      settings = {};
    }
  }

  return {
    project,
    settings,
    stats: {
      layers: layers.length,
      traits: traitCount,
      items: project.previewItems.length,
      missingImages,
    },
  };
}
