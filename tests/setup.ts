import axios from "axios";
import { afterEach, beforeEach, vi } from "vitest";
import { FakeChain } from "./fakeChain";

declare global {
  // eslint-disable-next-line no-var
  var chain: FakeChain;
  /** Call in a test that expects the code under test to console.error. */
  // eslint-disable-next-line no-var
  var allowConsoleErrors: () => void;
}

// Route axios through fetch so the fake chain sees its requests too.
axios.defaults.adapter = "fetch";

// Many builders catch and console.error per-item failures, then return fewer txns.
// Fail any test where that happens unexpectedly so swallowed SDK errors can't hide.
let consoleErrors: unknown[][] = [];
let errorsAllowed = false;
globalThis.allowConsoleErrors = () => {
  errorsAllowed = true;
};

beforeEach(() => {
  consoleErrors = [];
  errorsAllowed = false;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    consoleErrors.push(args);
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  globalThis.chain = new FakeChain();
  vi.stubGlobal("fetch", globalThis.chain.fetch);
  // Notes embed Math.random() suffixes; pin them so txIDs are stable.
  vi.spyOn(Math, "random").mockReturnValue(0.123456789);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (!errorsAllowed && consoleErrors.length) {
    const first = consoleErrors[0].map((a) => (a instanceof Error ? a.stack : String(a))).join(" ");
    throw new Error(`Unexpected console.error (${consoleErrors.length}x): ${first}`);
  }
});
