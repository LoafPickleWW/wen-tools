import axios from "axios";

export async function pinJSONToFilebase(
  token: string,
  json: any,
  version = "",
  cidCodec = ""
): Promise<string> {
  try {
    let response;
    if (cidCodec === "raw" || cidCodec === "") {
      const jsonStr = typeof json === "string" ? json : JSON.stringify(json);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const data = new FormData();
      data.append("file", blob);
      response = await axios.post("https://rpc.filebase.io/api/v0/add", data, {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
        },
        params: {
          pin: true,
          "cid-version": version === "" ? 1 : parseInt(version),
        },
      });
    } else {
      // For other codecs, send as application/json body
      const jsonObject = typeof json === "string" ? JSON.parse(json) : json;
      response = await axios.post("https://rpc.filebase.io/api/v0/add", jsonObject, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
        },
      });
    }

    if (response.status === 200 && response.data && response.data.Hash) {
      return response.data.Hash;
    } else {
      throw new Error(response.data ? response.data.Error : "Empty Hash returned");
    }
  } catch (error: any) {
    console.error("pinJSONToFilebase error:", error);
    throw new Error("Filebase IPFS pinning failed");
  }
}

export async function pinImageToFilebase(
  token: string,
  image: File | Blob
): Promise<string> {
  try {
    const data = new FormData();
    data.append("file", image);
    const response = await axios.post("https://rpc.filebase.io/api/v0/add", data, {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
      },
      params: {
        pin: true,
        "cid-version": 1,
      },
    });

    if (response.status === 200 && response.data && response.data.Hash) {
      return response.data.Hash;
    } else {
      throw new Error(response.data ? response.data.Error : "Empty Hash returned");
    }
  } catch (error: any) {
    console.error("pinImageToFilebase error:", error);
    throw new Error("Filebase IPFS pinning failed");
  }
}

export type FilebasePinT = { cid: string; name?: string };

/** List the CIDs pinned in the bucket the token belongs to (direct/recursive pins only). */
export async function listFilebasePins(token: string): Promise<FilebasePinT[]> {
  const response = await axios.post("https://rpc.filebase.io/api/v0/pin/ls", null, {
    headers: { Authorization: `Bearer ${token.trim()}` },
    params: { names: true },
    responseType: "text",
    transformResponse: (r) => r,
  });

  const pins = new Map<string, FilebasePinT>();
  const add = (cid: string, info: any) => {
    if (!cid || info?.Type === "indirect") return;
    pins.set(cid, { cid, name: info?.Name || undefined });
  };

  // Kubo-style responses come back either as one {Keys: {cid: {...}}} object or, when streamed,
  // as newline-delimited {Cid, Type, Name} objects. Accept both.
  const text = String(response.data || "").trim();
  if (!text) return [];
  const chunks = text.startsWith("{") && !text.includes("}\n{") ? [text] : text.split("\n");
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const obj = JSON.parse(chunk);
    if (obj.Keys) {
      for (const [cid, info] of Object.entries(obj.Keys)) add(cid, info);
    } else if (obj.Cid) {
      add(typeof obj.Cid === "string" ? obj.Cid : obj.Cid["/"], obj);
    }
  }
  return [...pins.values()];
}

/** Read a small file (e.g. ARC3/ARC19 metadata JSON) from the bucket. */
export async function catFromFilebase(token: string, cid: string): Promise<string> {
  const response = await axios.post("https://rpc.filebase.io/api/v0/cat", null, {
    headers: { Authorization: `Bearer ${token.trim()}` },
    params: { arg: cid },
    responseType: "text",
    transformResponse: (r) => r,
    timeout: 20000,
  });
  return String(response.data);
}

/** Unpin a CID so Filebase removes it from the bucket. */
export async function unpinFromFilebase(token: string, cid: string): Promise<void> {
  await axios.post("https://rpc.filebase.io/api/v0/pin/rm", null, {
    headers: { Authorization: `Bearer ${token.trim()}` },
    params: { arg: cid },
  });
}
