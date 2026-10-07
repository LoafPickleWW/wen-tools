import { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useWallet } from '@txnlab/use-wallet-react';
import { MdDeleteSweep, MdExpandLess, MdExpandMore, MdWarning } from 'react-icons/md';
import { executeFilebasePurge, planFilebasePurge, PurgePlanT } from './filebaseCleanup';

type Props = { token: string };

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const FilebasePurge = ({ token }: Props) => {
  const { activeAccount } = useWallet();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'unused' | 'all'>('unused');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'ready' | 'purging' | 'done'>('idle');
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState<PurgePlanT | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [acceptUnreadable, setAcceptUnreadable] = useState(false);
  const [progress, setProgress] = useState({ done: 0, failed: 0 });
  const stopRef = useRef(false);

  const creator = mode === 'unused' ? activeAccount?.address || null : null;
  const toRemove = plan ? plan.remove : [];
  const confirmWord = mode === 'all' ? 'DELETE ALL' : 'DELETE';
  const blockedByUnreadable = mode === 'unused' && (plan?.unreadableMetadata || 0) > 0 && !acceptUnreadable;
  const canPurge = confirmText.trim() === confirmWord && !blockedByUnreadable;

  const reset = () => {
    setPlan(null);
    setStatus('idle');
    setConfirmText('');
    setAcceptUnreadable(false);
    setProgress({ done: 0, failed: 0 });
  };

  const scan = async () => {
    if (!token) return toast.error('Enter your Filebase token first');
    if (mode === 'unused' && !activeAccount) return toast.error('Connect the wallet that minted your NFTs first');
    setStatus('scanning');
    setPlan(null);
    setConfirmText('');
    setAcceptUnreadable(false);
    try {
      const result = await planFilebasePurge(token, creator, setMessage);
      setPlan(result);
      setStatus('ready');
    } catch (err: any) {
      console.error(err);
      toast.error(
        err?.response?.status === 401 || err?.response?.status === 403
          ? 'Filebase rejected the token. Check it is the IPFS RPC token for this bucket.'
          : err?.message || 'Could not scan your Filebase bucket'
      );
      setStatus('idle');
    }
  };

  const purge = async () => {
    if (!plan || !canPurge) return;
    stopRef.current = false;
    setStatus('purging');
    setProgress({ done: 0, failed: 0 });
    const result = await executeFilebasePurge(
      token,
      toRemove,
      (done, failed) => setProgress({ done, failed }),
      () => stopRef.current
    );
    setStatus('done');
    if (result.failed > 0) toast.warn(`Removed ${result.done} files, ${result.failed} failed. You can scan and run it again.`);
    else toast.success(`Removed ${result.done} files from Filebase${result.stopped ? ' (stopped early)' : ''}.`);
  };

  return (
    <div className="bg-asset-detail-bg/40 border border-white/[0.08] rounded-3xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between text-xs font-black text-gray-300 hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-2">
          <MdDeleteSweep size={16} className="text-primary-orange" />
          Filebase full? Free up space
        </span>
        {open ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 text-xs text-gray-400 font-medium leading-relaxed">
          <p>
            Removes files from the Filebase bucket your token belongs to. Failed or repeated launches can leave
            lots of images and metadata behind that no NFT uses.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ['unused', 'Only unused files', 'Keeps every image and metadata file used by NFTs your connected wallet created.'],
              ['all', 'Everything in the bucket', 'Empties the bucket. NFTs already minted from it will lose their images.'],
            ] as const).map(([value, title, desc]) => (
              <button
                key={value}
                type="button"
                disabled={status === 'scanning' || status === 'purging'}
                onClick={() => { setMode(value); reset(); }}
                className={`text-left p-3 rounded-2xl border transition-all ${
                  mode === value
                    ? value === 'all' ? 'border-red-500/60 bg-red-500/10' : 'border-primary-orange/60 bg-primary-orange/10'
                    : 'border-white/[0.08] hover:border-white/[0.16]'
                }`}
              >
                <span className={`block font-black ${mode === value ? (value === 'all' ? 'text-red-400' : 'text-primary-orange') : 'text-gray-300'}`}>
                  {title}{value === 'unused' ? ' (recommended)' : ''}
                </span>
                <span className="block mt-1 text-[11px] text-gray-500">{desc}</span>
              </button>
            ))}
          </div>

          {mode === 'unused' && (
            <p className="text-[11px] text-gray-500">
              {activeAccount
                ? <>Protecting NFTs created by <span className="text-gray-300 font-mono">{shortAddr(activeAccount.address)}</span> on Mainnet and Testnet. NFTs minted from a different wallet are <span className="text-gray-300">not</span> protected.</>
                : <span className="text-amber-500">Connect the wallet that minted your NFTs so their files are kept.</span>}
            </p>
          )}

          {(status === 'idle' || status === 'scanning') && (
            <button
              type="button"
              onClick={scan}
              disabled={status === 'scanning' || !token || (mode === 'unused' && !activeAccount)}
              className="h-10 px-4 rounded-2xl bg-asset-detail-bg/50 border border-white/[0.12] text-gray-200 text-xs font-black uppercase tracking-wider hover:border-primary-orange/50 hover:text-primary-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'scanning' ? message || 'Scanning…' : 'Scan bucket'}
            </button>
          )}

          {plan && status !== 'idle' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-lg font-black text-gray-200">{plan.pins.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Files in bucket</div>
                </div>
                <div className="p-3 rounded-2xl bg-green-500/5 border border-green-500/20">
                  <div className="text-lg font-black text-green-400">{plan.keep.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Kept (used by NFTs)</div>
                </div>
                <div className="p-3 rounded-2xl bg-red-500/5 border border-red-500/20">
                  <div className="text-lg font-black text-red-400">{toRemove.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">To remove</div>
                </div>
              </div>

              {mode === 'unused' && (
                <p className="text-[11px] text-gray-500">Checked {plan.assetsChecked} NFTs created by this wallet.</p>
              )}

              {plan.unreadableMetadata > 0 && (
                <div className="flex gap-2 p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-amber-500/90">
                  <MdWarning size={16} className="shrink-0 mt-0.5" />
                  <span>
                    {plan.unreadableMetadata} NFT metadata files couldn't be read, so the images they point to can't be identified
                    and would be removed. Scan again in a minute before continuing.
                    {mode === 'unused' && status === 'ready' && (
                      <label className="mt-2 flex items-center gap-2 cursor-pointer text-amber-400">
                        <input
                          type="checkbox"
                          checked={acceptUnreadable}
                          onChange={(e) => setAcceptUnreadable(e.target.checked)}
                          className="accent-amber-500"
                        />
                        Continue anyway
                      </label>
                    )}
                  </span>
                </div>
              )}

              {status === 'ready' && toRemove.length === 0 && (
                <p className="text-green-400">Nothing to remove. Every file in this bucket is used by one of your NFTs.</p>
              )}

              {status === 'ready' && toRemove.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-[11px] text-gray-400">
                    This can't be undone. Type <span className="font-mono font-black text-red-400">{confirmWord}</span> to remove {toRemove.length} files:
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={confirmWord}
                      className="flex-1 min-w-[140px] bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-red-500/50"
                    />
                    <button
                      type="button"
                      onClick={purge}
                      disabled={!canPurge}
                      className="h-10 px-4 rounded-2xl bg-red-500 text-white text-xs font-black uppercase tracking-wider hover:bg-red-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Remove {toRemove.length} files
                    </button>
                    <button type="button" onClick={reset} className="h-10 px-4 rounded-2xl text-gray-400 hover:text-white text-xs font-bold">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(status === 'purging' || status === 'done') && (
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-primary-orange transition-all"
                      style={{ width: `${toRemove.length ? ((progress.done + progress.failed) / toRemove.length) * 100 : 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>
                      Removed {progress.done} of {toRemove.length}
                      {progress.failed > 0 && <span className="text-red-400"> · {progress.failed} failed</span>}
                    </span>
                    {status === 'purging' ? (
                      <button type="button" onClick={() => { stopRef.current = true; }} className="text-gray-400 hover:text-white font-bold">
                        Stop
                      </button>
                    ) : (
                      <button type="button" onClick={reset} className="text-primary-orange hover:underline font-bold">
                        Scan again
                      </button>
                    )}
                  </div>
                  {status === 'done' && (
                    <p className="text-[11px] text-gray-500">Filebase can take a few minutes to update the storage usage shown in its console.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FilebasePurge;
