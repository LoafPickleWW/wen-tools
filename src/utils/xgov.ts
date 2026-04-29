import * as algosdk from "algosdk";
import axios from "axios";
import { MAINNET_ALGONODE_INDEXER, XGOV_REGISTRY_APP_ID, XGOV_REGISTRY_APP_IDS } from "../constants";

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

export async function fetchRegistryPower(userAddress: string): Promise<number> {
  const addrBytes = algosdk.decodeAddress(userAddress).publicKey;
  const prefix = Buffer.from("x");
  const boxKeyBase64 = Buffer.concat([prefix, addrBytes]).toString('base64');
  
  try {
    const valRes = await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${XGOV_REGISTRY_APP_ID}/box?name=b64:${encodeURIComponent(boxKeyBase64)}`);
    const buf = Buffer.from(valRes.data.value, 'base64');
    // xGov registry box value is usually a uint64 of committed ALGOs (in microalgos)
    return Number(buf.readBigUInt64BE());
  } catch {
    return 0;
  }
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
      if (boycotts > 0 && approvals === 0 && rejections === 0) choice = "BOYCOTT";
      else if (rejections > 0 && approvals === 0) choice = "REJECT";
      else if (approvals > 0 && rejections === 0) choice = "APPROVE";
      else if (approvals > 0 || rejections > 0 || boycotts > 0) choice = "SPLIT";
    }
    // v2 format: 16 bytes = [approvals(8) | rejections(8)]
    else if (buf.length >= 16) {
      const approvals = Number(buf.readBigUInt64BE(0));
      const rejections = Number(buf.readBigUInt64BE(8));
      power = approvals + rejections;
      if (rejections > 0 && approvals === 0) choice = "REJECT";
      else if (approvals > 0 && rejections > 0) choice = "SPLIT";
      else choice = "APPROVE";
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

    // Box exists => user has voted, regardless of power value
    return { power, voted: true, choice };
  } catch (boxErr: any) {
    // 404 means box doesn't exist = user hasn't voted
    // 400 can also mean the box doesn't exist for some indexer implementations
    if (boxErr?.response?.status === 404 || boxErr?.response?.status === 400) {
      try {
        const registryPower = await fetchRegistryPower(userAddress);
        return { power: registryPower, voted: false };
      } catch {
        return { power: 0, voted: false };
      }
    }
    // For any other error (network timeout, 500, etc.), 
    // we can't determine vote status — return unknown/not-voted
    // but log it so it can be debugged
    console.error(`[fetchVoterData] Unexpected error for app ${appId}, user ${userAddress}:`, boxErr?.message || boxErr);
    return { power: 0, voted: false };
  }
}

export async function checkIsXGov(userAddress: string): Promise<boolean> {
  const addrBytes = algosdk.decodeAddress(userAddress).publicKey;
  const prefix = Buffer.from("x"); // 0x78
  const boxKey = Buffer.concat([prefix, addrBytes]);
  
  try {
    // For registry, we still might get 404 if not registered, but it's only once per session
    await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${XGOV_REGISTRY_APP_ID}/box?name=b64:${encodeURIComponent(Buffer.from(boxKey).toString('base64'))}`);
    return true;
  } catch {
    return false;
  }
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
  if (appArgs.length >= 2) {
    try {
      const argIdBuf = Buffer.from(appArgs[1], 'base64');
      const argId = Number(argIdBuf.readBigUInt64BE());
      
      if (argId === appId) {
        // Found the transaction for this proposal!
        let choice: string = "APPROVE";
        
        if (appArgs.length >= 5) {
          const approvals = Number(Buffer.from(appArgs[3], 'base64').readBigUInt64BE());
          const rejections = Number(Buffer.from(appArgs[4], 'base64').readBigUInt64BE());
          
          if (rejections > 0 && approvals === 0) choice = "REJECT";
          else if (approvals > 0 && rejections === 0) choice = "APPROVE";
          else if (approvals > 0 && rejections > 0) choice = "SPLIT";
          else choice = "ABSTAIN";
        }

        // Boycott check (v3 format)
        if (appArgs.length >= 6) {
          const boycotts = Number(Buffer.from(appArgs[5], 'base64').readBigUInt64BE());
          if (boycotts > 0) {
            const approvals = Number(Buffer.from(appArgs[3], 'base64').readBigUInt64BE());
            const rejections = Number(Buffer.from(appArgs[4], 'base64').readBigUInt64BE());
            if (approvals === 0 && rejections === 0) choice = "BOYCOTT";
            else choice = "SPLIT";
          }
        }
        return choice;
      }
    } catch { /* ignore */ }
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

export async function fetchProposalVoters(appId: number): Promise<XGovVoter[]> {
  try {
    // Step 1: Get all voter boxes to know the box format and assigned power
    let nextToken = "";
    let boxes: any[] = [];
    while (true) {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/boxes?limit=1000${nextToken ? `&next=${encodeURIComponent(nextToken)}` : ""}`;
      const response = await axios.get(url);
      boxes = [...boxes, ...(response.data.boxes || [])];
      nextToken = response.data['next-token'];
      if (!nextToken) break;
    }
    
    const voterBoxes = boxes.filter((b: any) => {
      const nameBytes = Buffer.from(b.name, 'base64');
      if (nameBytes.length === 33 && (nameBytes[0] === 0x56 || nameBytes[0] === 0x76)) return true;
      if (nameBytes.length === 32) return true;
      return false;
    });
    
    console.log(`[xGov] App ${appId}: Found ${boxes.length} total boxes, ${voterBoxes.length} voter boxes`);

    // Step 2: Peek at the first voter box to detect format
    let boxFormat: '24byte' | '16byte' | '8byte' = '8byte';
    if (voterBoxes.length > 0) {
      try {
        const peekRes = await axios.get(
          `${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/box?name=b64:${encodeURIComponent(voterBoxes[0].name)}`
        );
        const peekBuf = Buffer.from(peekRes.data.value, 'base64');
        if (peekBuf.length >= 24) boxFormat = '24byte';
        else if (peekBuf.length >= 16) boxFormat = '16byte';
        else boxFormat = '8byte';
      } catch { /* default to 8byte */ }
    }
    
    console.log(`[xGov] App ${appId}: Detected box format: ${boxFormat}`);

    // Step 3: For 24-byte and 16-byte formats, we can distinguish voted from 
    // not-voted by checking if the box is all zeros (not voted) vs non-zero (voted).
    // For 8-byte format, or to be 100% thorough as per user feedback, 
    // we use the master xGov list and check transaction history.
    
    const allXGovs = await fetchAllXGovs();
    return await fetchVotersFromTransactions(appId, voterBoxes, allXGovs);

    // --- 24-byte / 16-byte format: read boxes, filter out all-zero (unvoted) ---
    const voters: XGovVoter[] = [];
    const batchSize = 15;
    for (let i = 0; i < voterBoxes.length; i += batchSize) {
      const batch = voterBoxes.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (b: any) => {
        try {
          const boxNameB64 = b.name;
          const valRes = await axios.get(
            `${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/box?name=b64:${encodeURIComponent(boxNameB64)}`
          );
          const buf = Buffer.from(valRes.data.value, 'base64');
          const nameBytes = Buffer.from(b.name, 'base64');
          const addrBytes = nameBytes.length === 33 ? nameBytes.slice(1) : nameBytes;
          const address = algosdk.encodeAddress(addrBytes);
          
          let power = 0;
          let choice: XGovVoter['choice'] = "ABSTAIN";

          if (buf.length >= 24) {
            const approvals = Number(buf.readBigUInt64BE(0));
            const rejections = Number(buf.readBigUInt64BE(8));
            const boycotts = Number(buf.readBigUInt64BE(16));
            power = approvals + rejections + boycotts;
            
            if (power === 0) {
              choice = "ABSTAIN";
            } else if (boycotts > 0 && approvals === 0 && rejections === 0) {
              choice = "BOYCOTT";
            } else if (approvals > 0 && rejections === 0 && boycotts === 0) {
              choice = "APPROVE";
            } else if (rejections > 0 && approvals === 0 && boycotts === 0) {
              choice = "REJECT";
            } else {
              choice = "SPLIT";
            }
          } else if (buf.length >= 16) {
            const approvals = Number(buf.readBigUInt64BE(0));
            const rejections = Number(buf.readBigUInt64BE(8));
            power = approvals + rejections;
            if (power === 0) choice = "ABSTAIN";
            else if (approvals > 0 && rejections > 0) choice = "SPLIT";
            else if (rejections > 0) choice = "REJECT";
            else choice = "APPROVE";
          }

          return { address, power, choice };
        } catch {
          return null;
        }
      }));
      
      batchResults.forEach(v => {
        if (v && v.power > 0) voters.push(v);
      });
    }

    console.log(`[xGov] App ${appId}: ${voterBoxes.length} assigned, ${voters.length} actually voted (multi-byte format)`);
    return voters.sort((a, b) => b.power - a.power);
  } catch {
    return [];
  }
}

/**
 * For 8-byte format proposals, the voter box stores assigned power upfront
 * (always non-zero), so we can't distinguish voted vs not-voted from box data.
 * 
 * Instead, for each assigned voter we check their account's transaction history
 * against the registry to see if they submitted a vote for this proposal.
 * Same approach as fetchUserVoteChoice, applied to all ~87 assigned voters.
 */
async function fetchVotersFromTransactions(appId: number, voterBoxes: any[], allXGovs: string[]): Promise<XGovVoter[]> {
  // Build a map of address -> assigned power from the boxes
  const assignedPower: Record<string, number> = {};
  const addrBatchSize = 30;
  
  for (let i = 0; i < voterBoxes.length; i += addrBatchSize) {
    const batch = voterBoxes.slice(i, i + addrBatchSize);
    await Promise.all(batch.map(async (b: any) => {
      try {
        const nameBytes = Buffer.from(b.name, 'base64');
        const addrBytes = nameBytes.length === 33 ? nameBytes.slice(1) : nameBytes;
        const address = algosdk.encodeAddress(addrBytes);
        
        const valRes = await axios.get(
          `${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/box?name=b64:${encodeURIComponent(b.name)}`
        );
        const buf = Buffer.from(valRes.data.value, 'base64');
        if (buf.length >= 8) {
          assignedPower[address] = Number(buf.readBigUInt64BE(0));
        }
      } catch { /* skip */ }
    }));
  }

  console.log(`[xGov] App ${appId}: Checking ${allXGovs.length} total xGovs for vote txns...`);

  const voters: XGovVoter[] = [];
  const checkBatchSize = 10;
  
  for (let i = 0; i < allXGovs.length; i += checkBatchSize) {
    const batch = allXGovs.slice(i, i + checkBatchSize);
    const batchResults = await Promise.all(batch.map(async (address) => {
      try {
        const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${address}&tx-type=appl&limit=100`;
        const response = await axios.get(url);
        const txns = response.data.transactions || [];
        
        for (const txn of txns) {
          const choice = parseVoteFromTxn(txn, appId);
          if (choice) {
            // Found a vote! Use assigned power if available, otherwise 0
            return { address, power: assignedPower[address] || 0, choice: choice as XGovVoter['choice'] };
          }

          const innerTxns = txn['inner-txns'] || [];
          for (const itxn of innerTxns) {
            const iChoice = parseVoteFromTxn(itxn, appId);
            if (iChoice) {
              return { address, power: assignedPower[address] || 0, choice: iChoice as XGovVoter['choice'] };
            }
          }
        }
        return null; 
      } catch {
        return null;
      }
    }));
    
    batchResults.forEach(v => { if (v) voters.push(v); });
    
    if (i + checkBatchSize < allXGovs.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return voters.sort((a, b) => b.power - a.power);
}
