import { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { MdFileDownload, MdFileUpload, MdSwapHoriz, MdWarning } from 'react-icons/md';
import { useProject } from './ProjectContext';

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const ProjectTransferBar = () => {
  const { downloadBackup, importProject, project } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [includeToken, setIncludeToken] = useState(true);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const hasToken = Boolean(localStorage.getItem('filebaseToken'));
  const hasProject = Boolean(project.name || project.layers?.length);

  const handleExport = async () => {
    setBusy('export');
    try {
      const { sizeBytes, includedToken } = await downloadBackup(includeToken && hasToken);
      toast.success(
        `Project exported (${formatSize(sizeBytes)})${includedToken ? ' with your Filebase token' : ''}.`
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    setBusy('import');
    try {
      const result = await importProject(file);
      if (!result) return;
      toast.success(
        `Imported ${result.layers} layers, ${result.traits} traits and ${result.items} items` +
        `${result.importedToken ? ', plus a Filebase token' : ''}.`
      );
      if (result.missingImages > 0) {
        toast.warn(`${result.missingImages} item traits had no matching image in the bundle. Check the Preview step.`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Import failed');
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-banner-grey/30 border border-white/[0.08] rounded-3xl px-5 py-4 flex flex-col md:flex-row md:items-center gap-4">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="shrink-0 w-10 h-10 rounded-2xl bg-primary-orange/10 border border-primary-orange/30 flex items-center justify-center text-primary-orange">
          <MdSwapHoriz size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-gray-200">Share this project</p>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Export a <span className="text-gray-300">.wenpad.zip</span> with every layer, trait image, rule, preview and trait name.
            A collaborator imports it, makes changes, and sends a new export back.
          </p>
          {hasToken && includeToken && (
            <p className="mt-1 text-[11px] text-amber-500/90 flex items-start gap-1">
              <MdWarning size={13} className="shrink-0 mt-0.5" />
              Includes your Filebase token. Anyone with the file can upload to your bucket, so only send it to people you trust.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {hasToken && (
          <label className="flex items-center gap-2 text-[11px] font-bold text-gray-400 cursor-pointer select-none mr-1">
            <input
              type="checkbox"
              checked={includeToken}
              onChange={(e) => setIncludeToken(e.target.checked)}
              className="accent-primary-orange"
            />
            Include Filebase token
          </label>
        )}
        <button
          type="button"
          onClick={handleExport}
          disabled={!hasProject || busy !== null}
          className="h-10 px-4 rounded-2xl bg-primary-orange text-black text-xs font-black uppercase tracking-wider flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <MdFileDownload size={16} />
          {busy === 'export' ? 'Exporting…' : 'Export'}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy !== null}
          className="h-10 px-4 rounded-2xl bg-asset-detail-bg/50 border border-white/[0.12] text-gray-300 text-xs font-black uppercase tracking-wider flex items-center gap-2 hover:border-primary-orange/50 hover:text-primary-orange transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <MdFileUpload size={16} />
          {busy === 'import' ? 'Importing…' : 'Import'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => handleImport(e.target.files?.[0])}
        />
      </div>
    </div>
  );
};

export default ProjectTransferBar;
