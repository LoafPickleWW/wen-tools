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
