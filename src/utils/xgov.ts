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

function decodeAbiBytes(base64Val: string): Buffer {
  const buf = Buffer.from(base64Val, 'base64');
  if (buf.length >= 2) {
    const declaredLen = (buf[0] << 8) | buf[1];
    if (declaredLen === buf.length - 2 && declaredLen > 0) {
      return buf.slice(2);
    }
  }
  return buf;
}

function decodeAbiString(base64Val: string): string {
  return decodeAbiBytes(base64Val).toString('utf8').replace(/\0/g, '').trim();
}

export async function fetchAllProposals(): Promise<XGovProposal[]> {
  const allApps: any[] = [];
  const registryId = 3147789458;
  const registryAddress = algosdk.getApplicationAddress(registryId);
  let nextToken = "";
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
            stateMap[item.key] = item.value.type === 2 ? item.value.uint : item.value.bytes;
          }
        });

        let title = "";
        const titleVal = stateMap["title"];
        if (titleVal && typeof titleVal === 'string') {
          title = decodeAbiString(titleVal);
        }

        let proposerAddr = "";
        const proposerVal = stateMap["proposer"];
        if (proposerVal && typeof proposerVal === 'string') {
          const addrBytes = decodeAbiBytes(proposerVal);
          if (addrBytes.length === 32) proposerAddr = algosdk.encodeAddress(addrBytes);
        }
        
        if (!proposerAddr) proposerAddr = app.params?.creator || "";

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
          totalApprovals: Number(stateMap["approvals"] || 0),
          totalRejections: Number(stateMap["rejections"] || 0),
          totalBoycotts: Number(stateMap["boycotts"] || stateMap["boycotted_members"] || 0),
          voterCount: Number(stateMap["voted_members"] || stateMap["assigned_members"] || 0)
        });
      } catch (err) {
        console.error(`Failed to fetch full data for app ${appListing.id}`, err);
      }
    }));
    if (i + batchSize < allApps.length) await new Promise(resolve => setTimeout(resolve, 100));
  }
  return proposals.sort((a, b) => b.appId - a.appId);
}

export async function fetchProposalDescription(appId: number): Promise<XGovProposal['parsedDescription']> {
  const boxKey = new Uint8Array(Buffer.from("M"));
  try {
    const response = await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/box?name=b64:${encodeURIComponent(Buffer.from(boxKey).toString('base64'))}`);
    const raw = Buffer.from(response.data.value, 'base64').toString('utf8');
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
  return 0;
}

export async function fetchVoterData(appId: number, userAddress: string): Promise<{ power: number; voted: boolean; choice?: "APPROVE" | "REJECT" | "BOYCOTT" | "ABSTAIN" | "SPLIT" }> {
  try {
    const txChoice = await fetchUserVoteChoice(appId, userAddress);
    
    const addrBytes = algosdk.decodeAddress(userAddress).publicKey;
    const boxKey = new Uint8Array([0x56, ...addrBytes]);
    const boxKeyB64 = Buffer.from(boxKey).toString('base64');
    
    let power = 0;
    try {
      const boxRes = await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/box?name=b64:${encodeURIComponent(boxKeyB64)}`);
      const buf = Buffer.from(boxRes.data.value, 'base64');
      if (buf.length === 24) power = Number(buf.readBigUInt64BE(0)) + Number(buf.readBigUInt64BE(8)) + Number(buf.readBigUInt64BE(16));
      else if (buf.length === 16) power = Number(buf.readBigUInt64BE(0)) + Number(buf.readBigUInt64BE(8));
      else if (buf.length === 8) power = Number(buf.readBigUInt64BE(0));
      
      if (!txChoice) {
        if (buf.length === 24 || buf.length === 16) {
          const appr = Number(buf.readBigUInt64BE(0));
          const rej = Number(buf.readBigUInt64BE(8));
          const boy = buf.length === 24 ? Number(buf.readBigUInt64BE(16)) : 0;
          if (appr + rej + boy > 0) {
            let choice: any = "APPROVE";
            if (boy > 0) choice = "BOYCOTT";
            else if (rej > 0 && appr === 0) choice = "REJECT";
            else if (rej > 0 && appr > 0) choice = "SPLIT";
            return { power: appr + rej + boy, voted: true, choice };
          }
        } else if (buf.length === 8 && power <= 3) {
          let choice: any = "APPROVE";
          if (power === 0) choice = "ABSTAIN";
          else if (power === 2) choice = "REJECT";
          else if (power === 3) choice = "BOYCOTT";
          return { power: 0, voted: true, choice };
        }
      }
    } catch {
      // Box missing usually means it was deleted after voting for 8-byte proposals
    }

    if (txChoice) {
      return { power, voted: true, choice: txChoice as any };
    }

    return { power, voted: false };
  } catch {
    return { power: 0, voted: false };
  }
}

export async function checkIsXGov(userAddress: string): Promise<boolean> {
  const addrBytes = algosdk.decodeAddress(userAddress).publicKey;
  const registryId = 3147789458;
  for (const prefix of ["x", "X"]) {
    const boxKey = Buffer.concat([Buffer.from(prefix), addrBytes]);
    try {
      await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${registryId}/box?name=b64:${encodeURIComponent(boxKey.toString('base64'))}`);
      return true;
    } catch { continue; }
  }
  return false;
}

export async function fetchUserVoteChoice(appId: number, userAddress: string): Promise<string | null> {
  try {
    for (const registryId of XGOV_REGISTRY_APP_IDS) {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?address=${userAddress}&application-id=${registryId}&tx-type=appl&limit=1000`;
      const response = await axios.get(url);
      const txns = response.data.transactions || [];
      for (const txn of txns) {
        const choice = parseVoteFromTxn(txn, appId);
        if (choice) return choice;
        for (const itxn of (txn['inner-txns'] || [])) {
          const iChoice = parseVoteFromTxn(itxn, appId);
          if (iChoice) return iChoice;
        }
      }
    }
    return null;
  } catch { return null; }
}

function parseVoteFromTxn(txn: any, appId: number): string | null {
  const appCall = txn['application-transaction'];
  if (!appCall || !XGOV_REGISTRY_APP_IDS.includes(appCall['application-id'])) return null;
  const appArgs = appCall['application-args'] || [];
  if (appArgs.length < 2) return null;

  let foundAppId = 0;
  const arg1Buf = Buffer.from(appArgs[1], 'base64');
  if (arg1Buf.length === 8) {
    foundAppId = Number(arg1Buf.readBigUInt64BE());
  } else if (arg1Buf.length === 1) {
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

  if (foundAppId === appId) {
    let choice = "APPROVE";
    if (appArgs.length >= 5) {
      try {
        const approvals = Number(Buffer.from(appArgs[3], 'base64').readBigUInt64BE());
        const rejections = Number(Buffer.from(appArgs[4], 'base64').readBigUInt64BE());
        if (rejections > 0 && approvals === 0) choice = "REJECT";
        else if (approvals > 0 && rejections > 0) choice = "SPLIT";
      } catch { /* ignore */ }
    }
    if (appArgs.length >= 6) {
      try {
        const boycotts = Number(Buffer.from(appArgs[5], 'base64').readBigUInt64BE());
        if (boycotts > 0) choice = "BOYCOTT";
      } catch { /* ignore */ }
    }
    return choice;
  }
  return null;
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

/**
 * Optimized Voter Breakdown:
 * 1. Pull assigned wallets from boxes.
 * 2. Scan Registry history for the Proposal ID to find confirmed voters.
 * 3. Fallback to per-user scan only if needed.
 */
export async function fetchProposalVoters(appId: number): Promise<ProposalVotersResponse> {
  // Pull assigned members and current voted count from global state
  let targetVotedCount = 0;
  try {
    const appRes = await axios.get(`${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}`);
    const globalState = appRes.data.application.params["global-state"] || [];
    globalState.forEach((item: any) => {
      const key = Buffer.from(item.key, 'base64').toString('utf8');
      if (key === "voted_members" || key === "voter_count") targetVotedCount = item.value.uint;
    });
  } catch { /* ignore */ }

  const assignedVoters: string[] = [];
  let nextToken = "";
  while (true) {
    try {
      const url = `${MAINNET_ALGONODE_INDEXER}/v2/applications/${appId}/boxes?limit=1000${nextToken ? `&next=${encodeURIComponent(nextToken)}` : ""}`;
      const res = await axios.get(url);
      (res.data.boxes || []).forEach((b: any) => {
        const bytes = Buffer.from(b.name, 'base64');
        if (bytes[0] === 0x56 && bytes.length === 33) assignedVoters.push(algosdk.encodeAddress(bytes.slice(1)));
      });
      nextToken = res.data['next-token'];
      if (!nextToken) break;
    } catch { break; }
  }

  const voterMap = new Map<string, { choice: any; power: number }>();
  
  // SCAN REGISTRY HISTORY AGGRESSIVELY
  // We scan up to 5000 transactions to the registry to find all voters at once
  for (const registryId of XGOV_REGISTRY_APP_IDS) {
    let regToken = "";
    for (let scanBatch = 0; scanBatch < 5; scanBatch++) { // Up to 5000 txns
      try {
        const url = `${MAINNET_ALGONODE_INDEXER}/v2/transactions?application-id=${registryId}&tx-type=appl&limit=1000${regToken ? `&next=${encodeURIComponent(regToken)}` : ""}`;
        const res = await axios.get(url);
        (res.data.transactions || []).forEach((t: any) => {
          const choice = parseVoteFromTxn(t, appId);
          if (choice) {
            const args = t['application-transaction']['application-args'];
            const addr = algosdk.encodeAddress(Buffer.from(args[2], 'base64'));
            const appr = Number(Buffer.from(args[3], 'base64').readBigUInt64BE());
            const rej = Number(Buffer.from(args[4], 'base64').readBigUInt64BE());
            voterMap.set(addr, { choice, power: appr + rej });
          }
        });
        regToken = res.data['next-token'];
        if (!regToken || (targetVotedCount > 0 && voterMap.size >= targetVotedCount)) break;
      } catch { break; }
    }
    if (targetVotedCount > 0 && voterMap.size >= targetVotedCount) break;
  }

  const voters: XGovVoter[] = [];
  // Merge found voters
  voterMap.forEach((v, addr) => {
    voters.push({ address: addr, power: v.power, choice: v.choice });
  });

  // Optional: Check boxes for those we missed (for 24-byte proposals where info is in box)
  const remainingWallets = assignedVoters.filter(addr => !voterMap.has(addr));
  const batchSize = 10;
  for (let i = 0; i < remainingWallets.length; i += batchSize) {
    const batch = remainingWallets.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (addr) => {
      const data = await fetchVoterData(appId, addr);
      if (data.voted) {
        return { address: addr, power: data.power, choice: data.choice } as XGovVoter;
      }
      return null;
    }));
    results.forEach(v => { if (v) voters.push(v); });
    if (i + batchSize < remainingWallets.length) await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { voters, assignedVoters };
}
