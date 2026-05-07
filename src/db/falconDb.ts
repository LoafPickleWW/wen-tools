/**
 * Falcon Account Storage
 *
 * Uses Dexie (IndexedDB) to persist Falcon keypairs locally.
 * You already have Dexie as a dependency in wen-tools.
 */

import Dexie, { type Table } from "dexie";
import type { FalconAccount } from "../utils/falcon";

class FalconDB extends Dexie {
  accounts!: Table<FalconAccount, number>;

  constructor() {
    super("wentools-falcon");
    this.version(1).stores({
      // id is auto-incremented, indexed on address and network
      accounts: "++id, address, network, createdAt",
    });
  }
}

export const falconDb = new FalconDB();

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export async function getAllAccounts(): Promise<FalconAccount[]> {
  return falconDb.accounts.orderBy("createdAt").reverse().toArray();
}

export async function getAccount(id: number): Promise<FalconAccount | undefined> {
  return falconDb.accounts.get(id);
}

export async function getAccountByAddress(
  address: string,
): Promise<FalconAccount | undefined> {
  return falconDb.accounts.where("address").equals(address).first();
}

export async function saveAccount(account: FalconAccount): Promise<number> {
  return falconDb.accounts.add(account);
}

export async function deleteAccount(id: number): Promise<void> {
  return falconDb.accounts.delete(id);
}

export async function clearAllAccounts(): Promise<void> {
  return falconDb.accounts.clear();
}
