import { atom } from "jotai";
import type { AgentListing } from "../types/agent";

/** Cached list of all active agent listings */
export const agentListingsAtom = atom<AgentListing[]>([]);

/** Whether listings are currently being fetched */
export const agentListingsLoadingAtom = atom<boolean>(true);
