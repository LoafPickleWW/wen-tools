import { useState, useRef, useEffect } from "react";
import algosdk from "algosdk";
import { IoSparkles, IoSearch, IoStop, IoCopy, IoCheckmark, IoWallet } from "react-icons/io5";
import { trackEvent } from "../utils";

export default function VanityAddressTool() {
  const [prefix, setPrefix] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<{ addr: string; mnemonic: string }[]>([]);
  const [count, setCount] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const searchRef = useRef<number | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    trackEvent("vanity_copy", "vanity", id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const startSearch = () => {
    if (!prefix) return;
    const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z2-7]/g, "");
    setPrefix(cleanPrefix);
    if (cleanPrefix.length === 0) return;

    setIsSearching(true);
    setResults([]);
    setCount(0);
    trackEvent("vanity_search_start", "vanity", cleanPrefix);
  };

  const stopSearch = () => {
    setIsSearching(false);
    if (searchRef.current) {
      cancelAnimationFrame(searchRef.current);
      searchRef.current = null;
    }
  };

  useEffect(() => {
    if (isSearching) {
      const runBatch = () => {
        for (let i = 0; i < 20; i++) {
          const account = algosdk.generateAccount();
          if (account.addr.startsWith(prefix)) {
            setResults((prev) => [
              ...prev.slice(-4), // Keep last 4
              {
                addr: account.addr,
                mnemonic: algosdk.secretKeyToMnemonic(account.sk),
              },
            ]);
            trackEvent("vanity_search_success", "vanity", prefix);
          }
        }
        setCount((c) => c + 20);
        searchRef.current = requestAnimationFrame(runBatch);
      };
      searchRef.current = requestAnimationFrame(runBatch);
    }
    return () => {
      if (searchRef.current) cancelAnimationFrame(searchRef.current);
    };
  }, [isSearching, prefix]);

  return (
    <div className="mx-auto text-white mb-10 flex flex-col items-center max-w-4xl w-full px-4 min-h-screen">
      {/* Header */}
      <div className="w-full flex flex-col items-center mt-12 mb-8 text-center">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-amber-400 rounded-2xl shadow-lg shadow-amber-400/20">
            <IoSparkles className="text-4xl text-black" />
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent uppercase">
            Vanity Address
          </h1>
        </div>
        <p className="text-slate-400 mt-4 text-lg font-medium max-w-xl">
          Generate a custom Algorand wallet address with a specific prefix. Perfect for project identities and protocol signing wallets.
        </p>
      </div>

      <div className="w-full bg-banner-grey border border-secondary-gray rounded-[36px] p-8 md:p-12 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        {/* Search Progress Background */}
        {isSearching && (
          <div className="absolute top-0 left-0 h-1 bg-amber-400 transition-all duration-100 ease-linear" style={{ width: `${(count % 1000) / 10}%` }} />
        )}

        <div className="relative z-10 space-y-8">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <label className="block text-sm font-bold text-slate-400 uppercase tracking-widest ml-1">
                Address Prefix (e.g. WEN, LOAF, ACE)
              </label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                disabled={isSearching}
                placeholder="Enter prefix..."
                className="w-full bg-primary-black border-2 border-secondary-gray rounded-2xl px-6 py-4 text-2xl font-black text-white focus:border-amber-400 outline-none transition-all placeholder:text-slate-700"
              />
            </div>
            <button
              onClick={isSearching ? stopSearch : startSearch}
              className={`h-[68px] px-10 rounded-2xl font-black text-xl flex items-center gap-3 transition-all ${
                isSearching
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-amber-400 hover:bg-amber-300 text-black shadow-xl shadow-amber-400/20"
              }`}
            >
              {isSearching ? <IoStop className="text-2xl" /> : <IoSearch className="text-2xl" />}
              {isSearching ? "STOP" : "GENERATE"}
            </button>
          </div>

          <div className="flex flex-col items-center justify-center py-4">
            <div className="text-6xl font-black text-amber-400 mb-1">
              {count.toLocaleString()}
            </div>
            <div className="text-slate-500 font-bold tracking-widest uppercase text-xs">
              Addresses Scanned
            </div>
          </div>

          <div className="space-y-6">
            {results.map((res, idx) => (
              <div key={res.addr} className="animate-fade-in p-6 bg-primary-black border border-green-500/30 rounded-3xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                   <IoWallet className="text-9xl text-green-500" />
                </div>
                <h3 className="text-green-400 font-bold uppercase tracking-widest text-[10px] md:text-xs mb-4 flex items-center gap-2 relative z-10">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  {idx === results.length - 1 ? "Latest Match Found" : `Match #${idx + 1}`}
                </h3>
                
                <div className="space-y-6 relative z-10">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-500 uppercase font-bold">Public Address</span>
                      <button 
                        onClick={() => handleCopy(`addr-${idx}`, res.addr)}
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-xs font-bold transition-colors bg-primary-black/80 px-2 py-1 rounded-lg border border-secondary-gray/50"
                      >
                        {copiedId === `addr-${idx}` ? <IoCheckmark /> : <IoCopy />}
                        {copiedId === `addr-${idx}` ? "COPIED" : "COPY"}
                      </button>
                    </div>
                    <div className="bg-banner-grey/50 p-4 rounded-xl font-mono text-sm break-all text-white border border-secondary-gray">
                      {res.addr}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-500 uppercase font-bold">Secret Mnemonic (24 Words)</span>
                      <button 
                        onClick={() => handleCopy(`mnemonic-${idx}`, res.mnemonic)}
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-xs font-bold transition-colors bg-primary-black/80 px-2 py-1 rounded-lg border border-secondary-gray/50"
                      >
                        {copiedId === `mnemonic-${idx}` ? <IoCheckmark /> : <IoCopy />}
                        {copiedId === `mnemonic-${idx}` ? "COPIED" : "COPY"}
                      </button>
                    </div>
                    <div className="bg-banner-grey/50 p-4 rounded-xl font-mono text-sm text-amber-200/80 border border-secondary-gray leading-relaxed">
                      {res.mnemonic}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {results.length === 0 && !isSearching && (
            <div className="py-12 text-center space-y-4">
              <IoWallet className="text-6xl text-slate-800 mx-auto" />
              <p className="text-slate-500 font-medium">
                Enter a prefix above to start searching for custom addresses.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="mt-6 p-4 bg-amber-400/10 border border-amber-400/20 rounded-2xl text-xs text-amber-400/80 leading-relaxed italic">
              <strong>Security Note:</strong> These addresses were generated locally. Never share your mnemonics. Save your choice securely before closing this page.
            </div>
          )}
        </div>
      </div>
      
      {/* Footer info */}
      <div className="mt-8 text-center text-xs text-slate-600 space-y-2">
        <p>Alphabet: A-Z and 2-7. Characters like 0, 1, 8, 9 are not valid.</p>
        <p>Complexity increases exponentially: 3 chars ~ 200k attempts, 4 chars ~ 11m attempts.</p>
      </div>
    </div>
  );
}
