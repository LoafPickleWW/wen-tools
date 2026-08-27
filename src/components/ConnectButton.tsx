// ** React Imports
import { useEffect, useState } from "react";

// ** MUI Imports
import { IconButton } from "@mui/material";
import Button, { ButtonProps } from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import Tooltip from "@mui/material/Tooltip";
import { styled } from '@mui/material/styles';
import { useWallet } from "@txnlab/use-wallet-react";

// ** Wallet Imports
import { PeraWalletConnect } from "@perawallet/connect";
import { isCrustAuth, isCrustAuthFail, signLoginAlgorandForCrustIpfsEndpoint } from "../crust-auth";
import { getNfDomainsInBulk } from "../utils";

import { FaCopy, FaWallet } from "react-icons/fa";
import { IoPlanet, IoLockClosed, IoShieldCheckmark, IoRefresh } from "react-icons/io5";
import { toast } from "react-toastify";
import { usePQTheme, THEME_TIERS } from "../context/PQThemeContext";

export default function ConnectButton({
  inmain = false
}: {
  /** If this connect button is to be in the main part of the page (not in the header) */
  inmain?: boolean
}) {
  const { activeAddress, activeWallet, algodClient, wallets } = useWallet();
  const {
    isPQAccount,
    isScanning,
    pqTxCount,
    quantumTheme,
    setQuantumTheme,
    backgroundFxEnabled,
    setBackgroundFxEnabled,
    isThemeActive,
    unlockedThemes,
    nextTier,
  } = usePQTheme();

  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);
  const peraWallet = new PeraWalletConnect();
  const [accountData, setAccountData] = useState(null as any);
  const [nfdName, setNfdName] = useState<string | null>(null);

  useEffect(() => {
    if (activeAddress) {
      getNfDomainsInBulk([activeAddress])
        .then((map) => {
          if (map && map[activeAddress]) {
            setNfdName(map[activeAddress]);
          } else {
            setNfdName(null);
          }
        })
        .catch(() => setNfdName(null));
    } else {
      setNfdName(null);
    }
  }, [activeAddress]);

  // handlers
  const handleClick = (event: any) => {
    if (peraWallet.isPeraDiscoverBrowser) {
      connectToPera();
    } else {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const shortenAddress = (address: string) => {
    return (
      address.substring(0, 4) + "..." + address.substring(address.length - 4)
    );
  };

  const connectToPera = async () => {
    handleClose();
    try {
      await wallets.find((w) => w.id === "pera")?.connect();
      toast.success("Connected!");
    } catch {
      toast.error("Failed to connect!");
    }
  };

  const connectToDefly = async () => {
    handleClose();
    try {
      await wallets.find((w) => w.id === "defly")?.connect();
      toast.success("Connected!");
    } catch {
      toast.error("Failed to connect!");
    }
  };

  const connectToLute = async () => {
    handleClose();
    try {
      await wallets.find((w) => w.id === "lute")?.connect();
      toast.success("Connected!");
    } catch {
      toast.error("Failed to connect!");
    }
  };

  const clearLoginState = async () => {
    activeWallet?.disconnect();
    localStorage.removeItem("authBasic");
    localStorage.removeItem("authBasicFail");
  };

  const disconnect = async () => {
    handleClose();
    clearLoginState();
    toast.success("Disconnected!");
    window.location.reload();
  };

  useEffect(() => {
    if (activeAddress) {
      algodClient
        .accountInformation(activeAddress)
        .exclude("all")
        .do()
        .then((data: any) => {
          setAccountData(data);
        });
    }
  }, [activeAddress, algodClient]);

  useEffect(() => {
    if (activeAddress && !inmain) {
      if (isCrustAuth() || isCrustAuthFail()) return;

      signLoginAlgorandForCrustIpfsEndpoint(activeAddress)
        .then(authBasic => {
          localStorage.setItem("authBasic", authBasic ?? '');
        })
        .catch(() => {
          localStorage.setItem("authBasicFail", "true");
        });
    }
  }, [activeWallet, activeAddress, inmain]);

  return (
    <div className={
      "flex flex-row justify-center items-center font-sans rounded-2xl mx-2"
      + ((inmain && !activeAddress) ? " mt-4 mb-2" : "")
    }>
      {!activeAddress ? (
        inmain
          ? <ButtonMain
            id="connect-button-main"
            aria-controls={open ? "connect-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
            onClick={handleClick}
            variant="outlined"
            color="inherit"
          >
            <span className="font-sans font-light normal-case sm:leading-relaxed leading-relaxed text-xl">
              Login
            </span>
          </ButtonMain>
          : <Button
            id={"connect-button"}
            aria-controls={open ? "connect-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
            onClick={handleClick}
            color="inherit"
          >
            <span className="font-sans font-light normal-case sm:leading-relaxed leading-tight lg:text-xl">
              Login
            </span>
          </Button>
      ) : (!inmain &&
        <Tooltip title="Account Options" placement="bottom-start">
          <IconButton
            id={"connect-button" + (inmain ? "-main" : "")}
            aria-controls={open ? "connect-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={open ? "true" : undefined}
            onClick={handleClick}
            sx={{
              fontFamily: "sans",
              color: "white",
              borderRadius: "24px",
              position: "relative",
            }}
            className={isThemeActive ? "quantum-wallet-btn" : ""}
          >
            <FaWallet className="text-2xl" />
          </IconButton>
        </Tooltip>
      )}
      <Menu
        id="connect-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        disableScrollLock={true}
        MenuListProps={{
          "aria-labelledby": "connect-button" + (inmain ? "-main" : ""),
        }}
        sx={{
          mt: 1,
          "& .MuiMenu-paper": {
            backgroundColor: "transparent",
            boxShadow: "none",
            borderRadius: "1rem",
            overflow: "visible",
          },
          "& .MuiList-root": {
            padding: 0,
          },
        }}
      >
        {!activeAddress ? (
          <div className="flex flex-col gap-1 w-[200px] p-2.5 bg-slate-950/95 border border-slate-800 rounded-2xl text-white shadow-2xl backdrop-blur-2xl">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/80 mb-1">
              Select Wallet
            </div>
            <button
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-orange-500/10 hover:border-orange-500/30 border border-transparent transition-all text-left text-xs font-bold text-slate-200 hover:text-orange-400 group"
              onClick={connectToPera}
            >
              <div className="w-7 h-7 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1.5 shrink-0 group-hover:border-orange-500/40 group-hover:scale-105 transition-all">
                <img src="/pera-logomark-white.png" alt="Pera" className="w-full h-full object-contain" />
              </div>
              <span>Pera Wallet</span>
            </button>
            <button
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-orange-500/10 hover:border-orange-500/30 border border-transparent transition-all text-left text-xs font-bold text-slate-200 hover:text-orange-400 group"
              onClick={connectToDefly}
            >
              <div className="w-7 h-7 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1.5 shrink-0 group-hover:border-orange-500/40 group-hover:scale-105 transition-all">
                <img src="/defly-logo.png" alt="Defly" className="w-full h-full object-contain" />
              </div>
              <span>Defly Wallet</span>
            </button>
            <button
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-orange-500/10 hover:border-orange-500/30 border border-transparent transition-all text-left text-xs font-bold text-slate-200 hover:text-orange-400 group"
              onClick={connectToLute}
            >
              <div className="w-7 h-7 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1.5 shrink-0 group-hover:border-orange-500/40 group-hover:scale-105 transition-all">
                <img src="/lute-wallet.svg" alt="Lute" className="w-full h-full object-contain" />
              </div>
              <span>Lute Wallet</span>
            </button>
          </div>
        ) : (
          /* Seamless Unified Quantum Wallet Control Panel */
          <div
            className="w-[320px] p-4 rounded-3xl bg-slate-950/95 border border-slate-800 text-white shadow-2xl backdrop-blur-2xl space-y-3.5 font-sans transition-all duration-300"
            style={{
              borderColor: isThemeActive ? "var(--pq-glow)" : undefined,
              boxShadow: isThemeActive ? "0 0 25px var(--pq-glow-subtle)" : undefined,
            }}
          >
            {/* 1. Account Header & Identity */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center p-1.5 shrink-0 shadow-inner">
                  {activeWallet?.id === "pera" && <img src="/pera-logomark-white.png" alt="Pera" className="w-5 h-5 object-contain" />}
                  {activeWallet?.id === "defly" && <img src="/defly-logo.png" alt="Defly" className="w-6 h-6 object-contain" />}
                  {activeWallet?.id === "lute" && <img src="/lute-wallet.svg" alt="Lute" className="w-5 h-5 object-contain" />}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm text-white tracking-tight font-sans">
                      {nfdName ? nfdName : shortenAddress(activeAddress)}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(activeAddress);
                        toast.success("Address copied!");
                      }}
                      className="text-slate-400 hover:opacity-80 transition p-1"
                      style={{ color: isThemeActive ? "var(--pq-primary)" : undefined }}
                      title="Copy address"
                    >
                      <FaCopy className="text-xs" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {nfdName && (
                      <span
                        className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border"
                        style={{
                          color: isThemeActive ? "var(--pq-primary)" : "#34d399",
                          backgroundColor: isThemeActive ? "var(--pq-glow-subtle)" : "rgba(52,211,153,0.1)",
                          borderColor: isThemeActive ? "var(--pq-glow)" : "rgba(52,211,153,0.3)",
                        }}
                      >
                        {shortenAddress(activeAddress)}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 font-medium capitalize">
                      {activeWallet?.id || "Algorand"} Wallet
                    </span>
                  </div>
                </div>
              </div>

              {isScanning ? (
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold animate-pulse px-2.5 py-1 rounded-full border"
                  style={{
                    color: isThemeActive ? "var(--pq-primary)" : "#38bdf8",
                    backgroundColor: isThemeActive ? "var(--pq-glow-subtle)" : "rgba(56,189,248,0.1)",
                    borderColor: isThemeActive ? "var(--pq-glow)" : "rgba(56,189,248,0.3)",
                  }}
                >
                  <IoRefresh className="animate-spin text-xs" /> Scanning
                </span>
              ) : isPQAccount ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-full border border-emerald-500/30 shadow-sm">
                  <IoShieldCheckmark className="text-xs text-emerald-400" /> PQ SECURED
                </span>
              ) : null}
            </div>

            {/* 2. Account Balances Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-900/70 p-2.5 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Balance</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-extrabold text-sm text-white">{((accountData?.amount || 0) / 10 ** 6).toFixed(2)}</span>
                  <span
                    className="font-bold text-xxs transition-colors"
                    style={{ color: isThemeActive ? "var(--pq-primary, #00f0ff)" : "#38bdf8" }}
                  >
                    ALGO
                  </span>
                </div>
              </div>

              <div className="bg-slate-900/70 p-2.5 rounded-2xl border border-slate-800/80 flex flex-col justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Min Balance</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-bold text-sm text-slate-300">{((accountData?.["min-balance"] || 0) / 10 ** 6).toFixed(2)}</span>
                  <span className="text-slate-500 font-medium text-xxs">ALGO</span>
                </div>
              </div>
            </div>

            {/* 3. Quantum Mastery & Themes (rendered when PQ account active or scanning) */}
            {(isScanning || isThemeActive || isPQAccount) && (
              <div className="pt-2.5 border-t border-slate-800/80 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <IoPlanet
                      className="text-sm animate-pulse"
                      style={{ color: isThemeActive ? "var(--pq-primary, #00f0ff)" : "#38bdf8" }}
                    />
                    <span
                      className="font-bold text-xs"
                      style={{ color: isThemeActive ? "var(--pq-primary, #00f0ff)" : "#38bdf8" }}
                    >
                      PQSIG Tx Count
                    </span>
                  </div>
                  <span
                    className="font-mono font-extrabold text-xs px-2 py-0.5 rounded-lg border"
                    style={{
                      color: isThemeActive ? "var(--pq-primary, #00f0ff)" : "#38bdf8",
                      backgroundColor: isThemeActive ? "var(--pq-glow-subtle)" : "rgba(56,189,248,0.1)",
                      borderColor: isThemeActive ? "var(--pq-glow)" : "rgba(56,189,248,0.3)",
                    }}
                  >
                    {pqTxCount} {pqTxCount === 1 ? "Tx" : "Txns"}
                  </span>
                </div>

                {/* Progress to Next Unlock Tier */}
                {nextTier && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Next: {nextTier.nextTheme.name}</span>
                      <span>{pqTxCount} / {nextTier.requiredTx} Tx</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (pqTxCount / nextTier.requiredTx) * 100)}%`,
                          background: isThemeActive
                            ? "linear-gradient(90deg, var(--pq-primary), var(--pq-secondary))"
                            : "linear-gradient(90deg, #38bdf8, #a855f7)",
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Theme Selectors */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold text-slate-400 block">Unlocked Color Themes</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {THEME_TIERS.map((tier) => {
                      const isUnlocked = unlockedThemes.includes(tier.id);
                      const isSelected = quantumTheme === tier.id;
                      return (
                        <button
                          key={tier.id}
                          disabled={!isUnlocked}
                          onClick={() => setQuantumTheme(tier.id)}
                          style={
                            isSelected
                              ? {
                                  borderColor: tier.color,
                                  backgroundColor: `${tier.color}22`,
                                  boxShadow: `0 0 10px ${tier.color}44`,
                                }
                              : undefined
                          }
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-left text-[10px] transition-all ${
                            isSelected
                              ? "text-white font-bold shadow-sm ring-1 ring-white/20"
                              : isUnlocked
                              ? "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:text-white"
                              : "border-slate-800/40 bg-slate-950/30 text-slate-600 opacity-50 cursor-not-allowed"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tier.color }} />
                            <span className="truncate">{tier.name}</span>
                          </div>
                          {!isUnlocked && <IoLockClosed className="text-slate-600 shrink-0 text-[10px]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Atomic FX Switch */}
                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/60">
                  <span className="text-slate-400 text-[10px]">Atomic Orbital FX</span>
                  <button
                    onClick={() => setBackgroundFxEnabled(!backgroundFxEnabled)}
                    className="w-8 h-4 flex items-center rounded-full p-0.5 transition-colors"
                    style={{
                      backgroundColor: backgroundFxEnabled
                        ? isThemeActive
                          ? "var(--pq-primary, #00f0ff)"
                          : "#f57b14"
                        : "#1e293b",
                    }}
                  >
                    <div className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform ${backgroundFxEnabled ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
              </div>
            )}

            {/* 4. Disconnect Action Button */}
            <div className="pt-2 border-t border-slate-800/80">
              <button
                onClick={disconnect}
                className="w-full py-2 px-3 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-800/50 text-red-300 hover:text-white text-xs font-semibold transition-all duration-200 shadow-sm flex items-center justify-center gap-2"
              >
                Disconnect Wallet
              </button>
            </div>
          </div>
        )}
      </Menu>
    </div>
  );
}

const ButtonMain = styled(Button)<ButtonProps>(({ theme }) => ({
  borderColor: '#f57b14',
  color: '#f57b14',
  '&:hover': {
    backgroundColor: '#f57b14',
    color: theme.palette.getContrastText('#f57b14'),
  },
}));
