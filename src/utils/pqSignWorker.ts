/// <reference lib="webworker" />
/**
 * Falcon-1024 signing worker. Holds one printer key and signs messages off the
 * main thread, so a busy printer never freezes the page.
 *
 *   { id, type: "init", secretKey }  -> { id, ok: true }
 *   { id, type: "sign", message }    -> { id, signature }
 */
import Falcon from "falcon-signatures";

const falcon = new Falcon();
let secretKey: Uint8Array | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { id, type } = e.data;
  try {
    if (type === "init") {
      secretKey = Falcon.hexToBytes(e.data.secretKey);
      // Warm up the WASM module before the first real signature.
      await falcon.sign(new Uint8Array([0]), secretKey);
      self.postMessage({ id, ok: true });
    } else if (type === "sign") {
      if (!secretKey) throw new Error("signer not initialised");
      const signature = await falcon.sign(e.data.message, secretKey);
      self.postMessage({ id, signature }, [signature.buffer]);
    }
  } catch (err: any) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
