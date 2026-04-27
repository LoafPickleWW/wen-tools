import * as algosdk from "algosdk";
import axios from "axios";
import { MAINNET_ALGONODE_INDEXER, XGOV_REGISTRY_APP_ID } from "../constants";

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

export async function fetchAllProposals(): Promise<XGovProposal[]> {
  const registryAddress = algosdk.getApplicationAddress(XGOV_REGISTRY_APP_ID);
  let allApps: any[] = [];
  let nextToken = "";
  
  // Fetch up to 1000 apps (or handle with limit if needed)
  while (true) {
    const url = `${MAINNET_ALGONODE_INDEXER}/v2/applications?creator=${registryAddress}&limit=100${nextToken ? `&next=${encodeURIComponent(nextToken)}` : ""}`;
    const response = await axios.get(url);
    allApps = [...allApps, ...response.data.applications];
    nextToken = response.data['next-token'];
    if (!nextToken || allApps.length >= 1000) break;
  }

  // Reverse to get newest first (highest ID first)
  allApps.reverse();

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

        // Parse global state with proper handling for ABI-encoded keys.
        // AlgoKit/ABI contracts may prefix keys with 2-byte length headers or
        // use raw UTF-8 strings. We try both approaches and store under all
        // possible decoded key names.
        globalState.forEach((item: any) => {
          const rawKeyBytes = Buffer.from(item.key, 'base64');
          const value = item.value.uint !== undefined ? item.value.uint : item.value.bytes;
          
          // Store under base64 key as fallback
          stateMap[item.key] = value;
          
          // Try decoding as raw UTF-8
          try {
            const utf8Key = rawKeyBytes.toString('utf8').replace(/\0/g, '').trim();
            if (utf8Key.length > 0) {
              stateMap[utf8Key] = value;
              stateMap[utf8Key.toLowerCase()] = value;
            }
          } catch { /* ignore */ }
          
          // Try ABI-style decoding: skip first 2 bytes (uint16 length prefix)
          // This is how AlgoKit-generated contracts often store state keys
          if (rawKeyBytes.length > 2) {
            try {
              const abiKey = rawKeyBytes.slice(2).toString('utf8').replace(/\0/g, '').trim();
              if (abiKey.length > 0) {
                stateMap[abiKey] = value;
                stateMap[abiKey.toLowerCase()] = value;
              }
            } catch { /* ignore */ }
          }
          
          // Also try skipping just 1 byte prefix (some contracts use single-byte tags)
          if (rawKeyBytes.length > 1) {
            try {
              const prefixed = rawKeyBytes.slice(1).toString('utf8').replace(/\0/g, '').trim();
              if (prefixed.length > 0 && /^[a-zA-Z_]/.test(prefixed)) {
                stateMap[prefixed] = value;
                stateMap[prefixed.toLowerCase()] = value;
              }
            } catch { /* ignore */ }
          }
        });

        // Log all keys once per first app for debugging
        if (i === 0 && batch.indexOf(appListing) === 0) {
          console.log(`[xGov DEBUG] Global state keys for app ${app.id}:`, Object.keys(stateMap).filter(k => k.length < 50));
        }

        // --- GET PROPOSER ---
        // 1) Try from global state first (the SC stores proposer address in state)
        let proposerAddr = "";
        try {
          const proposerKeys = ["proposer", "p", "creator", "owner", "author"];
          for (const k of proposerKeys) {
            const val = stateMap[k];
            if (val && typeof val === 'string') {
              try {
                const bytes = Buffer.from(val, 'base64');
                if (bytes.length === 32) {
                  proposerAddr = algosdk.encodeAddress(bytes);
                  break;
                }
              } catch { /* Not a valid address */ }
            }
          }
        } catch { /* ignore */ }
        
        // 2) Fall back to app creator from indexer (but this might be the registry)
        if (!proposerAddr) {
          proposerAddr = app.params?.creator || "";
        }

        // --- GET TITLE ---
        let title = "";
        
        // Try all plausible global state key names for title
        const titleKeys = ["title", "t", "name", "metadata", "proposal_title", "proposaltitle", "subject"];
        for (const k of titleKeys) {
          const val = stateMap[k];
          if (val !== undefined && val !== null) {
            let decoded = "";
            if (typeof val === 'string' && val.length > 0) {
              try {
                const buf = Buffer.from(val, 'base64');
                decoded = buf.toString('utf8').replace(/\0/g, '').trim();
              } catch {
                decoded = val.replace(/\0/g, '').trim();
              }
            } else if (typeof val === 'number') {
              // Title wouldn't be a number, skip
              continue;
            }
            if (decoded && decoded.length > 2 && decoded.length < 200) {
              title = decoded;
              break;
            }
          }
        }
        
        // If still no title, scan ALL state values for anything that looks like a title string
        if (!title) {
          for (const [key, val] of Object.entries(stateMap)) {
            if (typeof val === 'string' && val.length > 4) {
              try {
                const buf = Buffer.from(val as string, 'base64');
                const decoded = buf.toString('utf8').replace(/\0/g, '').trim();
                // Heuristic: looks like a readable title (printable chars, reasonable length)
                if (decoded.length > 3 && decoded.length < 200 && /^[\x20-\x7E]+$/.test(decoded) && !/^[A-Z2-7]{58}$/.test(decoded)) {
                  title = decoded;
                  console.log(`[xGov] Found title in key "${key}" for app ${app.id}: "${decoded}"`);
                  break;
                }
              } catch { /* skip */ }
            }
          }
        }

        // If title still not found from global state, try to get it from the metadata box
        if (!title) {
          try {
            const metadataBoxKey = Buffer.from("M");
            const metaRes = await axios.get(
              `${MAINNET_ALGONODE_INDEXER}/v2/applications/${app.id}/box?name=b64:${encodeURIComponent(metadataBoxKey.toString('base64'))}`
            );
            const raw = Buffer.from(metaRes.data.value, 'base64').toString('utf8');
            try {
              const parsed = JSON.parse(raw);
              if (parsed.title && parsed.title.length > 2) {
                title = parsed.title;
              } else if (parsed.name && parsed.name.length > 2) {
                title = parsed.name;
              }
            } catch {
              const firstLine = raw.split('\n')[0].replace(/\0/g, '').trim();
              if (firstLine.length > 2 && firstLine.length <= 120) {
                title = firstLine;
              }
            }
          } catch { /* Metadata box doesn't exist — that's OK */ }
        }

        // Look for vote tallies under various possible key names
        const approvals = stateMap["approvals"] || stateMap["total_approvals"] || stateMap["approval_votes"] || stateMap["yes"] || stateMap["approve"] || 0;
        const rejections = stateMap["rejections"] || stateMap["total_rejections"] || stateMap["rejection_votes"] || stateMap["no"] || stateMap["reject"] || 0;
        const boycotts = stateMap["boycotts"] || stateMap["total_boycotts"] || stateMap["boycott_votes"] || stateMap["boycott"] || 0;
        const voterCount = stateMap["voted_members"] || stateMap["assigned_members"] || stateMap["voter_count"] || stateMap["voters"] || 0;

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
    // Search for transactions to the Registry app by this user that involve this proposal
    // We filter by Registry App ID and the proposal ID in the args
    const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${userAddress}&application-id=${XGOV_REGISTRY_APP_ID}&tx-type=appl&limit=100`;
    const response = await axios.get(url);
    const txns = response.data.transactions || [];

    for (const txn of txns) {
      // const logs = txn.logs || [];
      const appArgs = txn['application-transaction']['application-args'] || [];
      
      // The Registry's vote_proposal method has a specific selector
      // vote_proposal(uint64,address,uint64,uint64) -> first 4 bytes of SHA512_256
      // But we can also just check if the first arg is the proposal appId (uint64)
      // and the second arg is the userAddress (32 bytes)
      
      if (appArgs.length >= 2) {
        try {
          const argIdBuf = Buffer.from(appArgs[1], 'base64');
          const argId = Number(argIdBuf.readBigUInt64BE());
          
          if (argId === appId) {
            // Found the transaction for this proposal!
            // Now check approval_votes vs rejection_votes in args 3 and 4
            const approvalsBuf = Buffer.from(appArgs[3], 'base64');
            const rejectionsBuf = Buffer.from(appArgs[4], 'base64');
            const approvals = Number(approvalsBuf.readBigUInt64BE());
            const rejections = Number(rejectionsBuf.readBigUInt64BE());
            
            if (approvals > 0) return "APPROVE";
            if (rejections > 0) return "REJECT";
            return "ABSTAIN";
          }
        } catch {
          continue;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchAllXGovs(): Promise<string[]> {
  try {
    let allBoxes: any[] = [];
    let nextToken = "";
    
    while (true) {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/applications/${XGOV_REGISTRY_APP_ID}/boxes?limit=1000${nextToken ? `&next=${encodeURIComponent(nextToken)}` : ""}`;
      const response = await axios.get(url);
      const boxes = response.data.boxes || [];
      allBoxes = [...allBoxes, ...boxes];
      nextToken = response.data['next-token'];
      if (!nextToken || allBoxes.length >= 10000) break; // Increased limit
    }

    return allBoxes
      .filter(b => {
        const nameBytes = Buffer.from(b.name, 'base64');
        // 'x' (0x78) or 'X' (0x58) prefix, length 33
        const isXGov = (nameBytes[0] === 0x78 || nameBytes[0] === 0x58) && nameBytes.length === 33;
        return isXGov;
      })
      .map(b => algosdk.encodeAddress(Buffer.from(b.name, 'base64').slice(1)));
  } catch {
    return [];
  }
}

export interface XGovVoter {
  address: string;
  power: number;
  choice?: "APPROVE" | "REJECT" | "ABSTAIN" | "BOYCOTT" | "SPLIT";
}

export async function fetchProposalVoters(appId: number): Promise<XGovVoter[]> {
  try {
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
      return nameBytes[0] === 0x56 && nameBytes.length === 33; // 'V' prefix + 32-byte address
    });

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
          const address = algosdk.encodeAddress(Buffer.from(b.name, 'base64').slice(1));
          
          let power = 0;
          let choice: XGovVoter['choice'] = "ABSTAIN";

          // v3.0.0 format: 24 bytes = [approvals(8) | rejections(8) | boycotts(8)]
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
          }
          // v2 format: 16 bytes = [approvals(8) | rejections(8)]
          else if (buf.length >= 16) {
            const approvals = Number(buf.readBigUInt64BE(0));
            const rejections = Number(buf.readBigUInt64BE(8));
            power = approvals + rejections;
            if (power === 0) choice = "ABSTAIN";
            else if (approvals > 0 && rejections > 0) choice = "SPLIT";
            else if (rejections > 0) choice = "REJECT";
            else choice = "APPROVE";
          }
          // Older format: 8 bytes
          else if (buf.length >= 8) {
            const val = Number(buf.readBigUInt64BE(0));
            // Small values are likely choice enums
            if (val <= 3) {
              if (val === 1) choice = "APPROVE";
              else if (val === 2) choice = "REJECT";
              else choice = "ABSTAIN";
              power = 0;
            } else {
              power = val;
              choice = "APPROVE";
            }
          }

          return { address, power, choice };
        } catch {
          return null;
        }
      }));
      
      batchResults.forEach(v => {
        if (v) voters.push(v);
      });
    }

    return voters.sort((a, b) => b.power - a.power);
  } catch {
    return [];
  }
}
