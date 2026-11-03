import Papa from "papaparse";

const ADDRESS_HEADERS = ["receiver", "address", "recipient", "to", "wallet"];
const AMOUNT_HEADERS = ["amount", "value", "quantity", "qty"];

const indexOfHeader = (header: string[], names: string[]) =>
  header.findIndex((h) => names.includes(h.trim().toLowerCase()));

export const CSV_TEMPLATE = "receiver,amount\nmn_addr_...,10\nmn_addr_...,2.5\n";

/**
 * Turns a CSV into the `address, amount` lines the send form parses, so a CSV goes through the
 * same validation as typed recipients. A header row is optional: without one, column 1 is the
 * address and column 2 (if present) the amount. The amount column may be left empty to use the
 * form's default amount.
 */
export function csvToRecipientText(csv: string): { text: string; rows: number; error?: string } {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });
  const data = parsed.data.filter((r) => r.some((c) => c.trim() !== ""));
  if (data.length === 0) return { text: "", rows: 0, error: "The CSV is empty" };

  const first = data[0].map((c) => c.trim());
  const addrCol = indexOfHeader(first, ADDRESS_HEADERS);
  const hasHeader = addrCol !== -1;
  let amountCol = hasHeader ? indexOfHeader(first, AMOUNT_HEADERS) : 1;
  const addressCol = hasHeader ? addrCol : 0;
  if (hasHeader && amountCol === -1 && first.length > 1) amountCol = addressCol === 0 ? 1 : 0;

  const body = hasHeader ? data.slice(1) : data;
  const lines = body.map((row) => {
    const address = (row[addressCol] ?? "").trim();
    const amount = amountCol >= 0 ? (row[amountCol] ?? "").trim() : "";
    return amount ? `${address}, ${amount}` : address;
  });
  return { text: lines.join("\n"), rows: lines.length };
}
