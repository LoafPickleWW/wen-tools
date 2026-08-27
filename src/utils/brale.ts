import axios from "axios";

export const BRALE_CLIENT_ID_KEY = "brale_client_id";
export const BRALE_CLIENT_SECRET_KEY = "brale_client_secret";

export interface BraleCredentials {
  clientId: string;
  clientSecret: string;
}

export interface BraleDeployment {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  contractAddress?: string;
  status: "active" | "pending" | "processing";
  totalSupply?: string;
  decimals: number;
}

export interface BraleAccount {
  id: string;
  type: "business" | "individual";
  name: string;
  status: "approved" | "pending" | "action_required" | "rejected";
  virtualBankAccount?: {
    routingNumber: string;
    accountNumber: string;
    bankName: string;
  };
  createdAt?: string;
}

export interface BraleTransferPayload {
  type: "mint" | "burn" | "transfer";
  amount: string;
  destinationAddress: string;
  chain: string;
}

// ── Credential Helpers ───────────────────────────────────────────────────────

export function getStoredBraleCredentials(): BraleCredentials | null {
  const clientId = localStorage.getItem(BRALE_CLIENT_ID_KEY);
  const clientSecret = localStorage.getItem(BRALE_CLIENT_SECRET_KEY);
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }
  return null;
}

export function saveBraleCredentials(clientId: string, clientSecret: string): void {
  localStorage.setItem(BRALE_CLIENT_ID_KEY, clientId.trim());
  localStorage.setItem(BRALE_CLIENT_SECRET_KEY, clientSecret.trim());
}

export function clearBraleCredentials(): void {
  localStorage.removeItem(BRALE_CLIENT_ID_KEY);
  localStorage.removeItem(BRALE_CLIENT_SECRET_KEY);
}

// ── OAuth Authentication ─────────────────────────────────────────────────────

export async function fetchBraleAccessToken(credentials?: BraleCredentials): Promise<string> {
  const creds = credentials || getStoredBraleCredentials();
  if (!creds || !creds.clientId || !creds.clientSecret) {
    throw new Error("Missing Brale API credentials. Please configure your Client ID and Secret.");
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await axios.post("https://auth.brale.xyz/oauth2/token", params.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (res.data && res.data.access_token) {
    return res.data.access_token;
  }
  throw new Error("Failed to authenticate with Brale auth service.");
}

// ── API Operations ────────────────────────────────────────────────────────────

export async function testBraleConnection(credentials: BraleCredentials): Promise<boolean> {
  try {
    const token = await fetchBraleAccessToken(credentials);
    return !!token;
  } catch {
    return false;
  }
}

export async function getBraleDeployments(): Promise<BraleDeployment[]> {
  try {
    const token = await fetchBraleAccessToken();
    const res = await axios.get("https://api.brale.xyz/deployments", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.deployments || res.data || [];
  } catch (err) {
    console.warn("Could not fetch deployments from Brale API:", err);
    return [];
  }
}

export async function createBraleSubAccount(accountData: {
  type: "business" | "individual";
  name: string;
  taxId?: string;
  email?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}): Promise<BraleAccount> {
  const token = await fetchBraleAccessToken();
  const res = await axios.post("https://api.brale.xyz/accounts", accountData, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `idemp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    },
  });
  return res.data;
}

export async function getBraleAccounts(): Promise<BraleAccount[]> {
  try {
    const token = await fetchBraleAccessToken();
    const res = await axios.get("https://api.brale.xyz/accounts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.accounts || res.data || [];
  } catch (err) {
    console.warn("Could not fetch accounts from Brale API:", err);
    return [];
  }
}

export async function initiateBraleTransfer(
  accountId: string,
  payload: BraleTransferPayload
): Promise<any> {
  const token = await fetchBraleAccessToken();
  const res = await axios.post(
    `https://api.brale.xyz/accounts/${accountId}/transfers`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `idemp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      },
    }
  );
  return res.data;
}

export async function fetchBraleMarketData(): Promise<any> {
  try {
    const res = await axios.get("https://data.brale.xyz/tokens");
    return res.data;
  } catch (err) {
    console.warn("Could not fetch public market data from data.brale.xyz:", err);
    return null;
  }
}
