/**
 * Vote Tool — frontend helpers on top of voteCore.
 */

import type { VoteNetwork } from "./voteCore";

export * from "./voteCore";
export { signAndSend, toSaleNetwork as toVoteNetwork } from "./wenpadSale";
export { getCurrentRound } from "./wenpadSaleCore";

const FACTORY_IDS: Record<VoteNetwork, number> = {
  // Both factories: AVM v13, 7 extra pages + reserved state, admin WENFZ…UEZ2U (upgrade in place: contracts/deploy-vote-tool.ts <network> upgrade <id>)
  mainnet: Number(import.meta.env.VITE_VOTE_FACTORY_APP_ID_MAINNET || 3748290680),
  testnet: Number(import.meta.env.VITE_VOTE_FACTORY_APP_ID_TESTNET || 774611327),
};

export const getVoteFactoryId = (network: VoteNetwork) => FACTORY_IDS[network];

/**
 * Ask the keeper to look at a vote (api/vote-keeper.ts): recount moved ballots while it's live,
 * settle it once it has ended. Fire-and-forget; anyone can still run every step from the page.
 */
export function requestVoteKeeper(network: VoteNetwork, appId: number) {
  fetch("/api/vote-keeper", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ network, appId }),
  }).catch(() => {
    // best effort
  });
}

/**
 * sha512_256("Program" ‖ approval) of every Vote template the factory has shipped. A vote whose
 * program isn't listed was upgraded by its creator before voting started: the page warns about it.
 * tests/voteTool.test.ts checks the newest entry matches contracts/build/vote/Vote.approval.bin.
 */
export { KNOWN_VOTE_TEMPLATES } from "./voteTemplates";
