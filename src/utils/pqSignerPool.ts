/**
 * Pool of Falcon signing workers for one printer key. Spreads signatures across
 * CPU cores and keeps the WASM work off the main thread. Falls back to signing
 * on the main thread if workers can't start.
 */
import Falcon from "falcon-signatures";

export type MessageSigner = (message: Uint8Array) => Promise<Uint8Array>;

interface Job {
  id: number;
  message: Uint8Array;
  resolve: (sig: Uint8Array) => void;
  reject: (err: Error) => void;
}

export class SignerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, Job>();
  private nextId = 1;
  private fallback: MessageSigner | null = null;

  private constructor(private readonly secretKeyHex: string) {}

  static async create(secretKeyHex: string, size = defaultPoolSize()): Promise<SignerPool> {
    const pool = new SignerPool(secretKeyHex);
    try {
      await Promise.all(Array.from({ length: size }, () => pool.spawn()));
    } catch {
      pool.terminate();
      const falcon = new Falcon();
      const sk = Falcon.hexToBytes(secretKeyHex);
      pool.fallback = (message) => falcon.sign(message, sk);
    }
    return pool;
  }

  get size() {
    return this.fallback ? 1 : this.workers.length;
  }

  sign: MessageSigner = (message) => {
    if (this.fallback) return this.fallback(message);
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, message, resolve, reject });
      this.pump();
    });
  };

  terminate() {
    for (const w of this.workers) w.terminate();
    for (const job of [...this.pending.values(), ...this.queue]) job.reject(new Error("signer stopped"));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending.clear();
  }

  private spawn(): Promise<void> {
    const worker = new Worker(new URL("./pqSignWorker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      const initId = this.nextId++;
      worker.onerror = (e) => reject(new Error(e.message || "worker failed to start"));
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.id === initId) {
          if (e.data.error) return reject(new Error(e.data.error));
          worker.onmessage = (ev) => this.onResult(worker, ev);
          this.workers.push(worker);
          this.idle.push(worker);
          resolve();
          this.pump();
        }
      };
      worker.postMessage({ id: initId, type: "init", secretKey: this.secretKeyHex });
    });
  }

  private onResult(worker: Worker, e: MessageEvent) {
    const job = this.pending.get(e.data.id);
    this.pending.delete(e.data.id);
    this.idle.push(worker);
    if (job) {
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve(new Uint8Array(e.data.signature));
    }
    this.pump();
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.pending.set(job.id, job);
      worker.postMessage({ id: job.id, type: "sign", message: job.message });
    }
  }
}

/** Leave a core for the UI; Falcon signing is CPU bound. */
function defaultPoolSize() {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(6, cores - 1));
}
