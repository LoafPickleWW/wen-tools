import { DesiredOutput, MidnightKind } from "./types";

/**
 * Midnight caps a transaction at 1 MiB and a block at 200,000 broadcast bytes, but there is no
 * fixed output count: size depends on the outputs. Shielded outputs carry proofs and are much
 * heavier, so they start smaller. Oversized batches are halved automatically (see sendInBatches).
 */
export const START_BATCH_SIZE: Record<MidnightKind, number> = {
  unshielded: 20,
  shielded: 5,
};

/** A block is ~6s, so ~6 retries covers the previous transaction confirming and freeing locked UTXOs. */
export const RETRY_DELAY_MS = 6000;
export const MAX_RETRIES = 6;

/** "exceeded block limit in transaction fee computation" / MalformedTransaction::TransactionTooLarge */
export function isSizeError(message: string): boolean {
  return /block limit|TransactionTooLarge|too large/i.test(message);
}

/**
 * The wallet locks the DUST and NIGHT UTXOs it just spent until that transaction confirms, so
 * the next batch can fail with "could not balance dust" even when funds are sufficient.
 */
export function isRetryableFunds(message: string): boolean {
  return /could not balance dust|insufficient funds|locked/i.test(message);
}

export type BatchStatus = "pending" | "sending" | "waiting" | "sent" | "failed";

export interface BatchRow {
  id: number;
  count: number;
  status: BatchStatus;
  message?: string;
}

export interface SendBatchesOptions {
  outputs: DesiredOutput[];
  batchSize: number;
  makeTransfer: (outputs: DesiredOutput[]) => Promise<{ tx: string }>;
  submit: (tx: string) => Promise<void>;
  onUpdate: (rows: BatchRow[]) => void;
  wait?: (ms: number) => Promise<void>;
}

export interface SendBatchesResult {
  sent: number;
  failedMessage?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends outputs in sequential transactions. A batch that is too large is split in half and both
 * halves retried; a batch that fails on locked funds is retried after a block. Any other error
 * (including the user rejecting in the wallet) stops the run so nothing else is sent.
 */
export async function sendInBatches(opts: SendBatchesOptions): Promise<SendBatchesResult> {
  const { outputs, batchSize, makeTransfer, submit, onUpdate, wait = sleep } = opts;

  let nextId = 0;
  const queue: { id: number; outputs: DesiredOutput[] }[] = [];
  for (let i = 0; i < outputs.length; i += batchSize) {
    queue.push({ id: nextId++, outputs: outputs.slice(i, i + batchSize) });
  }
  let rows: BatchRow[] = queue.map((b) => ({ id: b.id, count: b.outputs.length, status: "pending" }));
  const patch = (id: number, change: Partial<BatchRow>) => {
    rows = rows.map((r) => (r.id === id ? { ...r, ...change } : r));
    onUpdate(rows);
  };
  onUpdate(rows);

  let sent = 0;
  while (queue.length > 0) {
    const batch = queue.shift()!;
    let attempt = 0;
    let done = false;
    while (!done) {
      patch(batch.id, { status: "sending", message: undefined });
      try {
        const { tx } = await makeTransfer(batch.outputs);
        await submit(tx);
        patch(batch.id, { status: "sent" });
        sent += batch.outputs.length;
        done = true;
      } catch (e) {
        const message = (e as Error)?.message || "Transfer failed";
        if (isSizeError(message) && batch.outputs.length > 1) {
          const mid = Math.ceil(batch.outputs.length / 2);
          const halves = [batch.outputs.slice(0, mid), batch.outputs.slice(mid)].map((o) => ({
            id: nextId++,
            outputs: o,
          }));
          const at = rows.findIndex((r) => r.id === batch.id);
          rows = [
            ...rows.slice(0, at),
            ...halves.map((h) => ({ id: h.id, count: h.outputs.length, status: "pending" as const })),
            ...rows.slice(at + 1),
          ];
          onUpdate(rows);
          queue.unshift(...halves);
          done = true;
        } else if (isRetryableFunds(message) && attempt < MAX_RETRIES) {
          attempt++;
          patch(batch.id, { status: "waiting", message: `waiting for funds to unlock (${attempt}/${MAX_RETRIES})` });
          await wait(RETRY_DELAY_MS);
        } else {
          patch(batch.id, { status: "failed", message });
          return { sent, failedMessage: message };
        }
      }
    }
  }
  return { sent };
}
