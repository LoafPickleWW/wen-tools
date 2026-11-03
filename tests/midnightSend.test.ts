import { describe, expect, it, vi } from "vitest";
import { MAX_RETRIES, sendInBatches } from "../src/midnight/send";
import { DesiredOutput } from "../src/midnight/types";

const outputs = (n: number): DesiredOutput[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: "unshielded" as const,
    type: "0".repeat(64),
    value: BigInt(i + 1),
    recipient: `r${i}`,
  }));

const noWait = () => Promise.resolve();

describe("sendInBatches", () => {
  it("chunks by batch size and submits each in order", async () => {
    const sizes: number[] = [];
    const submit = vi.fn(async () => {});
    const res = await sendInBatches({
      outputs: outputs(25),
      batchSize: 10,
      makeTransfer: async (o) => {
        sizes.push(o.length);
        return { tx: "t" };
      },
      submit,
      onUpdate: () => {},
      wait: noWait,
    });
    expect(sizes).toEqual([10, 10, 5]);
    expect(res).toEqual({ sent: 25 });
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("splits a batch in half when it exceeds the block limit, without dropping or duplicating outputs", async () => {
    const delivered: string[] = [];
    let last: { id: number; count: number; status: string }[] = [];
    const res = await sendInBatches({
      outputs: outputs(8),
      batchSize: 8,
      makeTransfer: async (o) => {
        if (o.length > 3) throw new Error("exceeded block limit in transaction fee computation");
        delivered.push(...o.map((x) => x.recipient));
        return { tx: "t" };
      },
      submit: async () => {},
      onUpdate: (rows) => (last = rows),
      wait: noWait,
    });
    expect(res.sent).toBe(8);
    expect(delivered.sort()).toEqual(outputs(8).map((o) => o.recipient).sort());
    expect(last.every((r) => r.status === "sent")).toBe(true);
    expect(last.reduce((s, r) => s + r.count, 0)).toBe(8);
  });

  it("fails a single output that is still too large instead of looping", async () => {
    const res = await sendInBatches({
      outputs: outputs(1),
      batchSize: 1,
      makeTransfer: async () => {
        throw new Error("TransactionTooLarge");
      },
      submit: async () => {},
      onUpdate: () => {},
      wait: noWait,
    });
    expect(res.sent).toBe(0);
    expect(res.failedMessage).toMatch(/TooLarge/);
  });

  it("waits and retries when DUST is locked by the previous transaction", async () => {
    let calls = 0;
    const wait = vi.fn(noWait);
    const res = await sendInBatches({
      outputs: outputs(2),
      batchSize: 1,
      makeTransfer: async () => {
        calls++;
        if (calls === 2 || calls === 3) throw new Error("Insufficient Funds: could not balance dust");
        return { tx: "t" };
      },
      submit: async () => {},
      onUpdate: () => {},
      wait,
    });
    expect(res).toEqual({ sent: 2 });
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry limit when funds never unlock", async () => {
    const wait = vi.fn(noWait);
    const res = await sendInBatches({
      outputs: outputs(1),
      batchSize: 1,
      makeTransfer: async () => {
        throw new Error("Insufficient Funds: could not balance dust");
      },
      submit: async () => {},
      onUpdate: () => {},
      wait,
    });
    expect(res.sent).toBe(0);
    expect(wait).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it("stops on a wallet rejection and sends nothing further", async () => {
    const makeTransfer = vi.fn(async () => {
      throw new Error("User rejected the request");
    });
    const res = await sendInBatches({
      outputs: outputs(30),
      batchSize: 10,
      makeTransfer,
      submit: async () => {},
      onUpdate: () => {},
      wait: noWait,
    });
    expect(makeTransfer).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(0);
  });
});
