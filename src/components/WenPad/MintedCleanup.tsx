import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import algosdk from 'algosdk';
import { useWallet } from '@txnlab/use-wallet-react';
import { MdDeleteForever, MdExpandLess, MdExpandMore, MdWarning } from 'react-icons/md';
import { chunkGroupsByTxnCount, parseAlgodError, walletSign } from '../../utils';

type Props = {
  defaultUnitName: string;
  onDeleted: () => void;
};

type FoundAssetT = {
  id: number;
  name: string;
  number: number;
  // Destroying needs the wallet to be the manager and to hold the entire supply.
  blockedReason: string | null;
};

const CONFIRM_WORD = 'DELETE';

const MintedCleanup = ({ defaultUnitName, onDeleted }: Props) => {
  const { activeAccount, transactionSigner, algodClient } = useWallet();
  const [open, setOpen] = useState(false);
  const [unitName, setUnitName] = useState(defaultUnitName);
  const [namePrefix, setNamePrefix] = useState('');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'ready' | 'deleting' | 'done'>('idle');
  const [found, setFound] = useState<FoundAssetT[]>([]);
  const [fromNum, setFromNum] = useState(1);
  const [toNum, setToNum] = useState(1);
  const [confirmText, setConfirmText] = useState('');
  const [progress, setProgress] = useState({ done: 0, failed: 0, message: '' });
  const stopRef = useRef(false);

  useEffect(() => {
    if (status === 'idle') setUnitName(defaultUnitName);
  }, [defaultUnitName]); // eslint-disable-line react-hooks/exhaustive-deps

  const inRange = useMemo(
    () => found.filter((a) => a.number >= fromNum && a.number <= toNum),
    [found, fromNum, toNum]
  );
  const toDelete = inRange.filter((a) => !a.blockedReason);
  const blocked = inRange.filter((a) => a.blockedReason);
  const canDelete = confirmText.trim() === CONFIRM_WORD && toDelete.length > 0;

  const reset = () => {
    setStatus('idle');
    setFound([]);
    setConfirmText('');
    setProgress({ done: 0, failed: 0, message: '' });
  };

  const scan = async () => {
    if (!activeAccount) return toast.error('Connect the wallet that minted the NFTs first');
    const unit = unitName.trim().toLowerCase();
    const prefix = namePrefix.trim().toLowerCase();
    if (!unit && !prefix) return toast.error('Enter a unit name or a name prefix to search for');

    setStatus('scanning');
    setConfirmText('');
    try {
      const acct: any = await algodClient.accountInformation(activeAccount.address).do();
      const holdings = new Map<number, number>();
      for (const h of acct.assets || []) holdings.set(Number(h['asset-id']), Number(h.amount));

      const results: FoundAssetT[] = [];
      for (const ca of acct['created-assets'] || []) {
        const params = ca.params || {};
        const name: string = (params.name || '').trim();
        const match = name.match(/#(\d+)$/);
        if (!match) continue;
        if (unit && (params['unit-name'] || '').trim().toLowerCase() !== unit) continue;
        if (prefix && !name.toLowerCase().startsWith(prefix)) continue;

        const id = Number(ca.index);
        const total = Number(params.total);
        let blockedReason: string | null = null;
        if (params.manager !== activeAccount.address) blockedReason = 'No manager (or a different manager) is set';
        else if ((holdings.get(id) || 0) !== total) blockedReason = 'Not all units are in this wallet (sold or transferred)';
        results.push({ id, name, number: parseInt(match[1], 10), blockedReason });
      }
      results.sort((a, b) => a.number - b.number || a.id - b.id);

      setFound(results);
      setFromNum(results.length ? results[0].number : 1);
      setToNum(results.length ? results[results.length - 1].number : 1);
      setStatus('ready');
    } catch (err) {
      console.error(err);
      toast.error(parseAlgodError(err));
      setStatus('idle');
    }
  };

  const destroy = async () => {
    if (!activeAccount || !canDelete) return;
    stopRef.current = false;
    setStatus('deleting');
    let done = 0;
    let failed = 0;
    try {
      const params = await algodClient.getTransactionParams().do();
      const groups = toDelete.map((a) => [
        algosdk.makeAssetDestroyTxnWithSuggestedParamsFromObject({
          from: activeAccount.address,
          assetIndex: a.id,
          suggestedParams: params,
        }),
      ]);
      const chunks = chunkGroupsByTxnCount(groups);

      for (let i = 0; i < chunks.length && !stopRef.current; i++) {
        setProgress({ done, failed, message: chunks.length === 1
          ? `Approve ${chunks[i].length} deletions in your wallet (one request)...`
          : `Approve batch ${i + 1} of ${chunks.length} in your wallet...` });
        const signed = await walletSign(chunks[i], transactionSigner);
        if (signed.length !== chunks[i].length) {
          throw new Error(`Wallet returned ${signed.length} of ${chunks[i].length} signed transactions. Nothing in this batch was sent.`);
        }

        const txIds: string[] = [];
        for (let j = 0; j < signed.length && !stopRef.current; j++) {
          setProgress({ done, failed, message: `Sending ${j + 1} of ${signed.length}...` });
          try {
            await algodClient.sendRawTransaction(signed[j]).do();
            txIds.push(chunks[i][j][0].txID());
          } catch (err) {
            failed++;
            console.error(`Failed to delete asset ${chunks[i][j][0].assetIndex}:`, err);
          }
          // Gentle throttle to avoid RPC rate limiting, matching the mint flow.
          await new Promise((r) => setTimeout(r, 60));
        }

        for (const txId of txIds) {
          setProgress({ done, failed, message: 'Confirming on-chain...' });
          try {
            await algosdk.waitForConfirmation(algodClient, txId, 10);
            done++;
          } catch (err) {
            failed++;
            console.error(`Confirmation error for txId ${txId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('WenPad delete error:', err);
      toast.error(parseAlgodError(err));
    }

    setProgress({ done, failed, message: '' });
    setStatus('done');
    if (failed > 0) toast.warn(`Deleted ${done} NFTs, ${failed} failed. Scan again to retry the rest.`);
    else if (done > 0) toast.success(`Deleted ${done} NFTs${stopRef.current ? ' (stopped early)' : ''}.`);
    onDeleted();
  };

  const busy = status === 'scanning' || status === 'deleting';
  const inputClass = 'w-full bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-orange/50 disabled:opacity-50';

  return (
    <div className="bg-asset-detail-bg/40 border border-white/[0.08] rounded-3xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between text-xs font-black text-gray-300 hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-2">
          <MdDeleteForever size={16} className="text-primary-orange" />
          Need to re-mint? Delete NFTs you already minted
        </span>
        {open ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 text-xs text-gray-400 font-medium leading-relaxed">
          <p>
            Permanently destroys NFTs your connected wallet created, so you can mint them again with new names.
            Only NFTs still fully held by this wallet can be deleted. Each one returns its 0.1 ALGO minimum balance.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-primary-orange ml-1">Unit name</span>
              <input value={unitName} onChange={(e) => setUnitName(e.target.value)} disabled={busy || status === 'ready'} placeholder="e.g. TMNP" className={inputClass} />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-primary-orange ml-1">Name starts with (optional)</span>
              <input value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} disabled={busy || status === 'ready'} placeholder="e.g. Old Collection Name" className={inputClass} />
            </label>
          </div>
          <p className="text-[11px] text-gray-500">
            Use the details the NFTs were <span className="text-gray-300">minted</span> with. If you renamed the collection, search by unit name or the old name.
          </p>

          {(status === 'idle' || status === 'scanning') && (
            <button
              type="button"
              onClick={scan}
              disabled={busy || !activeAccount}
              className="h-10 px-4 rounded-2xl bg-asset-detail-bg/50 border border-white/[0.12] text-gray-200 text-xs font-black uppercase tracking-wider hover:border-primary-orange/50 hover:text-primary-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'scanning' ? 'Scanning wallet…' : activeAccount ? 'Find minted NFTs' : 'Connect wallet first'}
            </button>
          )}

          {status !== 'idle' && status !== 'scanning' && (
            <div className="space-y-3">
              {found.length === 0 ? (
                <div className="flex items-center justify-between">
                  <p>No matching NFTs were created by this wallet.</p>
                  <button type="button" onClick={reset} className="text-primary-orange hover:underline font-bold">Search again</button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">From #</span>
                      <input type="number" value={fromNum} onChange={(e) => setFromNum(Number(e.target.value) || 0)} disabled={status !== 'ready'} className={inputClass} />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">To #</span>
                      <input type="number" value={toNum} onChange={(e) => setToNum(Number(e.target.value) || 0)} disabled={status !== 'ready'} className={inputClass} />
                    </label>
                  </div>

                  <div className="max-h-48 overflow-y-auto rounded-2xl border border-white/[0.06] divide-y divide-white/[0.04]">
                    {inRange.map((a) => (
                      <div key={a.id} className="px-3 py-1.5 flex items-center justify-between gap-3">
                        <span className={`truncate ${a.blockedReason ? 'text-gray-600 line-through' : 'text-gray-300'}`}>{a.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-gray-500" title={a.blockedReason || undefined}>
                          {a.blockedReason ? 'can’t delete' : a.id}
                        </span>
                      </div>
                    ))}
                  </div>

                  {blocked.length > 0 && (
                    <div className="flex gap-2 p-3 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-amber-500/90">
                      <MdWarning size={16} className="shrink-0 mt-0.5" />
                      <span>{blocked.length} NFT{blocked.length > 1 ? 's' : ''} in this range will be skipped: {blocked[0].blockedReason?.toLowerCase()}.</span>
                    </div>
                  )}
                </>
              )}

              {status === 'ready' && toDelete.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-[11px] text-gray-400">
                    This can't be undone. Type <span className="font-mono font-black text-red-400">{CONFIRM_WORD}</span> to destroy {toDelete.length} NFTs (#{toDelete[0].number}–#{toDelete[toDelete.length - 1].number}):
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={CONFIRM_WORD}
                      className="flex-1 min-w-[140px] bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-red-500/50"
                    />
                    <button
                      type="button"
                      onClick={destroy}
                      disabled={!canDelete}
                      className="h-10 px-4 rounded-2xl bg-red-500 text-white text-xs font-black uppercase tracking-wider hover:bg-red-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Delete {toDelete.length} NFTs
                    </button>
                    <button type="button" onClick={reset} className="h-10 px-4 rounded-2xl text-gray-400 hover:text-white text-xs font-bold">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {(status === 'deleting' || status === 'done') && (
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-primary-orange transition-all"
                      style={{ width: `${toDelete.length ? ((progress.done + progress.failed) / toDelete.length) * 100 : 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>
                      {progress.message || `Deleted ${progress.done} of ${toDelete.length}`}
                      {progress.failed > 0 && <span className="text-red-400"> · {progress.failed} failed</span>}
                    </span>
                    {status === 'deleting' ? (
                      <button type="button" onClick={() => { stopRef.current = true; }} className="text-gray-400 hover:text-white font-bold">
                        Stop
                      </button>
                    ) : (
                      <button type="button" onClick={reset} className="text-primary-orange hover:underline font-bold">
                        Scan again
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MintedCleanup;
