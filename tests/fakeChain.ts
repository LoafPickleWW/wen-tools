/**
 * Offline stand-in for algod + indexer. Every HTTP request the app makes (algosdk,
 * axios, or bare fetch) is routed here, so tests never touch the network and an
 * unmocked call fails loudly with its URL.
 *
 * Responses mirror real algod/indexer payloads (kebab-case JSON, msgpack where the
 * SDK asks for it), so the same fixtures exercise algosdk v2 and v3 response parsing.
 */
import * as algosdk from "algosdk";
import { Decoder, encode as mpEncode } from "@msgpack/msgpack";
import { addr, b64 } from "./wire";

export const GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
export const GENESIS_ID = "mainnet-v1.0";
export const START_ROUND = 50_000_000;

type Json = any;
type Handler = (req: FakeRequest) => Json | FakeResponse | Promise<Json | FakeResponse>;

export interface FakeRequest {
  method: string;
  url: URL;
  body: Uint8Array | null;
  /** Parsed JSON body when the request sent JSON. */
  json: any;
  wantsMsgpack: boolean;
}

export class FakeResponse {
  constructor(public status: number, public body: Json) {}
}

export interface SentTxn {
  txID: string;
  bytes: Uint8Array;
  raw: any;
}

export interface AppFixture {
  id: number;
  creator: string;
  approval?: Uint8Array;
  clear?: Uint8Array;
  globalState?: Record<string, number | bigint | Uint8Array | string>;
  boxes?: Record<string, Uint8Array>;
  globalSchema?: { ints: number; bytes: number };
  localSchema?: { ints: number; bytes: number };
  extraPages?: number;
}

export interface AssetFixture {
  index: number;
  creator: string;
  name?: string;
  unitName?: string;
  url?: string;
  decimals?: number;
  total?: number | bigint;
  manager?: string;
  reserve?: string;
  freeze?: string;
  clawback?: string;
  defaultFrozen?: boolean;
  metadataHash?: Uint8Array;
}

export interface AccountFixture {
  address: string;
  amount?: number;
  minBalance?: number;
  assets?: { id: number; amount: number | bigint; frozen?: boolean }[];
  createdAssets?: number[];
  appsLocalState?: { id: number; state?: Record<string, number | Uint8Array> }[];
  createdApps?: number[];
  authAddr?: string;
}

/** Called for each confirmed txn; returns extra pending-response fields (asset-index, logs, ...). */
export type ConfirmHook = (txn: SentTxn, index: number) => Record<string, any> | void;

export interface SimulateResult {
  /** Per-txn: number of inner txns to report and logs to attach. */
  txns?: { inner?: number; logs?: Uint8Array[] }[];
  /** Group-level unnamed resources (what algokit's populateAppCallResources reads). */
  unnamed?: { accounts?: string[]; assets?: number[]; apps?: number[]; boxes?: { app: number; name: Uint8Array }[]; "extra-box-refs"?: number };
  failure?: string;
}

/** Inspect a simulated group (decoded raw signed txns) and describe the outcome. */
export type SimulateHook = (group: any[], call: number) => SimulateResult | void;

const decodeMulti = (buf: Uint8Array): { value: any; bytes: Uint8Array }[] => {
  const out: { value: any; bytes: Uint8Array }[] = [];
  const decoder = new Decoder({ useBigInt64: true });
  let start = 0;
  for (const value of decoder.decodeMulti(buf)) {
    const end = (decoder as any).pos as number;
    out.push({ value, bytes: buf.slice(start, end) });
    start = end;
  }
  return out;
};

/** JSON.stringify that writes bigints as bare numbers and bytes as base64, like algod does. */
export function toAlgodJson(value: Json): string {
  const marks: string[] = [];
  const text = JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") {
      marks.push(v.toString());
      return `__BIG${marks.length - 1}__`;
    }
    if (v instanceof Uint8Array) return b64(v);
    return v;
  });
  return text.replace(/"__BIG(\d+)__"/g, (_m, i) => marks[Number(i)]);
}

const tealValue = (v: number | bigint | Uint8Array | string) =>
  typeof v === "number" || typeof v === "bigint"
    ? { type: 2, uint: v, bytes: "" }
    : { type: 1, uint: 0, bytes: b64(typeof v === "string" ? new TextEncoder().encode(v) : v) };

const keyValues = (state: Record<string, number | bigint | Uint8Array | string>) =>
  Object.entries(state).map(([k, v]) => ({ key: b64(new TextEncoder().encode(k)), value: tealValue(v) }));

export class FakeChain {
  round = START_ROUND;
  minFee = 1000;
  fee = 0;
  accounts = new Map<string, AccountFixture>();
  assets = new Map<number, AssetFixture>();
  apps = new Map<number, AppFixture>();
  sent: SentTxn[] = [];
  requests: string[] = [];
  confirmHook: ConfirmHook | null = null;
  simulateHook: SimulateHook | null = null;
  /** Decoded raw groups of every simulate call. */
  simulated: any[][] = [];
  private routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
  private nextAssetId = 9_000_000_000;
  private nextAppId = 8_000_000_000;

  /** Register a handler for any URL matching `pattern` (checked before the built-in algod routes). */
  on(method: string, pattern: RegExp, handler: Handler) {
    this.routes.unshift({ method: method.toUpperCase(), pattern, handler });
    return this;
  }

  addAccount(a: AccountFixture) {
    this.accounts.set(a.address, a);
    return this;
  }
  addAsset(a: AssetFixture) {
    this.assets.set(a.index, a);
    return this;
  }
  addApp(a: AppFixture) {
    this.apps.set(a.id, a);
    return this;
  }

  /** Flattened decoded msgpack of every signed txn submitted, in order. */
  get sentRaw() {
    return this.sent.map((s) => s.raw);
  }

  // ---- algod payload builders -------------------------------------------------

  paramsJson() {
    return {
      "consensus-version": "https://github.com/algorandfoundation/specs/tree/268b63433a907455d439995bf916f6b296018f4f",
      fee: this.fee,
      "genesis-hash": GENESIS_HASH,
      "genesis-id": GENESIS_ID,
      "last-round": this.round,
      "min-fee": this.minFee,
    };
  }

  statusJson() {
    return {
      catchpoint: "",
      "catchpoint-acquired-blocks": 0,
      "catchpoint-processed-accounts": 0,
      "catchpoint-processed-kvs": 0,
      "catchpoint-total-accounts": 0,
      "catchpoint-total-blocks": 0,
      "catchpoint-total-kvs": 0,
      "catchpoint-verified-accounts": 0,
      "catchpoint-verified-kvs": 0,
      "catchup-time": 0,
      "last-catchpoint": "",
      "last-round": this.round,
      "last-version": "https://github.com/algorandfoundation/specs/tree/268b63433a907455d439995bf916f6b296018f4f",
      "next-version": "https://github.com/algorandfoundation/specs/tree/268b63433a907455d439995bf916f6b296018f4f",
      "next-version-round": this.round + 1,
      "next-version-supported": true,
      "stopped-at-unsupported-round": false,
      "time-since-last-round": 1_200_000_000,
    };
  }

  assetParamsJson(a: AssetFixture) {
    const enc = (s: string) => b64(new TextEncoder().encode(s));
    const p: Json = {
      creator: a.creator,
      decimals: a.decimals ?? 0,
      "default-frozen": a.defaultFrozen ?? false,
      total: a.total ?? 1,
    };
    if (a.name !== undefined) Object.assign(p, { name: a.name, "name-b64": enc(a.name) });
    if (a.unitName !== undefined) Object.assign(p, { "unit-name": a.unitName, "unit-name-b64": enc(a.unitName) });
    if (a.url !== undefined) Object.assign(p, { url: a.url, "url-b64": enc(a.url) });
    if (a.manager) p.manager = a.manager;
    if (a.reserve) p.reserve = a.reserve;
    if (a.freeze) p.freeze = a.freeze;
    if (a.clawback) p.clawback = a.clawback;
    if (a.metadataHash) p["metadata-hash"] = a.metadataHash;
    return p;
  }

  assetJson(id: number) {
    const a = this.assets.get(id);
    if (!a) return new FakeResponse(404, { message: "asset does not exist" });
    return { index: a.index, params: this.assetParamsJson(a) };
  }

  appParamsJson(app: AppFixture) {
    const p: Json = {
      "approval-program": app.approval ?? new Uint8Array([10, 129, 1]),
      "clear-state-program": app.clear ?? new Uint8Array([10, 129, 1]),
      creator: app.creator,
      "global-state-schema": { "num-byte-slice": app.globalSchema?.bytes ?? 0, "num-uint": app.globalSchema?.ints ?? 0 },
      "local-state-schema": { "num-byte-slice": app.localSchema?.bytes ?? 0, "num-uint": app.localSchema?.ints ?? 0 },
    };
    if (app.extraPages) p["extra-program-pages"] = app.extraPages;
    if (app.globalState && Object.keys(app.globalState).length) p["global-state"] = keyValues(app.globalState);
    return p;
  }

  appJson(id: number) {
    const app = this.apps.get(id);
    if (!app) return new FakeResponse(404, { message: "application does not exist" });
    return { id, params: this.appParamsJson(app) };
  }

  accountJson(address: string, exclude?: string | null) {
    const a = this.accounts.get(address) ?? { address, amount: 0 };
    const assets = a.assets ?? [];
    const created = (a.createdAssets ?? []).map((id) => this.assets.get(id)!).filter(Boolean);
    const local = a.appsLocalState ?? [];
    const createdApps = (a.createdApps ?? []).map((id) => this.apps.get(id)!).filter(Boolean);
    const out: Json = {
      address,
      amount: a.amount ?? 0,
      "amount-without-pending-rewards": a.amount ?? 0,
      "apps-total-schema": { "num-byte-slice": 0, "num-uint": 0 },
      "min-balance": a.minBalance ?? 100_000 + 100_000 * assets.length,
      "pending-rewards": 0,
      "reward-base": 218288,
      rewards: 0,
      round: this.round,
      status: "Offline",
      "total-apps-opted-in": local.length,
      "total-assets-opted-in": assets.length,
      "total-created-apps": createdApps.length,
      "total-created-assets": created.length,
    };
    if (a.authAddr) out["auth-addr"] = a.authAddr;
    if (exclude !== "all") {
      out.assets = assets.map((h) => ({ amount: h.amount, "asset-id": h.id, "is-frozen": !!h.frozen }));
      out["created-assets"] = created.map((c) => ({ index: c.index, params: this.assetParamsJson(c) }));
      out["apps-local-state"] = local.map((l) => ({
        id: l.id,
        schema: { "num-byte-slice": 0, "num-uint": 0 },
        ...(l.state ? { "key-value": keyValues(l.state) } : {}),
      }));
      out["created-apps"] = createdApps.map((app) => ({ id: app.id, params: this.appParamsJson(app) }));
    }
    return out;
  }

  // ---- request routing ----------------------------------------------------------

  private async route(req: FakeRequest): Promise<Json | FakeResponse> {
    const full = req.url.toString();
    for (const r of this.routes) {
      if ((r.method === "*" || r.method === req.method) && r.pattern.test(full)) return r.handler(req);
    }
    const p = req.url.pathname;
    let m: RegExpMatchArray | null;
    if (req.method === "GET") {
      if (p.endsWith("/v2/transactions/params")) return this.paramsJson();
      if (p.endsWith("/v2/status")) return this.statusJson();
      if ((m = p.match(/\/v2\/status\/wait-for-block-after\/(\d+)$/))) {
        this.round = Math.max(this.round, Number(m[1]) + 1);
        return this.statusJson();
      }
      if ((m = p.match(/\/v2\/accounts\/([A-Z2-7]{58})\/assets\/(\d+)$/))) {
        const acct = this.accounts.get(m[1]);
        const h = acct?.assets?.find((x) => x.id === Number(m![2]));
        if (!h) return new FakeResponse(404, { message: "account asset info not found" });
        return { round: this.round, "asset-holding": { amount: h.amount, "asset-id": h.id, "is-frozen": !!h.frozen } };
      }
      if ((m = p.match(/\/v2\/accounts\/([A-Z2-7]{58})\/applications\/(\d+)$/))) {
        const acct = this.accounts.get(m[1]);
        const l = acct?.appsLocalState?.find((x) => x.id === Number(m![2]));
        if (!l) return new FakeResponse(404, { message: "account application info not found" });
        return {
          round: this.round,
          "app-local-state": { id: l.id, schema: { "num-byte-slice": 0, "num-uint": 0 }, ...(l.state ? { "key-value": keyValues(l.state) } : {}) },
        };
      }
      if ((m = p.match(/\/v2\/accounts\/([A-Z2-7]{58})$/))) return this.accountJson(m[1], req.url.searchParams.get("exclude"));
      if ((m = p.match(/\/v2\/assets\/(\d+)$/)) && !req.url.host.includes("idx")) return this.assetJson(Number(m[1]));
      if ((m = p.match(/\/v2\/applications\/(\d+)\/boxes$/)) && !req.url.host.includes("idx")) {
        const app = this.apps.get(Number(m[1]));
        return { boxes: Object.keys(app?.boxes ?? {}).map((k) => ({ name: b64(boxKeyBytes(k)) })) };
      }
      if ((m = p.match(/\/v2\/applications\/(\d+)\/box$/)) && !req.url.host.includes("idx")) {
        const app = this.apps.get(Number(m[1]));
        const name = req.url.searchParams.get("name") ?? "";
        const nameBytes = decodeBoxName(name);
        const key = new TextDecoder("latin1").decode(nameBytes);
        const found = app?.boxes && Object.entries(app.boxes).find(([k]) => k === key);
        if (!found) return new FakeResponse(404, { message: "box not found" });
        return { name: nameBytes, round: this.round, value: found[1] };
      }
      if ((m = p.match(/\/v2\/applications\/(\d+)$/)) && !req.url.host.includes("idx")) return this.appJson(Number(m[1]));
      if ((m = p.match(/\/v2\/transactions\/pending\/([A-Z2-7]{52})$/))) return this.pending(m[1]);
    }
    if (req.method === "POST") {
      if (p.endsWith("/v2/transactions")) return this.submit(req.body!);
      if (p.endsWith("/v2/transactions/simulate")) return this.simulate(req);
      if (p.endsWith("/v2/teal/compile")) {
        const src = new TextDecoder().decode(req.body!);
        const bytes = new TextEncoder().encode(src);
        const prog = new Uint8Array([10, ...bytes.slice(0, 16)]);
        return { hash: algosdk.encodeAddress(new Uint8Array(32).fill(bytes.length % 256)), result: b64(prog) };
      }
    }
    throw new Error(`fakeChain: unmocked request ${req.method} ${full}`);
  }

  private submit(body: Uint8Array) {
    const chunks = decodeMulti(body);
    const start = this.sent.length;
    for (const c of chunks) {
      const stxn = algosdk.decodeSignedTransaction(c.bytes);
      this.sent.push({ txID: stxn.txn.txID().toString(), bytes: c.bytes, raw: c.value });
    }
    return { txId: this.sent[start].txID };
  }

  private simulate(req: FakeRequest) {
    const decoded: any = req.json ?? new Decoder({ useBigInt64: true }).decode(req.body!);
    const groups: any[][] = (decoded["txn-groups"] ?? []).map((g: any) => g.txns);
    const zeroAddr = new Uint8Array(32);
    const txnGroups = groups.map((group) => {
      const call = this.simulated.length;
      this.simulated.push(group);
      const res = this.simulateHook?.(group, call) ?? {};
      const out: Json = {
        "txn-results": group.map((stxn, i) => {
          const info = res.txns?.[i] ?? {};
          const inner = Array.from({ length: info.inner ?? 0 }, () => ({
            "pool-error": "",
            txn: { txn: { type: "pay", snd: zeroAddr, fv: this.round, lv: this.round + 10 } },
          }));
          const r: Json = { "pool-error": "", txn: stxn };
          if (inner.length) r["inner-txns"] = inner;
          if (info.logs?.length) r.logs = info.logs;
          return { "txn-result": r, "app-budget-consumed": stxn.txn.type === "appl" ? 100 : undefined };
        }),
        "app-budget-added": group.filter((s) => s.txn.type === "appl").length * 700,
        "app-budget-consumed": group.filter((s) => s.txn.type === "appl").length * 100,
      };
      if (res.failure) {
        out["failure-message"] = res.failure;
        out["failed-at"] = [0];
      }
      if (res.unnamed) out["unnamed-resources-accessed"] = res.unnamed;
      return out;
    });
    return {
      version: 2,
      "last-round": this.round,
      "txn-groups": txnGroups,
      "eval-overrides": { "allow-empty-signatures": true, "allow-unnamed-resources": true },
    };
  }

  private pending(txid: string) {
    const idx = this.sent.findIndex((s) => s.txID === txid);
    if (idx < 0) return new FakeResponse(404, { message: "txn not found" });
    const s = this.sent[idx];
    const extra: Record<string, any> = this.confirmHook?.(s, idx) ?? {};
    const t = s.raw.txn;
    if (t.type === "acfg" && !t.caid && extra["asset-index"] === undefined) extra["asset-index"] = this.nextAssetId++;
    if (t.type === "appl" && !t.apid && extra["application-index"] === undefined) extra["application-index"] = this.nextAppId++;
    return { "confirmed-round": this.round, "pool-error": "", txn: s.raw, ...extra };
  }

  // ---- fetch shim ---------------------------------------------------------------------

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : input.toString());
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    let body: Uint8Array | null = null;
    const rawBody = init?.body ?? (request ? await request.arrayBuffer() : null);
    if (rawBody != null) {
      if (typeof rawBody === "string") body = new TextEncoder().encode(rawBody);
      else if (rawBody instanceof Uint8Array) body = rawBody;
      else if (rawBody instanceof ArrayBuffer) body = new Uint8Array(rawBody);
      else if (ArrayBuffer.isView(rawBody)) body = new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
      else body = new Uint8Array(await new Response(rawBody as BodyInit).arrayBuffer());
      if (body.byteLength === 0) body = null;
    }
    let json: any = undefined;
    if (body && (headers.get("content-type") ?? "").includes("json")) {
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch {
        /* not json */
      }
    }
    const wantsMsgpack =
      url.searchParams.get("format") === "msgpack" || (headers.get("accept") ?? "").includes("msgpack");
    this.requests.push(`${method} ${url.origin}${url.pathname}${url.search}`);
    const result = await this.route({ method, url, body, json, wantsMsgpack });
    const res = result instanceof FakeResponse ? result : new FakeResponse(200, result);
    if (res.body instanceof Uint8Array) {
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/octet-stream" } });
    }
    if (typeof res.body === "string") {
      return new Response(res.body, { status: res.status, headers: { "content-type": "text/plain" } });
    }
    if (wantsMsgpack) {
      return new Response(mpEncode(res.body, { useBigInt64: true, ignoreUndefined: true }), {
        status: res.status,
        headers: { "content-type": "application/msgpack" },
      });
    }
    return new Response(toAlgodJson(res.body), { status: res.status, headers: { "content-type": "application/json" } });
  };
}

function decodeBoxName(name: string): Uint8Array {
  const [enc, value] = name.includes(":") ? [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)] : ["str", name];
  if (enc === "b64") return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(value);
}

/** Box-name helper that matches FakeChain's latin1 key lookup for binary names. */
export const boxKey = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

// "latin1" decodes as windows-1252, which maps 0x80–0x9F to other code points; invert it exactly.
const BYTE_FOR_CHAR = new Map(Array.from({ length: 256 }, (_, b) => [boxKey(new Uint8Array([b])), b] as const));

/** Inverse of boxKey: the raw box name bytes for a fixture key. */
export const boxKeyBytes = (key: string) => Uint8Array.from(key, (c) => BYTE_FOR_CHAR.get(c) ?? c.charCodeAt(0));

export { addr };
