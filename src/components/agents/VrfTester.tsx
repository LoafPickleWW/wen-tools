import { useState } from "react";
import { VrfTestParams } from "../../types/agent";

/**
 * Simple UI for testing the X402 VRF endpoint.
 * Allows a user to pick a mode (1‑6), optionally provide extra JSON fields,
 * and view the raw response.
 */
export function VrfTester() {
  const [mode, setMode] = useState<number>(1);
  const [extraJson, setExtraJson] = useState<string>("{}\n");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endpoint = "https://x402-vrf-agent.vercel.app/api/vrf/random";

  const buildPayload = (): VrfTestParams => {
    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(extraJson);
    } catch {
      // ignore, validation will catch malformed JSON later
    }
    return { mode, ...extra };
  };

  const isValid = (payload: VrfTestParams): boolean => {
    if (!Number.isInteger(payload.mode) || payload.mode < 1 || payload.mode > 6) {
      setError("Mode must be an integer between 1 and 6.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const payload = buildPayload();
    if (!isValid(payload)) return;
    setLoading(true);
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await resp.text();
      if (!resp.ok) {
        setError(`❌ ${resp.status} ${resp.statusText}\n${txt}`);
      } else {
        try {
          const json = JSON.parse(txt);
          setResult(JSON.stringify(json, null, 2));
        } catch {
          setResult(txt);
        }
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto my-8 p-6 bg-neutral-900/60 backdrop-blur-sm rounded-2xl border border-neutral-800 shadow-xl">
      <h2 className="text-xl font-bold mb-4 text-white">X402 VRF Agent Tester</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-gray-300 mb-1 block">Mode (1‑6)</span>
          <select
            value={mode}
            onChange={e => setMode(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-neutral-700 bg-neutral-800 p-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[1,2,3,4,5,6].map(n => (
              <option key={n} value={n}>Mode {n}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-gray-300 mb-1 block">Additional JSON (optional)</span>
          <textarea
            rows={6}
            value={extraJson}
            onChange={e => setExtraJson(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-800 p-2 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder='e.g. {"seed":"0x1234"}'
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className={`w-full py-2 rounded-md text-white font-medium ${loading ? "bg-neutral-600" : "bg-blue-600 hover:bg-blue-500"} transition-colors`}
        >
          {loading ? "Sending…" : "Send Request"}
        </button>
      </form>
      {error && (
        <pre className="mt-4 p-3 bg-red-900/60 text-red-200 rounded-md overflow-x-auto whitespace-pre-wrap">
          {error}
        </pre>
      )}
      {result && (
        <pre className="mt-4 p-3 bg-neutral-800/60 text-green-200 rounded-md overflow-x-auto whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  );
}
