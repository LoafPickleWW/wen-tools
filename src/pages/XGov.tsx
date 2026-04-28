import { useEffect, useState, useMemo, useCallback } from 'react';
import algosdk from 'algosdk';
import { useWallet } from '@txnlab/use-wallet-react';
import { 
  fetchAllProposals, 
  XGovProposal, 
  XGOV_STATUS, 
  fetchProposalDescription,
  fetchVoterData,
  checkIsXGov,
  fetchAllXGovs,
  fetchProposalVoters,
  fetchUserVoteChoice,
  XGovVoter
} from '../utils/xgov';
import { XGOV_REGISTRY_APP_ID } from '../constants';
import { toast } from 'react-toastify';
import { 
  MdSearch, 
  MdHistory, 
  MdHowToVote, 
  MdExpandMore, 
  MdExpandLess,
  MdCheckCircle,
  MdRadioButtonUnchecked,
  MdInfoOutline,
  MdLaunch,
  MdGroup,
  MdVerified,
  MdAssignment,
  MdDoneAll,
  MdContentCopy
} from 'react-icons/md';

export function XGov() {
  const { activeAddress, transactionSigner } = useWallet();
  const [proposals, setProposals] = useState<XGovProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isXGov, setIsXGov] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedProposals, setSelectedProposals] = useState<Record<number, string>>({});
  const [votingPower, setVotingPower] = useState<Record<number, number>>({});
  const [hasVoted, setHasVoted] = useState<Record<number, boolean>>({});
  const [userVotes, setUserVotes] = useState<Record<number, string>>({});
  const [descriptions, setDescriptions] = useState<Record<number, XGovProposal['parsedDescription']>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [allXGovs, setAllXGovs] = useState<string[]>([]);
  const [proposalVoters, setProposalVoters] = useState<Record<number, XGovVoter[]>>({});
  const [expandedTab, setExpandedTab] = useState<Record<number, 'brief' | 'voters' | 'pending'>>({});
  const [loadingVoters, setLoadingVoters] = useState<Record<number, boolean>>({});

  useEffect(() => {
    loadProposals();
    loadAllXGovs();
  }, []);

  async function loadAllXGovs() {
    try {
      const data = await fetchAllXGovs();
      setAllXGovs(data);
    } catch (e) {
      console.error("Failed to load all xGovs", e);
    }
  }

  const checkRegistration = useCallback(async () => {
    if (!activeAddress) return;
    const registered = await checkIsXGov(activeAddress);
    setIsXGov(registered);
  }, [activeAddress]);

  useEffect(() => {
    if (activeAddress) {
      checkRegistration();
    } else {
      setIsXGov(null);
    }
  }, [activeAddress, checkRegistration]);

  const loadUserActivity = useCallback(async () => {
    if (!activeAddress || proposals.length === 0) return;
    
    console.log(`[xGov] Loading user activity for ${proposals.length} proposals. Active Wallet: ${activeAddress}`);
    
    const batchSize = 5;
    for (let i = 0; i < proposals.length; i += batchSize) {
      const batch = proposals.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (p) => {
        try {
          // Primary: read the voter box directly from the proposal app
          const powerData = await fetchVoterData(p.appId, activeAddress);
          
          if (powerData.voted) {
            console.log(`[xGov] Vote found via box for app ${p.appId}: choice=${powerData.choice}, power=${powerData.power}`);
            return { 
              appId: p.appId, 
              power: powerData.power, 
              voted: true, 
              choice: powerData.choice || 'APPROVE' 
            };
          }
          
          // Fallback: if box says not voted, also check transaction history
          // This catches cases where the box prefix might differ or box was cleaned up
          try {
            const txChoice = await fetchUserVoteChoice(p.appId, activeAddress);
            if (txChoice) {
              console.log(`[xGov] Vote found via txn scan for app ${p.appId}: choice=${txChoice}`);
              return {
                appId: p.appId,
                power: powerData.power,
                voted: true,
                choice: txChoice
              };
            }
          } catch { /* txn scan failed, that's OK */ }
          
          return { 
            appId: p.appId, 
            power: powerData.power, 
            voted: false, 
            choice: null 
          };
        } catch {
          return null;
        }
      }));

      const newPower: Record<number, number> = {};
      const newVoted: Record<number, boolean> = {};
      const newChoices: Record<number, string> = {};
      
      batchResults.forEach(res => {
        if (res) {
          if (res.power > 0) newPower[res.appId] = res.power;
          if (res.voted) {
            newVoted[res.appId] = true;
            newChoices[res.appId] = res.choice || 'APPROVE';
          }
        }
      });

      console.log(`[xGov] Batch ${Math.floor(i/batchSize)+1} complete. Found ${Object.keys(newVoted).length} votes in this batch.`);

      setVotingPower(prev => ({ ...prev, ...newPower }));
      setHasVoted(prev => ({ ...prev, ...newVoted }));
      setUserVotes(prev => ({ ...prev, ...newChoices }));

      if (i + batchSize < proposals.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }, [activeAddress, proposals]);

  useEffect(() => {
    if (activeAddress && proposals.length > 0) {
      loadUserActivity();
    }
  }, [activeAddress, proposals, loadUserActivity]);

  async function loadProposals() {
    try {
      setLoading(true);
      const data = await fetchAllProposals();
      setProposals(data);
    } catch {
      toast.error("Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!expandedTab[id]) {
        setExpandedTab(prev => ({ ...prev, [id]: 'brief' }));
      }
      if (!descriptions[id]) {
        const desc = await fetchProposalDescription(id);
        setDescriptions(prev => ({ ...prev, [id]: desc }));
      }
      if (!proposalVoters[id]) {
        loadProposalVoters(id);
      }
    }
  }

  async function loadProposalVoters(id: number) {
    try {
      setLoadingVoters(prev => ({ ...prev, [id]: true }));
      const voters = await fetchProposalVoters(id);
      setProposalVoters(prev => ({ ...prev, [id]: voters }));
    } catch (e) {
      console.error("Failed to load voters", e);
    } finally {
      setLoadingVoters(prev => ({ ...prev, [id]: false }));
    }
  }

  const filteredProposals = useMemo(() => {
    const matched = proposals.filter(p => {
      const isMatch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                      p.proposer.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      p.appId.toString().includes(searchQuery);
      if (activeTab === 'active') {
        return isMatch && p.status === XGOV_STATUS.VOTING && !p.finalized;
      } else {
        return isMatch && (p.finalized || p.status !== XGOV_STATUS.VOTING);
      }
    });

    // Sort logic
    if (activeTab === 'active') {
      // Sort: NOT voted first, then voted
      return matched.sort((a, b) => {
        const vA = hasVoted[a.appId] ? 1 : 0;
        const vB = hasVoted[b.appId] ? 1 : 0;
        if (vA !== vB) return vA - vB;
        return b.appId - a.appId; // Newest first
      });
    } else {
      // Sort Archive: Passed > Failed > Draft
      const getPriority = (p: XGovProposal) => {
        if (p.status === XGOV_STATUS.APPROVED || p.status === XGOV_STATUS.FUNDED) return 1; // Passed
        if (p.status === XGOV_STATUS.REJECTED || p.status === XGOV_STATUS.BLOCKED) return 2; // Failed
        return 3; // Draft/Other
      };
      
      return matched.sort((a, b) => {
        const pA = getPriority(a);
        const pB = getPriority(b);
        if (pA !== pB) return pA - pB;
        return b.appId - a.appId; // Newest first within same group
      });
    }
  }, [proposals, activeTab, searchQuery, hasVoted]);

  const handleSelect = (id: number, vote: string) => {
    setSelectedProposals(prev => {
      const next = { ...prev };
      if (vote === 'toggle') {
        if (next[id]) {
          delete next[id];
        } else {
          next[id] = 'approve';
        }
      } else {
        next[id] = vote;
      }
      return next;
    });
  };

  const selectAllActive = () => {
    const eligibleProposals = filteredProposals.filter(p => !hasVoted[p.appId]);
    const allSelected = eligibleProposals.every(p => !!selectedProposals[p.appId]);
    
    if (allSelected) {
      setSelectedProposals({});
    } else {
      const next: Record<number, string> = {};
      eligibleProposals.forEach(p => {
        next[p.appId] = selectedProposals[p.appId] || 'approve';
      });
      setSelectedProposals(next);
    }
  };

  const castVotes = async () => {
    if (!activeAddress || !transactionSigner) {
      toast.error("Please connect your wallet");
      return;
    }

    const selectedIds = Object.keys(selectedProposals).map(Number);
    if (selectedIds.length === 0) return;

    if (!isModalOpen) {
      setIsModalOpen(true);
      return;
    }

    setIsModalOpen(false);
    try {
      const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '');
      const atc = new algosdk.AtomicTransactionComposer();
      const suggestedParams = await algodClient.getTransactionParams().do();

      // Simplified ABI for vote_proposal
      const abiMethod = new algosdk.ABIMethod({
        name: "vote_proposal",
        args: [
          { name: "proposal_id", type: "uint64" },
          { name: "xgov_address", type: "address" },
          { name: "approval_votes", type: "uint64" },
          { name: "rejection_votes", type: "uint64" }
        ],
        returns: { type: "void" }
      });

      for (const appId of selectedIds) {
        const proposal = proposals.find(p => p.appId === appId);
        if (!proposal) continue;

        const choice = selectedProposals[appId];
        const power = votingPower[appId] || 0;
        
        if (power === 0) {
          toast.warning(`Skipping ${proposal.title}: 0 voting power`);
          continue;
        }

        const approvalVotes = choice === 'approve' ? power : 0;
        const rejectionVotes = choice === 'reject' ? power : 0;

        // Box keys
        const addrBytes = algosdk.decodeAddress(activeAddress).publicKey;
        const registryBoxKey = Buffer.concat([Buffer.from("x"), addrBytes]);
        const proposalBoxKey = Buffer.concat([Buffer.from("V"), addrBytes]);

        atc.addMethodCall({
          appID: Number(XGOV_REGISTRY_APP_ID),
          method: abiMethod,
          methodArgs: [appId, activeAddress, approvalVotes, rejectionVotes],
          sender: activeAddress,
          signer: transactionSigner,
          suggestedParams,
          appForeignApps: [appId],
          appAccounts: [activeAddress],
          boxes: [
            { appIndex: 0, name: registryBoxKey },
            { appIndex: 1, name: proposalBoxKey }
          ]
        });
      }

      if (atc.count() === 0) {
        toast.error("No valid transactions to send");
        return;
      }

      toast.info(`Signing and sending ${atc.count()} vote transactions...`);
      
      // Split sign and submit for better Ledger compatibility
      const signedTxns = await atc.gatherSignatures();
      const { txId } = await algodClient.sendRawTransaction(signedTxns).do();
      await algosdk.waitForConfirmation(algodClient, txId, 4);
      toast.success(`Successfully cast votes! TxID: ${txId}`);
      
      // Refresh data
      setSelectedProposals({});
      loadProposals();
    } catch (err: any) {
      console.error("Voting failed", err);
      toast.error(`Voting failed: ${err.message || "Unknown error"}`);
    }
  };

  const userProposals = useMemo(() => {
    if (!activeAddress) return [];
    return proposals.filter(p => p.proposer === activeAddress);
  }, [activeAddress, proposals]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto mt-20">
        <header className="mb-12 text-center relative">
          <h1 className="text-5xl md:text-6xl font-black mb-4 bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 bg-clip-text text-transparent italic tracking-tighter">
            xGov Command Center <span className="text-xs align-top opacity-30">v2.1</span>
          </h1>
          <p className="text-secondary-gray text-lg font-light tracking-wide">
            Elite governance interface for the Algorand Ecosystem.
          </p>

          {activeAddress && isXGov === false && (
            <div className="mt-8 bg-red-500/10 border border-red-500/20 p-6 rounded-[2rem] max-w-2xl mx-auto backdrop-blur-md animate-pulse">
              <h2 className="text-red-400 font-bold text-xl mb-2 flex items-center justify-center gap-2">
                <MdInfoOutline /> Wallet Not Registered
              </h2>
              <p className="text-gray-400 text-sm mb-4">
                This wallet is not currently a registered xGov. You must register through the official Registry to participate in voting.
              </p>
              <button 
                onClick={() => window.open('https://xgov.algorand.foundation', '_blank')}
                className="bg-red-500 text-white px-8 py-2 rounded-full font-bold hover:bg-red-600 transition-all text-sm uppercase tracking-widest"
              >
                Go to Registration
              </button>
            </div>
          )}

          {activeAddress && isXGov === true && (
            <div className="absolute top-0 right-0 hidden lg:flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-4 py-2 rounded-full">
              <MdVerified className="text-green-400" />
              <span className="text-green-400 text-xs font-bold uppercase tracking-widest">Verified xGov</span>
            </div>
          )}
        </header>

        {/* Stats Section */}
        {activeAddress && userProposals.length > 0 && (
          <div className="mb-12 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-banner-grey/30 border border-white/5 p-6 rounded-[2rem] flex items-center gap-4">
              <div className="bg-amber-400/10 p-4 rounded-2xl text-amber-400">
                <MdAssignment size={24} />
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em]">Your Proposals</p>
                <p className="text-2xl font-black">{userProposals.length}</p>
              </div>
            </div>
            {/* Add more stats if needed */}
          </div>
        )}

        {/* Navigation & Search */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-10">
          <div className="flex bg-banner-grey/50 backdrop-blur-md rounded-2xl p-1.5 border border-white/5">
            <button 
              onClick={() => setActiveTab('active')}
              className={`flex items-center gap-2 px-8 py-3 rounded-xl transition-all ${activeTab === 'active' ? 'bg-amber-400 text-black font-black shadow-[0_0_20px_rgba(251,191,36,0.2)]' : 'text-gray-400 hover:text-white'}`}
            >
              <MdHowToVote size={22} />
              VOTING
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-8 py-3 rounded-xl transition-all ${activeTab === 'history' ? 'bg-amber-400 text-black font-black shadow-[0_0_20px_rgba(251,191,36,0.2)]' : 'text-gray-400 hover:text-white'}`}
            >
              <MdHistory size={22} />
              ARCHIVE
            </button>
          </div>

          <div className="flex gap-4 w-full md:w-auto">
            <div className="relative flex-1 md:w-80 group">
              <MdSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-amber-400 transition-colors" size={24} />
              <input 
                type="text" 
                placeholder="Search title or proposer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-banner-grey/50 border border-white/5 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:border-amber-400/50 transition-all placeholder:text-gray-600 font-medium"
              />
            </div>
            {activeTab === 'active' && filteredProposals.length > 0 && (
              <button 
                onClick={selectAllActive}
                className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl px-4 flex items-center justify-center text-gray-400 hover:text-amber-400 transition-all"
                title="Select All Eligible"
              >
                <MdDoneAll size={24} />
              </button>
            )}
          </div>
        </div>

        {/* Proposals List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-6">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-amber-400/20 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-t-amber-400 rounded-full animate-spin"></div>
            </div>
            <p className="text-gray-500 animate-pulse font-mono tracking-[0.3em] text-sm">SYNCHRONIZING_AVM_STATE</p>
          </div>
        ) : (
          <div className="grid gap-8 mb-32">
            {filteredProposals.length > 0 ? filteredProposals.map(p => (
              <div 
                key={p.appId}
                className={`group relative bg-gradient-to-br from-banner-grey/60 to-transparent backdrop-blur-2xl rounded-[2.5rem] border transition-all duration-700 overflow-hidden ${expandedId === p.appId ? 'border-amber-400/40 shadow-[0_0_50px_rgba(251,191,36,0.05)] scale-[1.01]' : 'border-white/5 hover:border-amber-400/20'}`}
              >
                <div className="p-8 md:p-10">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                    <div className="flex items-start gap-6 flex-1">
                      {activeTab === 'active' && (
                        <button 
                          onClick={() => handleSelect(p.appId, 'toggle')}
                          disabled={hasVoted[p.appId]}
                          className={`mt-1.5 transition-all ${selectedProposals[p.appId] ? 'text-amber-400 scale-110' : (hasVoted[p.appId] ? 'text-gray-800' : 'text-gray-600 hover:text-gray-400')}`}
                        >
                          {hasVoted[p.appId] ? <MdCheckCircle size={32} className="text-green-500/50" /> : (selectedProposals[p.appId] ? <MdCheckCircle size={32} /> : <MdRadioButtonUnchecked size={32} />)}
                        </button>
                      )}
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                          <span className="text-xs font-mono text-amber-400/50 bg-amber-400/5 px-2 py-0.5 rounded tracking-widest">APP #{p.appId}</span>
                          <span className={`px-4 py-1 rounded-full text-[10px] font-black tracking-widest uppercase border ${p.status === XGOV_STATUS.VOTING ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
                            {Object.keys(XGOV_STATUS).find(key => XGOV_STATUS[key as keyof typeof XGOV_STATUS] === p.status)}
                          </span>
                          {hasVoted[p.appId] && (
                            <span className={`px-4 py-1 rounded-full text-[10px] font-black tracking-widest uppercase border ${userVotes[p.appId] === 'REJECT' ? 'bg-red-500/10 text-red-400 border-red-500/20' : (userVotes[p.appId] === 'BOYCOTT' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : (userVotes[p.appId] === 'SPLIT' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'))}`}>
                              VOTED: {userVotes[p.appId] || 'YES'}
                            </span>
                          )}
                          {activeAddress === p.proposer && (
                            <span className="px-4 py-1 rounded-full text-[10px] font-black tracking-widest uppercase border bg-purple-500/10 text-purple-400 border-purple-500/20">
                              YOUR PROPOSAL
                            </span>
                          )}
                        </div>
                        <h3 className="text-2xl md:text-3xl font-black text-white group-hover:text-amber-400 transition-colors leading-tight mb-4 tracking-tight">
                          {p.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-6">
                          <p className="text-sm text-gray-500 font-medium">
                            GRANT: <span className="text-white font-black">{(p.requestedAmount / 1_000_000).toLocaleString()} ALGO</span>
                          </p>
                          <p className="text-sm text-gray-500 font-medium">
                            TOTAL VOTES: <span className="text-white font-black">{(p.totalApprovals + p.totalRejections + p.totalBoycotts).toLocaleString()}</span>
                            {p.voterCount > 0 && <span className="text-gray-600 ml-2 text-xs">({p.voterCount} Wallets)</span>}
                          </p>
                          <p className="text-sm text-gray-500 font-medium flex items-center gap-2">
                            PROPOSER: {p.proposer ? (
                              <a 
                                href={`https://explorer.perawallet.app/address/${p.proposer}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-amber-400 hover:text-amber-300 transition-colors font-mono text-xs flex items-center gap-1 group/link"
                              >
                                {p.proposer.slice(0, 6)}...{p.proposer.slice(-6)}
                                <MdLaunch size={12} className="opacity-0 group-hover/link:opacity-100 transition-all" />
                              </a>
                            ) : (
                              <span className="text-gray-300 font-mono text-xs">...</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-6">
                      <div className="flex items-center gap-4">
                        {activeTab === 'active' && selectedProposals[p.appId] && !hasVoted[p.appId] && (
                          <select 
                            value={selectedProposals[p.appId]}
                            onChange={(e) => handleSelect(p.appId, e.target.value)}
                            className="bg-black/60 border-2 border-amber-400/50 rounded-2xl px-6 py-3 text-sm focus:outline-none focus:border-amber-400 transition-all text-amber-400 font-black shadow-lg shadow-amber-400/10 uppercase tracking-widest"
                          >
                            <option value="approve">APPROVE</option>
                            <option value="reject">REJECT</option>
                            <option value="abstain">ABSTAIN</option>
                          </select>
                        )}
                        <button 
                          onClick={() => toggleExpand(p.appId)}
                          className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl transition-all text-gray-500 hover:text-white border border-white/5"
                        >
                          {expandedId === p.appId ? <MdExpandLess size={28} /> : <MdExpandMore size={28} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedId === p.appId && (
                    <div className="mt-12 pt-10 border-t border-white/5 animate-fadeIn">
                      {/* Nested Tabs */}
                      <div className="flex gap-4 mb-10 overflow-x-auto pb-2 scrollbar-hide">
                        {[
                          { id: 'brief', label: 'Brief', icon: <MdInfoOutline size={18} /> },
                          { id: 'voters', label: 'Voters Breakdown', icon: <MdGroup size={18} /> },
                          { id: 'pending', label: 'Pending xGovs', icon: <MdRadioButtonUnchecked size={18} /> }
                        ].map(tab => (
                          <button
                            key={tab.id}
                            onClick={() => setExpandedTab(prev => ({ ...prev, [p.appId]: tab.id as any }))}
                            className={`flex items-center gap-2 px-6 py-3 rounded-2xl whitespace-nowrap transition-all border ${expandedTab[p.appId] === tab.id ? 'bg-amber-400 text-black border-amber-400 font-black' : 'bg-white/5 text-gray-400 border-white/5 hover:border-white/10'}`}
                          >
                            {tab.icon}
                            <span className="text-xs uppercase tracking-widest">{tab.label}</span>
                          </button>
                        ))}
                      </div>

                      {expandedTab[p.appId] === 'brief' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                          {/* Main Content */}
                          <div className="lg:col-span-2">
                            <div className="bg-black/30 p-8 rounded-[2rem] border border-white/5 shadow-inner">
                              {descriptions[p.appId] ? (
                                <div className="space-y-8">
                                  <div className="prose prose-invert max-w-none">
                                    <p className="text-gray-300 leading-relaxed text-lg font-light whitespace-pre-wrap">
                                      {descriptions[p.appId]?.description}
                                    </p>
                                  </div>
                                  
                                  {descriptions[p.appId]?.team && (
                                    <div className="pt-8 border-t border-white/5">
                                      <h5 className="text-amber-400 font-black text-sm uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <MdGroup size={20} /> THE TEAM
                                      </h5>
                                      <p className="text-gray-400 text-sm leading-relaxed whitespace-pre-wrap italic">
                                        {descriptions[p.appId]?.team}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center justify-center py-10 gap-3 text-gray-600">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                                  <span className="text-sm font-mono tracking-widest">LOADING_METADATA_BOX</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Sidebar */}
                          <div className="space-y-8">
                            <div className="space-y-4">
                              {descriptions[p.appId]?.forumLink && (
                                <a 
                                  href={descriptions[p.appId]?.forumLink} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="flex items-center justify-between p-5 bg-white/5 hover:bg-amber-400/10 border border-white/5 hover:border-amber-400/30 rounded-2xl transition-all group/link"
                                >
                                  <span className="text-sm font-bold text-gray-300 group-hover/link:text-amber-400 transition-colors">Governance Forum</span>
                                  <MdLaunch size={18} className="text-gray-500 group-hover/link:text-amber-400" />
                                </a>
                              )}
                              {descriptions[p.appId]?.additionalInfo && (
                                <div className="p-6 bg-white/5 border border-white/5 rounded-2xl">
                                  <h5 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-4">Additional Info</h5>
                                  <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap break-words">
                                    {descriptions[p.appId]?.additionalInfo}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {expandedTab[p.appId] === 'voters' && (
                        <div className="animate-fadeIn">
                          {loadingVoters[p.appId] ? (
                            <div className="flex items-center justify-center py-20 gap-3 text-gray-600">
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-400"></div>
                              <span className="text-sm font-mono tracking-widest uppercase">Fetching_Voter_Records</span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {(proposalVoters[p.appId] || []).length > 0 ? (
                                proposalVoters[p.appId].map((v, i) => (
                                  <div key={i} className="bg-white/5 border border-white/5 p-4 rounded-2xl flex items-center justify-between hover:border-amber-400/20 transition-all">
                                    <div className="flex items-center gap-3">
                                      <div className={`p-2 rounded-lg ${v.choice === 'REJECT' ? 'bg-red-500/10 text-red-400' : (v.choice === 'ABSTAIN' ? 'bg-gray-500/10 text-gray-400' : (v.choice === 'BOYCOTT' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'))}`}>
                                        <MdVerified size={14} />
                                      </div>
                                      <span className="text-xs font-mono text-gray-400">{v.address.slice(0, 8)}...{v.address.slice(-8)}</span>
                                    </div>
                                    <div className={`text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded ${v.choice === 'REJECT' ? 'bg-red-500/10 text-red-400' : (v.choice === 'ABSTAIN' ? 'bg-gray-500/10 text-gray-400' : (v.choice === 'BOYCOTT' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'))}`}>
                                      {v.choice}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="col-span-full py-20 text-center text-gray-500 italic">No voters detected yet for this proposal.</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {expandedTab[p.appId] === 'pending' && (
                        <div className="animate-fadeIn">
                          {allXGovs.length === 0 ? (
                            <div className="flex items-center justify-center py-20 gap-3 text-gray-600">
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-400"></div>
                              <span className="text-sm font-mono tracking-widest uppercase">Indexing_Registry_State</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between items-center mb-6">
                                <h5 className="text-xs font-black text-gray-500 uppercase tracking-widest">
                                  {allXGovs.filter(addr => !(proposalVoters[p.appId] || []).some(v => v.address === addr)).length} Pending Wallets
                                </h5>
                                <button 
                                  onClick={() => {
                                    const pending = allXGovs.filter(addr => !(proposalVoters[p.appId] || []).some(v => v.address === addr));
                                    navigator.clipboard.writeText(pending.join('\n'));
                                    toast.success("Copied pending addresses to clipboard!");
                                  }}
                                  className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-amber-400 transition-all border border-white/5"
                                >
                                  <MdContentCopy size={16} />
                                  COPY LIST
                                </button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {allXGovs.filter(addr => !(proposalVoters[p.appId] || []).some(v => v.address === addr)).length > 0 ? (
                                  allXGovs
                                    .filter(addr => !(proposalVoters[p.appId] || []).some(v => v.address === addr))
                                    .map((addr, i) => (
                                      <div key={i} className="bg-white/5 border border-white/5 p-4 rounded-2xl flex items-center gap-3 hover:border-amber-400/20 transition-all">
                                        <div className="bg-orange-500/10 p-2 rounded-lg text-orange-400">
                                          <MdRadioButtonUnchecked size={14} />
                                        </div>
                                        <span className="text-xs font-mono text-gray-400">{addr.slice(0, 8)}...{addr.slice(-8)}</span>
                                      </div>
                                    ))
                                ) : (
                                  <div className="col-span-full py-20 text-center text-gray-500 italic">All registered xGovs have cast their votes!</div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )) : (
              <div className="text-center py-32 bg-banner-grey/20 rounded-[3rem] border-2 border-dashed border-white/5">
                <div className="bg-white/5 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <MdSearch size={40} className="text-gray-700" />
                </div>
                <p className="text-gray-500 text-lg font-light italic">No matching protocols detected in the xGov archives.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      {Object.keys(selectedProposals).length > 0 && activeTab === 'active' && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 w-[95%] max-w-2xl z-50 animate-slideUp">
          <div className="bg-gradient-to-r from-amber-300 to-orange-500 text-black p-5 md:p-7 rounded-[3rem] shadow-[0_20px_80px_rgba(251,191,36,0.4)] flex items-center justify-between gap-6">
            <div className="flex items-center gap-6 ml-3">
              <div className="bg-black text-amber-400 w-16 h-16 rounded-full flex items-center justify-center font-black text-2xl shadow-xl shadow-black/20">
                {Object.keys(selectedProposals).length}
              </div>
              <div className="hidden sm:block">
                <p className="font-black text-2xl tracking-tighter leading-none">READY TO COMMIT</p>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] opacity-80 mt-1">Batch Vote Sequence</p>
              </div>
            </div>
            <button 
              onClick={castVotes}
              className="bg-black text-white px-12 py-4 rounded-full font-black text-lg hover:scale-105 transition-all active:scale-95 shadow-2xl shadow-black/40 tracking-tight"
            >
              EXECUTE BATCH
            </button>
          </div>
        </div>
      )}
      {/* Vote Confirmation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fadeIn">
          <div className="bg-[#111] border border-white/10 w-full max-w-2xl rounded-[3rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.5)] animate-slideUp">
            <div className="p-8 md:p-12">
              <div className="mb-10">
                <div className="inline-block px-4 py-1 rounded-full bg-amber-400/10 text-amber-400 text-[10px] font-black tracking-widest uppercase border border-amber-400/20 mb-4">
                  Governance Batch
                </div>
                <h2 className="text-4xl font-black bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent italic tracking-tighter">
                  Execute Vote Sequence
                </h2>
              </div>

              <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-4 custom-scrollbar">
                {Object.entries(selectedProposals).map(([idStr, choice]) => {
                  const id = Number(idStr);
                  const p = proposals.find(prop => prop.appId === id);
                  return (
                    <div key={id} className="bg-white/5 border border-white/5 p-5 rounded-2xl flex items-center justify-between group hover:border-amber-400/30 transition-all">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <p className="text-[10px] font-mono text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">APP #{id}</p>
                          <p className="font-bold text-gray-200 group-hover:text-white transition-colors">{p?.title || "Unknown Proposal"}</p>
                        </div>
                      </div>
                      <div className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase border ${choice === 'reject' ? 'bg-red-500/10 text-red-400 border-red-500/20' : (choice === 'abstain' ? 'bg-gray-500/10 text-gray-400 border-gray-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20')}`}>
                        {choice}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-12 flex gap-4">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-gray-400 py-5 rounded-2xl font-bold transition-all"
                >
                  CANCEL
                </button>
                <button 
                  onClick={castVotes}
                  className="flex-[2] bg-gradient-to-r from-amber-400 to-orange-500 text-black py-5 rounded-2xl font-black text-lg hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-amber-400/20"
                >
                  CONFIRM & EXECUTE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
