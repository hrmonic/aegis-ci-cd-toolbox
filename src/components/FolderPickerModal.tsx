import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  HardDrive,
  ArrowUpLeft,
  Check,
  Search,
  ExternalLink,
  X,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import type { StackId } from '../types/toolbox';

interface DriveItem {
  name: string;
  path: string;
}

interface DirectoryItem {
  name: string;
  path: string;
  isGitRepo: boolean;
  projectMarkers: string[];
}

interface BrowseResponse {
  currentPath: string;
  currentName: string;
  parentPath: string | null;
  detectedStacks: StackId[];
  directories: DirectoryItem[];
}

interface FolderPickerModalProps {
  open: boolean;
  initialPath: string;
  onClose: () => void;
  onSelectFolder: (selectedPath: string, detectedStacks?: StackId[]) => void;
}

export const FolderPickerModal: React.FC<FolderPickerModalProps> = ({
  open,
  initialPath,
  onClose,
  onSelectFolder,
}) => {
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [browseData, setBrowseData] = useState<BrowseResponse | null>(null);
  const [manualPath, setManualPath] = useState(initialPath);
  const [filterText, setFilterText] = useState('');
  const [loading, setLoading] = useState(false);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (targetDir: string) => {
    setLoading(true);
    setError(null);
    setFilterText('');
    try {
      const res = await fetch('/api/fs/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: targetDir }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Impossible d'ouvrir ${targetDir}`);
        return;
      }
      setBrowseData(data);
      setManualPath(data.currentPath);
    } catch {
      setError('Serveur local hors-ligne. Saisissez le chemin manuellement.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch('/api/fs/drives')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.drives)) setDrives(d.drives);
      })
      .catch(() => {});

    loadDirectory(initialPath || '.');
  }, [open, initialPath, loadDirectory]);

  if (!open) return null;

  const handleOpenWindowsNativeDialog = async () => {
    setNativeLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fs/pick-native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialDir: browseData?.currentPath || initialPath }),
      });
      const data = await res.json();
      if (!data.cancelled && data.projectPath) {
        onSelectFolder(data.projectPath, data.detectedStacks);
        onClose();
      }
    } catch {
      setError('Impossible d’ouvrir la boîte de dialogue Windows.');
    } finally {
      setNativeLoading(false);
    }
  };

  const filteredDirs = (browseData?.directories || []).filter((d) =>
    !filterText.trim() ? true : d.name.toLowerCase().includes(filterText.toLowerCase())
  );

  const pathParts = (browseData?.currentPath || '').split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-3xl w-full rounded-lg bg-[#101115] border border-[#24262e] shadow-2xl overflow-hidden flex flex-col max-h-[82vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Open Project Directory</h2>
            <p className="text-[11px] text-zinc-400">
              Select a local workspace folder to run CI/CD diagnostics
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={nativeLoading}
              onClick={handleOpenWindowsNativeDialog}
              className="px-3 py-1.5 rounded-md bg-[#181a20] hover:bg-[#20232b] border border-[#2a2d37] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
              {nativeLoading ? 'Waiting for Windows...' : 'System Dialog...'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-[#1c1e24] text-zinc-400 hover:text-zinc-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drives + Path Bar */}
        <div className="px-5 py-3 bg-[#101115] border-b border-[#22242c] space-y-2.5">
          {drives.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {drives.map((drv) => {
                const isActiveDrive = (browseData?.currentPath || '')
                  .toUpperCase()
                  .startsWith(drv.path.toUpperCase());
                return (
                  <button
                    key={drv.path}
                    type="button"
                    onClick={() => loadDirectory(drv.path)}
                    className={`px-2.5 py-1 rounded text-xs font-mono border transition flex items-center gap-1.5 ${
                      isActiveDrive
                        ? 'bg-[#1e2129] text-zinc-100 border-teal-500/60'
                        : 'bg-[#14151a] hover:bg-[#1a1c22] text-zinc-400 border-[#24262e]'
                    }`}
                  >
                    <HardDrive className="w-3 h-3 text-zinc-400" />
                    {drv.path}
                  </button>
                );
              })}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadDirectory(manualPath);
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              disabled={!browseData?.parentPath || loading}
              onClick={() => browseData?.parentPath && loadDirectory(browseData.parentPath)}
              title="Parent directory"
              className="px-2.5 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 text-xs font-medium flex items-center gap-1 disabled:opacity-40 transition shrink-0"
            >
              <ArrowUpLeft className="w-3.5 h-3.5" />
              Up
            </button>

            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="F:/APP/..."
              className="flex-1 rounded-md bg-[#0b0c0e] border border-[#252730] focus:border-zinc-500 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none"
            />

            <button
              type="submit"
              className="px-3 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition shrink-0"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Go
            </button>
          </form>

          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-0.5 text-[11px] font-mono text-zinc-400">
              {pathParts.map((part, index) => {
                const accumulated = pathParts.slice(0, index + 1).join('/') + '/';
                return (
                  <React.Fragment key={accumulated}>
                    <button
                      type="button"
                      onClick={() => loadDirectory(accumulated)}
                      className="hover:text-zinc-100 px-1 py-0.5 rounded hover:bg-[#1a1c22] transition"
                    >
                      {part}
                    </button>
                    {index < pathParts.length - 1 && (
                      <ChevronRight className="w-3 h-3 text-zinc-600" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            <div className="relative w-48">
              <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter folders..."
                className="w-full rounded-md bg-[#0b0c0e] border border-[#23252d] pl-7 pr-2.5 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>
        </div>

        {/* Directory List */}
        <div className="flex-1 overflow-y-auto p-3 bg-[#090a0c]">
          {error && (
            <div className="mb-2 p-2.5 rounded-md bg-red-950/30 border border-red-500/30 text-red-300 text-xs">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-zinc-500 text-xs">Loading directory...</div>
          ) : filteredDirs.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-500">
              No subdirectories found in <code className="text-zinc-300">{browseData?.currentPath}</code>
            </div>
          ) : (
            <div className="divide-y divide-[#181920] border border-[#1d1f26] rounded-md bg-[#0d0e12]">
              {filteredDirs.map((dir) => (
                <div
                  key={dir.path}
                  onClick={() => loadDirectory(dir.path)}
                  className="group px-3.5 py-2 hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Folder className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="text-xs text-zinc-200 truncate group-hover:text-white">
                      {dir.name}
                    </span>
                    {dir.projectMarkers.length > 0 && (
                      <div className="flex items-center gap-1 ml-2">
                        {dir.projectMarkers.map((m) => (
                          <span
                            key={m}
                            className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#1b1d24] text-zinc-400 border border-[#292c36]"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectFolder(dir.path);
                      onClose();
                    }}
                    className="opacity-0 group-hover:opacity-100 px-2.5 py-1 rounded bg-[#22252f] hover:bg-[#2c303d] text-zinc-100 text-[11px] font-medium transition shrink-0"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#0c0d10] border-t border-[#22242c] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Selected Target</div>
            <div className="font-mono text-xs text-zinc-200 truncate">
              {browseData?.currentPath || manualPath}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectFolder(browseData?.currentPath || manualPath, browseData?.detectedStacks);
                onClose();
              }}
              className="px-4 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Check className="w-3.5 h-3.5" />
              Open Directory
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
