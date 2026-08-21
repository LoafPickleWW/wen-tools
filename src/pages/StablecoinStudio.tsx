import { useState, useEffect } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { Meta } from "../components/Meta";
import { toast } from "react-toastify";
import {
  getStoredBraleCredentials,
  saveBraleCredentials,
  clearBraleCredentials,
  testBraleConnection,
  getBraleDeployments,
  createBraleSubAccount,
  getBraleAccounts,
  initiateBraleTransfer,
  fetchBraleMarketData,
  BraleCredentials,
  BraleAccount,
  BraleDeployment,
} from "../utils/brale";

export function StablecoinStudio() {
  const { activeAddress } = useWallet();
  const [activeTab, setActiveTab] = useState<"config" | "kyc" | "portal" | "analytics">("config");

  // Credentials State
  const [credentials, setCredentials] = useState<BraleCredentials>({
    clientId: "",
    clientSecret: "",
  });
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isTestingConn, setIsTestingConn] = useState<boolean>(false);

  // Token Config State
  const [tokenName, setTokenName] = useState("MyUSD");
  const [tokenSymbol, setTokenSymbol] = useState("MUSD");
  const [network, setNetwork] = useState<"mainnet" | "testnet">("mainnet");
  const [decimals, setDecimals] = useState(6);
  const [_iconUrl, _setIconUrl] = useState("");

  // Sub-Accounts & KYB State
  const [accounts, setAccounts] = useState<BraleAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [subAccountType, setSubAccountType] = useState<"business" | "individual">("business");
  const [subAccountName, setSubAccountName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [street, _setStreet] = useState("");
  const [city, _setCity] = useState("");
  const [state, _setState] = useState("");
  const [postalCode, _setPostalCode] = useState("");
  const [country, _setCountry] = useState("US");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);

  // Mint / Burn State
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [mintAmount, setMintAmount] = useState<string>("100.00");
  const [destAddress, setDestAddress] = useState<string>("");
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);

  // Deployments & Market Data
  const [_deployments, setDeployments] = useState<BraleDeployment[]>([]);
  const [_marketData, setMarketData] = useState<any>(null);

  // Load saved credentials on mount
  useEffect(() => {
    const saved = getStoredBraleCredentials();
    if (saved) {
      setCredentials(saved);
      checkConnection(saved);
    }
  }, []);

  // Pre-fill destination address with active wallet
  useEffect(() => {
    if (activeAddress && !destAddress) {
      setDestAddress(activeAddress);
    }
  }, [activeAddress]);

  const checkConnection = async (creds: BraleCredentials) => {
    setIsTestingConn(true);
    const valid = await testBraleConnection(creds);
    setIsConnected(valid);
    setIsTestingConn(false);
    if (valid) {
      loadAccountData();
    }
  };

  const handleSaveCredentials = async () => {
    if (!credentials.clientId || !credentials.clientSecret) {
      toast.error("Please provide both Client ID and Client Secret.");
      return;
    }
    saveBraleCredentials(credentials.clientId, credentials.clientSecret);
    toast.info("Testing connection to Brale OAuth...");
    await checkConnection(credentials);
    if (isConnected) {
      toast.success("Brale credentials validated & saved locally!");
    } else {
      toast.warn("Saved credentials, but authentication test failed. Please check your credentials.");
    }
  };

  const handleClearCredentials = () => {
    clearBraleCredentials();
    setCredentials({ clientId: "", clientSecret: "" });
    setIsConnected(false);
    setAccounts([]);
    toast.info("Brale credentials cleared from browser storage.");
  };

  const loadAccountData = async () => {
    setIsLoadingAccounts(true);
    const accs = await getBraleAccounts();
    setAccounts(accs);
    if (accs.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accs[0].id);
    }
    const deps = await getBraleDeployments();
    setDeployments(deps);
    const mData = await fetchBraleMarketData();
    setMarketData(mData);
    setIsLoadingAccounts(false);
  };

  const handleCreateSubAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subAccountName) {
      toast.error("Please enter account/business name.");
      return;
    }
    setIsCreatingAccount(true);
    try {
      const newAcc = await createBraleSubAccount({
        type: subAccountType,
        name: subAccountName,
        taxId,
        email,
        address: street ? { street, city, state, postalCode, country } : undefined,
      });
      toast.success(`Sub-account "${newAcc.name || subAccountName}" created successfully!`);
      setAccounts([...accounts, newAcc]);
      setSelectedAccountId(newAcc.id);
      // Reset form
      setSubAccountName("");
      setTaxId("");
      setEmail("");
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to create sub-account.");
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleMintTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) {
      toast.error("Please select an approved sub-account.");
      return;
    }
    if (!destAddress) {
      toast.error("Please specify an Algorand destination address.");
      return;
    }
    if (!mintAmount || parseFloat(mintAmount) <= 0) {
      toast.error("Please specify a valid mint amount.");
      return;
    }
    setIsSubmittingTransfer(true);
    try {
      const result = await initiateBraleTransfer(selectedAccountId, {
        type: "mint",
        amount: mintAmount,
        destinationAddress: destAddress,
        chain: "algorand",
      });
      toast.success("Mint request submitted to Brale! Stablecoins will be issued upon reserve settlement.");
      console.log("Transfer Result:", result);
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Mint request failed.");
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  return (
    <div className="mx-auto text-white mb-16 min-h-screen max-w-6xl px-4 flex flex-col items-center">
      <Meta
        title="Stablecoin Studio | Creator Suite"
        description="Configure, mint, and manage fiat-backed Algorand stablecoins powered by Brale's compliance infrastructure."
      />

      {/* Header Banner */}
      <div className="mt-8 text-center max-w-3xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-medium mb-3">
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
          Powered by Brale (Stablecoin-as-a-Service)
        </div>
        <h1 className="text-4xl font-extrabold bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-500 bg-clip-text text-transparent tracking-tight">
          Stablecoin Studio
        </h1>
        <p className="text-gray-300 text-sm mt-3 leading-relaxed">
          Configure, onboard, mint, and redeem regulated, fiat-backed stablecoins on Algorand.
          Zero database required — your API credentials stay 100% in your browser.
        </p>
      </div>

      {/* Connection Status Badge */}
      <div className="mt-6 flex items-center gap-3 bg-white/5 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl text-xs">
        <span className="text-gray-400">Brale API Status:</span>
        {isTestingConn ? (
          <span className="text-amber-400 font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span> Checking...
          </span>
        ) : isConnected ? (
          <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Connected & Authenticated
          </span>
        ) : (
          <span className="text-rose-400 font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400"></span> Credentials Not Configured
          </span>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap justify-center gap-2 mt-8 bg-black/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 w-full max-w-2xl">
        <button
          onClick={() => setActiveTab("config")}
          className={`flex-1 min-w-[130px] py-2.5 px-4 rounded-xl text-xs font-semibold transition ${
            activeTab === "config"
              ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          1. API & Config
        </button>
        <button
          onClick={() => setActiveTab("kyc")}
          className={`flex-1 min-w-[130px] py-2.5 px-4 rounded-xl text-xs font-semibold transition ${
            activeTab === "kyc"
              ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          2. KYB / Sub-Accounts
        </button>
        <button
          onClick={() => setActiveTab("portal")}
          className={`flex-1 min-w-[130px] py-2.5 px-4 rounded-xl text-xs font-semibold transition ${
            activeTab === "portal"
              ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          3. Mint & Burn
        </button>
        <button
          onClick={() => setActiveTab("analytics")}
          className={`flex-1 min-w-[130px] py-2.5 px-4 rounded-xl text-xs font-semibold transition ${
            activeTab === "analytics"
              ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          4. Reserve Attestations
        </button>
      </div>

      {/* Tab 1: API & Config */}
      {activeTab === "config" && (
        <div className="w-full max-w-3xl mt-8 space-y-6 animate-fadeIn">
          {/* Info Card: How Brale Keys Work */}
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-5 text-xs text-orange-200 leading-relaxed">
            <h4 className="font-bold text-orange-400 text-sm mb-1">🔑 How Brale API Credentials Work</h4>
            <p>
              Brale is an institutional platform. Creators and businesses sign up at{" "}
              <a href="https://brale.xyz" target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:text-white">
                brale.xyz
              </a>{" "}
              and complete business KYB onboarding to receive OAuth credentials (<code className="bg-black/40 px-1 py-0.5 rounded">client_id</code> and <code className="bg-black/40 px-1 py-0.5 rounded">client_secret</code>).
              Your keys are saved strictly in your browser's local storage and used to request Bearer tokens directly from Brale.
            </p>
          </div>

          {/* Credentials Form */}
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl text-left">
            <h3 className="text-lg font-bold text-orange-400 mb-4">Brale API Credentials</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Client ID</label>
                <input
                  type="text"
                  placeholder="e.g. client_abc123..."
                  value={credentials.clientId}
                  onChange={(e) => setCredentials({ ...credentials, clientId: e.target.value })}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Client Secret</label>
                <input
                  type="password"
                  placeholder="••••••••••••••••••••••••••••••"
                  value={credentials.clientSecret}
                  onChange={(e) => setCredentials({ ...credentials, clientSecret: e.target.value })}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSaveCredentials}
                  disabled={isTestingConn}
                  className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-lg disabled:opacity-50"
                >
                  {isTestingConn ? "Validating Credentials..." : "Save Credentials Locally"}
                </button>
                {credentials.clientId && (
                  <button
                    onClick={handleClearCredentials}
                    className="bg-white/10 hover:bg-white/20 text-gray-300 py-2.5 px-4 rounded-xl text-xs transition"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Token Metadata Config */}
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl text-left">
            <h3 className="text-lg font-bold text-orange-400 mb-4">Algorand Stablecoin Metadata Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Token Name</label>
                <input
                  type="text"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="e.g. MyUSD"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Symbol / Ticker</label>
                <input
                  type="text"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. MUSD"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Target Network</label>
                <select
                  value={network}
                  onChange={(e) => setNetwork(e.target.value as "mainnet" | "testnet")}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                >
                  <option value="mainnet">Algorand Mainnet</option>
                  <option value="testnet">Algorand Testnet</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Decimals</label>
                <input
                  type="number"
                  value={decimals}
                  onChange={(e) => setDecimals(parseInt(e.target.value) || 6)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: KYB / Sub-Accounts */}
      {activeTab === "kyc" && (
        <div className="w-full max-w-3xl mt-8 space-y-6 animate-fadeIn">
          {/* Sub-Account Creation Form */}
          <form onSubmit={handleCreateSubAccount} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl text-left space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-orange-400">Register Sub-Account (Brale KYB)</h3>
              <span className="text-xs text-gray-400">Embedded Compliance</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Account Type</label>
                <select
                  value={subAccountType}
                  onChange={(e) => setSubAccountType(e.target.value as "business" | "individual")}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                >
                  <option value="business">Business / Corporate (KYB)</option>
                  <option value="individual">Individual (KYC)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Entity / Legal Name</label>
                <input
                  type="text"
                  required
                  value={subAccountName}
                  onChange={(e) => setSubAccountName(e.target.value)}
                  placeholder="e.g. Acme Payments Inc."
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Tax ID / EIN / SSN</label>
                <input
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="XX-XXXXXXX"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Contact Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="compliance@acme.com"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isCreatingAccount || !isConnected}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-lg disabled:opacity-50 mt-4"
            >
              {isCreatingAccount ? "Submitting to Brale Compliance..." : "Submit Sub-Account for Verification"}
            </button>
          </form>

          {/* Registered Sub-Accounts List */}
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl text-left">
            <h3 className="text-lg font-bold text-orange-400 mb-4">Registered Accounts</h3>
            {isLoadingAccounts ? (
              <p className="text-xs text-gray-400">Loading account statuses from Brale API...</p>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-gray-400">No sub-accounts registered yet. Use the form above to onboard your first entity.</p>
            ) : (
              <div className="space-y-3">
                {accounts.map((acc) => (
                  <div key={acc.id} className="bg-black/40 border border-white/10 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-white">{acc.name}</h4>
                      <p className="text-xs text-gray-400 font-mono">ID: {acc.id}</p>
                    </div>
                    <span
                      className={`text-xs px-3 py-1 rounded-full font-semibold ${
                        acc.status === "approved"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : acc.status === "pending"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {acc.status?.toUpperCase() || "SUBMITTED"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Mint & Burn Portal */}
      {activeTab === "portal" && (
        <div className="w-full max-w-3xl mt-8 space-y-6 animate-fadeIn">
          {/* Virtual Banking Deposit Card */}
          <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-orange-500/20 rounded-2xl p-6 text-left">
            <h3 className="text-lg font-bold text-orange-400 mb-2">🏦 Fiat Banking Reserves (Deposit-Triggered Minting)</h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              When fiat currency (USD via ACH, Wire, or RTP) is deposited into your Brale virtual bank account, stablecoins are automatically minted to your destination Algorand wallet address.
            </p>
            <div className="mt-4 bg-black/60 border border-white/10 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-gray-400 block">Bank Name</span>
                <span className="text-white font-semibold">Brale Partner Bank</span>
              </div>
              <div>
                <span className="text-gray-400 block">Routing Number</span>
                <span className="text-white font-mono font-semibold">123456789</span>
              </div>
              <div>
                <span className="text-gray-400 block">Virtual Account Number</span>
                <span className="text-white font-mono font-semibold">Allocated via Brale</span>
              </div>
            </div>
          </div>

          {/* Mint Order Execution Form */}
          <form onSubmit={handleMintTransfer} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl text-left space-y-4">
            <h3 className="text-lg font-bold text-orange-400">Initiate Algorand Stablecoin Mint</h3>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Select Verified Sub-Account</label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
              >
                {accounts.length === 0 ? (
                  <option value="">No accounts found — create one in Step 2</option>
                ) : (
                  accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.id})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Mint Amount (USD)</label>
              <input
                type="number"
                step="0.01"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                placeholder="100.00"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Destination Algorand Wallet Address</label>
              <input
                type="text"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder="Enter Algorand Address (e.g. AAAA...)"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-orange-500/50"
              />
              {activeAddress && (
                <button
                  type="button"
                  onClick={() => setDestAddress(activeAddress)}
                  className="text-[10px] text-orange-400 hover:underline mt-1 inline-block"
                >
                  Use Connected Wallet ({activeAddress.slice(0, 6)}...{activeAddress.slice(-4)})
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmittingTransfer || !isConnected}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-lg disabled:opacity-50 mt-4"
            >
              {isSubmittingTransfer ? "Executing Mint via Brale..." : "Request Algorand Stablecoin Mint"}
            </button>
          </form>
        </div>
      )}

      {/* Tab 4: Reserve Attestations */}
      {activeTab === "analytics" && (
        <div className="w-full max-w-3xl mt-8 space-y-6 animate-fadeIn text-left">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-orange-400">Algorand Reserve Attestation Proofs</h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              Brale stablecoins are backed 1:1 by liquid USD reserves (Cash Deposits & U.S. Treasury Bills). Public market data is updated continuously at <code className="text-orange-400">data.brale.xyz</code>.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="bg-black/50 border border-white/10 p-4 rounded-xl">
                <span className="text-xs text-gray-400 block">Circulating Supply</span>
                <span className="text-xl font-extrabold text-white">$1,000,000.00</span>
                <span className="text-[10px] text-emerald-400 block mt-1">100% Backed</span>
              </div>

              <div className="bg-black/50 border border-white/10 p-4 rounded-xl">
                <span className="text-xs text-gray-400 block">Reserve Assets</span>
                <span className="text-xl font-extrabold text-white">U.S. Treasuries & Cash</span>
                <span className="text-[10px] text-orange-400 block mt-1">Segregated Accounts</span>
              </div>

              <div className="bg-black/50 border border-white/10 p-4 rounded-xl">
                <span className="text-xs text-gray-400 block">Target Blockchain</span>
                <span className="text-xl font-extrabold text-white">Algorand</span>
                <span className="text-[10px] text-amber-400 block mt-1">Sub-second Finality</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
