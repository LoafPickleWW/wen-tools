import * as algosdk from "algosdk";
import axios from "axios";
import { MAINNET_ALGONODE_INDEXER, XGOV_REGISTRY_APP_IDS } from "../constants";

export interface XGovProposal {
  appId: number;
  title: string;
  proposer: string;
  requestedAmount: number;
  status: number;
  finalized: boolean;
  metadataUploaded: boolean;
  openTs: number;
  voteOpenTs: number;
  votingDuration: number;
  description?: string;
  totalApprovals: number;
  totalRejections: number;
  totalBoycotts: number;
  voterCount: number;
  parsedDescription?: {
    description?: string;
    team?: string;
    additionalInfo?: string;
    forumLink?: string;
    adoptionMetrics?: string[];
    openSource?: boolean;
  };
}

export const XGOV_STATUS = {
  EMPTY: 0,
  DRAFT: 10,
  SUBMITTED: 20,
  VOTING: 25,
  APPROVED: 30,
  REJECTED: 40,
  REVIEWED: 45,
  FUNDED: 50,
  BLOCKED: 60,
};

/**
 * Decode an ABI-encoded bytes value from the Algorand global state.
 * AlgoKit/ABI contracts store byte strings with a 2-byte uint16 length prefix:
 *   [length_high_byte, length_low_byte, ...actual_bytes]
 * This function strips that prefix if detected.
 */
function decodeAbiBytes(base64Val: string): Buffer {
  const buf = Buffer.from(base64Val, 'base64');
  if (buf.length >= 2) {
    const declaredLen = (buf[0] << 8) | buf[1];
    // If the first 2 bytes encode a length that matches the remaining bytes, strip them
    if (declaredLen === buf.length - 2 && declaredLen > 0) {
      return buf.slice(2);
    }
  }
  return buf;
}

/**
 * Decode an ABI-encoded string value from global state.
 */
function decodeAbiString(base64Val: string): string {
  return decodeAbiBytes(base64Val).toString('utf8').replace(/\0/g, '').trim();
}

export async function fetchAllProposals(): Promise<XGovProposal[]> {
  const allApps: any[] = [];
  
  for (const registryId of XGOV_REGISTRY_APP_IDS) {
    const registryAddress = algosdk.getApplicationAddress(registryId);
    let nextToken = "";
    
    // Fetch up to 1000 apps (or handle with limit if needed)
    while (true) {
      try {
        const url = `${MAINNET_ALGONODE_INDEXER}/v2/applications?creator=${registryAddress}&limit=100${nextToken ? `&next=${encodeURIComponent(nextToken)}` : ""}`;
        const response = await axios.get(url);
        allApps.push(...response.data.applications);
        nextToken = response.data['next-token'];
        if (!nextToken || allApps.length >= 2000) break;
      } catch (e) {
        console.error(`Failed to fetch apps for registry ${registryId}`, e);
        break;
      }
    }
  }

  // Reverse to get newest first (highest ID first)
  allApps.sort((a, b) => b.id - a.id);

  const proposals: XGovProposal[] = [];
  const batchSize = 10;

  for (let i = 0; i < allApps.length; i += batchSize) {
    const batch = allApps.slice(i, i + batchSize);
    await Promise.all(batch.map(async (appListing) => {
      try {
        const appRes = await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${appListing.id}`);
        const app = appRes.data.application;
        const globalState = app.params["global-state"] || [];
        const stateMap: Record<string, any> = {};

        globalState.forEach((item: any) => {
          try {
            const key = Buffer.from(item.key, 'base64').toString('utf8').replace(/\0/g, '').trim();
            const value = item.value.type === 2 ? item.value.uint : item.value.bytes;
            stateMap[key] = value;
            stateMap[key.toLowerCase()] = value;
          } catch {
            const value = item.value.type === 2 ? item.value.uint : item.value.bytes;
            stateMap[item.key] = value;
          }
        });

        // --- GET TITLE ---
        // The title is stored as ABI-encoded bytes in global state under key "title".
        // ABI encoding = [2-byte uint16 length prefix][actual string bytes]
        let title = "";
        const titleVal = stateMap["title"];
        if (titleVal && typeof titleVal === 'string') {
          try {
            title = decodeAbiString(titleVal);
          } catch { /* ignore */ }
        }

        // --- GET PROPOSER ---
        // The proposer address is stored as ABI-encoded bytes: [0, 32, ...32 address bytes]
        // Total = 34 bytes. We need to strip the 2-byte ABI prefix to get the 32-byte public key.
        let proposerAddr = "";
        const proposerVal = stateMap["proposer"];
        if (proposerVal && typeof proposerVal === 'string') {
          try {
            const addrBytes = decodeAbiBytes(proposerVal);
            if (addrBytes.length === 32) {
              proposerAddr = algosdk.encodeAddress(addrBytes);
            }
          } catch { /* ignore */ }
        }
        
        // Fallback: use app creator from indexer
        if (!proposerAddr) {
          proposerAddr = app.params?.creator || "";
        }

        const approvals = stateMap["approvals"] || 0;
        const rejections = stateMap["rejections"] || 0;
        const boycotts = stateMap["boycotts"] || stateMap["boycotted_members"] || 0;
        const voterCount = stateMap["voted_members"] || stateMap["assigned_members"] || 0;

        proposals.push({
          appId: app.id,
          title: title || `Proposal #${app.id}`,
          proposer: proposerAddr,
          requestedAmount: stateMap["requested_amount"] || 0,
          status: stateMap["status"] || 0,
          finalized: !!stateMap["finalized"],
          metadataUploaded: !!stateMap["metadata_uploaded"],
          openTs: stateMap["open_timestamp"] || 0,
          voteOpenTs: stateMap["vote_opening_timestamp"] || 0,
          votingDuration: stateMap["voting_duration"] || 0,
          totalApprovals: Number(approvals),
          totalRejections: Number(rejections),
          totalBoycotts: Number(boycotts),
          voterCount: Number(voterCount)
        });
      } catch (err) {
        console.error(`Failed to fetch full data for app ${appListing.id}`, err);
      }
    }));
    // Small delay to avoid rate limiting
    if (i + batchSize < allApps.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return proposals.sort((a, b) => b.appId - a.appId);
}

export async function fetchProposalDescription(appId: number): Promise<XGovProposal['parsedDescription']> {
  // Box key is "M" for metadata
  const boxKey = new Uint8Array(Buffer.from("M"));
  try {
    const response = await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/box?name=b64:${encodeURIComponent(Buffer.from(boxKey).toString('base64'))}`);
    const value = response.data.value;
    const raw = Buffer.from(value, 'base64').toString('utf8');
    try {
      return JSON.parse(raw);
    } catch {
      return { description: raw };
    }
  } catch {
    return { description: "Description not available." };
  }
}

export async function fetchRegistryPower(_userAddress: string): Promise<number> {
  // xGov power is not stored in the registry boxes (which contain metadata).
  // It is assigned per-proposal in the proposal's voter boxes.
  // We return 0 here to avoid reading garbage data from metadata boxes.
  return 0;
}

export async function fetchVoterData(appId: number, userAddress: string): Promise<{ power: number; voted: boolean; choice?: "APPROVE" | "REJECT" | "BOYCOTT" | "ABSTAIN" | "SPLIT" }> {
  const addrBytes = algosdk.decodeAddress(userAddress).publicKey;
  const proposalBoxKey = new Uint8Array(33);
  proposalBoxKey[0] = 0x56; // 'V' prefix
  proposalBoxKey.set(addrBytes, 1);
  const proposalBoxKeyBase64 = Buffer.from(proposalBoxKey).toString('base64');
  
  // Try fetching the voter box directly - handle 404 gracefully
  try {
    const valRes = await axios.get(
      `${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/box?name=b64:${encodeURIComponent(proposalBoxKeyBase64)}`
    );
    const buf = Buffer.from(valRes.data.value, 'base64');
    
    let power = 0;
    let choice: "APPROVE" | "REJECT" | "BOYCOTT" | "ABSTAIN" | "SPLIT" = "APPROVE";

    // v3.0.0 format: 24 bytes = [approvals(8) | rejections(8) | boycotts(8)]
    if (buf.length >= 24) {
      const approvals = Number(buf.readBigUInt64BE(0));
      const rejections = Number(buf.readBigUInt64BE(8));
      const boycotts = Number(buf.readBigUInt64BE(16));
      power = approvals + rejections + boycotts;
      if (power > 0) {
        if (boycotts > 0 && approvals === 0 && rejections === 0) choice = "BOYCOTT";
        else if (rejections > 0 && approvals === 0) choice = "REJECT";
        else if (approvals > 0 && rejections === 0) choice = "APPROVE";
        else choice = "SPLIT";
        return { power, voted: true, choice };
      }
    }
    // v2 format: 16 bytes = [approvals(8) | rejections(8)]
    else if (buf.length >= 16) {
      const approvals = Number(buf.readBigUInt64BE(0));
      const rejections = Number(buf.readBigUInt64BE(8));
      power = approvals + rejections;
      if (power > 0) {
        if (rejections > 0 && approvals === 0) choice = "REJECT";
        else if (approvals > 0 && rejections > 0) choice = "SPLIT";
        else choice = "APPROVE";
        return { power, voted: true, choice };
      }
    }
    // Older format: 8 bytes = single uint64 (power or choice enum)
    else if (buf.length >= 8) {
      const val = Number(buf.readBigUInt64BE(0));
      // Small values (0-3) are likely choice enums, not power
      if (val <= 3) {
        if (val === 0) choice = "ABSTAIN";
        else if (val === 1) choice = "APPROVE";
        else if (val === 2) choice = "REJECT";
        else if (val === 3) choice = "BOYCOTT";
        // For enum-style boxes, get actual power from registry
        try {
          const registryPower = await fetchRegistryPower(userAddress);
          return { power: registryPower, voted: true, choice };
        } catch {
          // Even if registry power fails, we KNOW they voted (box exists!)
          return { power: 0, voted: true, choice };
        }
      } else {
        power = val;
        choice = "APPROVE";
      }
    }
    
    // Safety check: if power is unreasonably high (more than total ALGO supply), 
    // it might be a different data format in the box. Fallback to registry power.
    if (power > 10_000_000_000_000_000) {
      try {
        const registryPower = await fetchRegistryPower(userAddress);
        return { power: registryPower, voted: true, choice };
      } catch {
        // Even if registry lookup fails, the box EXISTS so they voted
        return { power: 0, voted: true, choice };
      }
    }

    // Box exists but might be empty (8-byte format or unvoted 16/24-byte).
    // Use transaction scan to confirm if they actually voted.
    const txChoice = await fetchUserVoteChoice(appId, userAddress);
    if (txChoice) {
      return { power, voted: true, choice: txChoice as any };
    }

    return { power, voted: false };
  } catch (boxErr: any) {
    // 404/400 means box doesn't exist - definitely not voted
    if (boxErr?.response?.status === 404 || boxErr?.response?.status === 400) {
      try {
        const registryPower = await fetchRegistryPower(userAddress);
        return { power: registryPower, voted: false };
      } catch {
        return { power: 0, voted: false };
      }
    }
    console.error(`[fetchVoterData] Unexpected error for app ${appId}, user ${userAddress}:`, boxErr?.message || boxErr);
    return { power: 0, voted: false };
  }
}

export async function checkIsXGov(userAddress: string): Promise<boolean> {
  const addrBytes = algosdk.decodeAddress(userAddress).publicKey;
  const prefixes = [Buffer.from("x"), Buffer.from("X")];
  
  for (const registryId of XGOV_REGISTRY_APP_IDS) {
    for (const prefix of prefixes) {
      const boxKey = Buffer.concat([prefix, addrBytes]);
      try {
        await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${registryId}/box?name=b64:${encodeURIComponent(boxKey.toString('base64'))}`);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}



export async function fetchUserVotingPower(appId: number, userAddress: string): Promise<number> {
  const data = await fetchVoterData(appId, userAddress);
  return data.power;
}

export async function checkHasVoted(appId: number, userAddress: string): Promise<string | null> {
  const data = await fetchVoterData(appId, userAddress);
  return data.voted ? "VOTED" : null;
}

export async function fetchUserVoteChoice(appId: number, userAddress: string): Promise<string | null> {
  try {
    // Search for transactions to ANY Registry app by this user that involve this proposal
    const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${userAddress}&tx-type=appl&limit=100`;
    const response = await axios.get(url);
    const txns = response.data.transactions || [];

    for (const txn of txns) {
      // Check top-level txn
      const choice = parseVoteFromTxn(txn, appId);
      if (choice) return choice;

      // Check inner txns
      const innerTxns = txn['inner-txns'] || [];
      for (const itxn of innerTxns) {
        const iChoice = parseVoteFromTxn(itxn, appId);
        if (iChoice) return iChoice;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Helper to parse a vote choice from a transaction object (top-level or inner)
 */
function parseVoteFromTxn(txn: any, appId: number): string | null {
  const appCall = txn['application-transaction'];
  if (!appCall) return null;
  
  const targetId = appCall['application-id'];
  if (!XGOV_REGISTRY_APP_IDS.includes(targetId)) return null;

  const appArgs = appCall['application-args'] || [];
  if (appArgs.length < 2) return null;

  let foundAppId = 0;
  try {
    const arg1 = appArgs[1];
    const arg1Buf = Buffer.from(arg1, 'base64');

    if (arg1Buf.length === 8) {
      // Raw uint64
      foundAppId = Number(arg1Buf.readBigUInt64BE());
    } else if (arg1Buf.length === 1) {
      // ABI application reference index:
      // Index 0 = the called application itself (application-id)
      // Index N (N>=1) = foreign-apps[N-1]
      const index = arg1Buf[0];
      if (index === 0) {
        foundAppId = appCall['application-id'];
      } else {
        const foreignApps = appCall['foreign-apps'] || [];
        if (index - 1 < foreignApps.length) {
          foundAppId = foreignApps[index - 1];
        }
      }
    }
  } catch (e) {
    return null;
  }

  if (foundAppId === appId) {
    // Found the transaction for this proposal!
    let choice: string = "APPROVE";
    
    if (appArgs.length >= 5) {
      try {
        const approvals = Number(Buffer.from(appArgs[3], 'base64').readBigUInt64BE());
        const rejections = Number(Buffer.from(appArgs[4], 'base64').readBigUInt64BE());
        
        if (rejections > 0 && approvals === 0) choice = "REJECT";
        else if (approvals > 0 && rejections === 0) choice = "APPROVE";
        else if (approvals > 0 && rejections > 0) choice = "SPLIT";
        else choice = "ABSTAIN";
      } catch (e) { /* ignore */ }
    }

    // Boycott check (v3 format)
    if (appArgs.length >= 6) {
      try {
        const boycotts = Number(Buffer.from(appArgs[5], 'base64').readBigUInt64BE());
        if (boycotts > 0) {
          const approvals = Number(Buffer.from(appArgs[3], 'base64').readBigUInt64BE());
          const rejections = Number(Buffer.from(appArgs[4], 'base64').readBigUInt64BE());
          if (approvals === 0 && rejections === 0) choice = "BOYCOTT";
          else choice = "SPLIT";
        }
      } catch (e) { /* ignore */ }
    }
    return choice;
  }
  return null;
}

export async function fetchAllXGovs(): Promise<string[]> {
  const xGovMap: Record<string, boolean> = {};
  
  try {
    for (const registryId of XGOV_REGISTRY_APP_IDS) {
      let nextToken = "";
      while (true) {
        const url = `${MAINNET_ALGONODE_INDEXER}/v2/applications/${registryId}/boxes?limit=1000${nextToken ? `&next=${encodeURIComponent(nextToken)}` : ""}`;
        const response = await axios.get(url);
        const boxes = response.data.boxes || [];
        
        boxes.forEach((b: any) => {
          const nameBytes = Buffer.from(b.name, 'base64');
          if ((nameBytes[0] === 0x78 || nameBytes[0] === 0x58) && nameBytes.length === 33) {
            const address = algosdk.encodeAddress(nameBytes.slice(1));
            xGovMap[address] = true;
          }
        });

        nextToken = response.data['next-token'];
        if (!nextToken) break;
      }
    }
    return Object.keys(xGovMap);
  } catch {
    return Object.keys(xGovMap);
  }
}

export interface XGovVoter {
  address: string;
  power: number;
  choice?: "APPROVE" | "REJECT" | "ABSTAIN" | "BOYCOTT" | "SPLIT";
}

export interface ProposalVotersResponse {
  voters: XGovVoter[];
  assignedVoters: string[];
}

export async function fetchProposalVoters(appId: number): Promise<ProposalVotersResponse> {
  try {
    // Get assigned voters directly from the proposal's own boxes ('V' prefix).
    // This is both faster and more accurate than scanning all xGov txn histories.
    const assignedAddresses = await fetchProposalAssignedVoters(appId);
    const voters = await fetchVotersFromBoxes(appId, assignedAddresses);
    return { voters, assignedVoters: assignedAddresses };
  } catch {
    return { voters: [], assignedVoters: [] };
  }
}

/**
 * List all voter boxes on the proposal app to find who is assigned to vote.
 * Voter boxes use the 'V' (0x56) prefix + 32-byte address = 33 bytes total.
 */
async function fetchProposalAssignedVoters(appId: number): Promise<string[]> {
  const addresses: string[] = [];
  let nextToken = "";

  while (true) {
    try {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/boxes?limit=1000${nextToken ? `&next=${encodeURIComponent(nextToken)}` : ""}`;
      const response = await axios.get(url);
      const boxes = response.data.boxes || [];

      boxes.forEach((b: any) => {
        const nameBytes = Buffer.from(b.name, 'base64');
        // 'V' prefix (0x56) + 32-byte public key = 33 bytes
        if (nameBytes[0] === 0x56 && nameBytes.length === 33) {
          const address = algosdk.encodeAddress(nameBytes.slice(1));
          addresses.push(address);
        }
      });

      nextToken = response.data['next-token'];
      if (!nextToken) break;
    } catch {
      break;
    }
  }

  return addresses;
}

/**
 * For each assigned voter, read their voter box data from the proposal app
 * to determine power and vote choice. The box format stores vote allocations
 * directly — all-zeros means assigned but hasn't voted yet.
 */
async function fetchVotersFromBoxes(appId: number, addresses: string[]): Promise<XGovVoter[]> {
  const voters: XGovVoter[] = [];
  const batchSize = 10;

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (address) => {
      try {
        const data = await fetchVoterData(appId, address);
        if (data.voted && data.power > 0) {
          return { address, power: data.power, choice: data.choice } as XGovVoter;
        }
        return null;
      } catch {
        return null;
      }
    }));

    batchResults.forEach(v => { if (v) voters.push(v); });

    if (i + batchSize < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return voters.sort((a, b) => b.power - a.power);
}
