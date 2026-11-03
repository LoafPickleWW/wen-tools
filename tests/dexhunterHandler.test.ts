import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/dexhunter";

const KEY = "super-secret-partner-key";
const NIGHT = "bb".repeat(28) + "4e49474854";
const ADDR = "addr1q" + "x".repeat(60);

function call(method: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = {
    code: 0,
    payload: undefined as unknown,
    headers: {} as Record<string, string>,
    status(c: number) {
      this.code = c;
      return this;
    },
    json(p: unknown) {
      this.payload = p;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
  };
  const req = { method, body, headers: { host: "www.wen.tools", ...headers } };
  return handler(req as never, res as never).then(() => res);
}

const upstream = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) }));

describe("api/dexhunter", () => {
  beforeEach(() => {
    process.env.DEXHUNTER_PARTNER_ID = KEY;
    process.env.NIGHT_TOKEN_ID = NIGHT;
  });
  afterEach(() => {
    delete process.env.DEXHUNTER_PARTNER_ID;
    delete process.env.NIGHT_TOKEN_ID;
    vi.unstubAllGlobals();
  });

  it("GET reports configuration and the asset, never the key", async () => {
    const res = await call("GET");
    expect(res.payload).toEqual({ configured: true, tokenId: NIGHT });
    expect(JSON.stringify(res.payload)).not.toContain(KEY);
  });

  it("is unconfigured and refuses swaps when either env var is missing", async () => {
    delete process.env.NIGHT_TOKEN_ID;
    expect((await call("GET")).payload).toEqual({ configured: false });
    expect((await call("POST", { step: "estimate", amount_in: 10, slippage: 1 })).code).toBe(503);
  });

  it("forwards a validated estimate with the key and the forced NIGHT token", async () => {
    const fetchMock = upstream(200, { total_output: 90, total_output_without_slippage: 91 });
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("POST", { step: "estimate", amount_in: 25, slippage: 1, token_out: "evil" });
    expect(res.code).toBe(200);
    expect(res.payload).toEqual({ total_output: 90, total_output_without_slippage: 91 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-us.dexhunterv3.app/swap/estimate");
    expect((init.headers as Record<string, string>)["X-Partner-Id"]).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      token_in: "",
      token_out: NIGHT,
      amount_in: 25,
      slippage: 1,
      blacklisted_dexes: [],
    });
  });

  it("accepts a JSON string body as the dev server provides", async () => {
    vi.stubGlobal("fetch", upstream(200, { cbor: "84a1" }));
    const res = await call("POST", JSON.stringify({ step: "build", amount_in: 5, slippage: 1, buyer_address: ADDR }));
    expect(res.code).toBe(200);
  });

  it("rejects bad input and other sites without calling DexHunter", async () => {
    const fetchMock = upstream(200, {});
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("POST", { step: "estimate", amount_in: 0, slippage: 1 })).code).toBe(400);
    expect((await call("POST", { step: "estimate", amount_in: 10, slippage: 1 }, { origin: "https://evil.example" })).code).toBe(403);
    expect((await call("DELETE")).code).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps upstream failures to safe errors that never include the key", async () => {
    vi.stubGlobal("fetch", upstream(500, { message: "internal", detail: KEY }));
    const res = await call("POST", { step: "estimate", amount_in: 10, slippage: 1 });
    expect(res.code).toBe(502);
    expect(JSON.stringify(res.payload)).not.toContain(KEY);

    vi.stubGlobal("fetch", upstream(429, { message: "slow down" }));
    expect((await call("POST", { step: "estimate", amount_in: 10, slippage: 1 })).code).toBe(429);

    vi.stubGlobal("fetch", upstream(200, "<html>not json</html>"));
    expect((await call("POST", { step: "estimate", amount_in: 10, slippage: 1 })).code).toBe(502);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(`connect failed with ${KEY}`); }));
    const failed = await call("POST", { step: "estimate", amount_in: 10, slippage: 1 });
    expect(failed.code).toBe(504);
    expect(JSON.stringify(failed.payload)).not.toContain(KEY);
  });
});
