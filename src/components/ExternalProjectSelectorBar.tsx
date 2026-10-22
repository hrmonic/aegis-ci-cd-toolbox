import React, { useState, useEffect } from 'react';
import {
  FolderSearch,
  FolderGit2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  History,
  ArrowRight,
  Layers,
  Trash2,
} from 'lucide-react';
import type { StackId } from '../types/toolbox';

interface SubFolderItem {
  name: string;
  path: string;
}

interface ExternalProjectSelectorBarProps {
  activeProjectPath: string;
  detectedStacks: StackId[];
  scanning: boolean;
  onSelectTargetProject: (targetPath: string, autoStacks?: StackId[]) => void;
}

export const ExternalProjectSelectorBar: React.FC<ExternalProjectSelectorBarProps> = ({
  activeProjectPath,
  detectedStacks,
  scanning,
  onSelectTargetProject,
}) => {
  const [inputPath, setInputPath] = useState(activeProjectPath);
  const [subFolders, setSubFolders] = useState<SubFolderItem[]>([]);
  const [inspectError, setInspectError] = useState<string | null>(null);
  // Stored strictly locally in the user's browser (never in source code or Git)
  const [recentPaths, setRecentPaths] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('aegis_recent_target_paths');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    setInputPath(activeProjectPath);
  }, [activeProjectPath]);

  const inspectAndTarget = async (targetPath: string) => {
    setInspectError(null);
    const trimmed = targetPath.trim();
    if (!trimmed) return;

    try {
      const res = await fetch('/api/projects/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.exists) {
        setInspectError(data.error || `Dossier introuvable : ${trimmed}`);
        return;
      }

      setSubFolders(data.subFolders || []);
      const normalized = data.projectPath || trimmed;
      setInputPath(normalized);

      const nextRecents = [
        normalized,
        ...recentPaths.filter((p) => p.toLowerCase() !== normalized.toLowerCase()),
      ].slice(0, 5);
      setRecentPaths(nextRecents);
      localStorage.setItem('aegis_recent_target_paths', JSON.stringify(nextRecents));

      onSelectTargetProject(normalized, data.detectedStacks);
    } catch {
      onSelectTargetProject(trimmed);
    }
  };

  const clearRecentHistory = () => {
    setRecentPaths([]);
    localStorage.removeItem('aegis_recent_target_paths');
  };

  useEffect(() => {
    if (!activeProjectPath) return;
    fetch('/api/projects/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: activeProjectPath }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.exists && Array.isArray(data.subFolders)) {
          setSubFolders(data.subFolders);
        }
      })
      .catch(() => {});
  }, [activeProjectPath]);

  return (
    <div className="max-w-[1600px] w-full mx-auto px-4 lg:px-6 pt-4">
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-slate-900/90 to-emerald-950/30 p-4 shadow-xl backdrop-blur-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              <FolderSearch className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xs sm:text-sm font-bold text-white">
                  Ciblage de Projet Externe (Mode 100% Indépendant & Sans Installation)
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Zero-Footprint : l’outil reste hors de vos projets
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Collez simplement le chemin local de n’importe quel dossier projet sur votre machine pour l’auditer en local (aucun chemin personnel n’est jamais commité ni partagé).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Stacks détectées :</span>
            {detectedStacks.map((st) => (
              <span
                key={st}
                className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-500/30"
              >
                {st}
              </span>
            ))}
          </div>
        </div>

        {/* Path Input Bar + 1-Click Target Button */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            inspectAndTarget(inputPath);
          }}
          className="flex flex-wrap sm:flex-nowrap items-center gap-2"
        >
          <div className="relative flex-1 min-w-[240px]">
            <FolderGit2 className="w-4 h-4 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              placeholder="Collez ici le chemin complet du dossier projet à analyser en local..."
              className="w-full rounded-xl bg-slate-950/90 border border-slate-700/90 focus:border-indigo-500 pl-9 pr-4 py-2 text-xs sm:text-sm font-mono text-white focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={scanning}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/25 transition shrink-0 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>{scanning ? 'Scan en cours...' : 'Cibler & Analyser ce Dossier'}</span>
          </button>
        </form>

        {/* Local Browser History (Private to this browser only) */}
        {recentPaths.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <History className="w-3 h-3" />
                Dossiers récents (stockés uniquement en local) :
              </span>
              {recentPaths.map((rp) => (
                <button
                  key={rp}
                  type="button"
                  onClick={() => inspectAndTarget(rp)}
                  className="px-2 py-0.5 rounded bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300"
                >
                  {rp}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={clearRecentHistory}
              className="text-[11px] text-slate-400 hover:text-rose-300 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Effacer l’historique local
            </button>
          </div>
        )}

        {/* Sub-directories inside current target project */}
        {subFolders.length > 0 && (
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-emerald-300 font-medium flex items-center gap-1 mr-1">
              <ArrowRight className="w-3.5 h-3.5" />
              Sous-dossiers détectés dans le projet ciblé :
            </span>
            {subFolders.map((sf) => (
              <button
                key={sf.path}
                type="button"
                onClick={() => inspectAndTarget(sf.path)}
                className="px-2.5 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-emerald-200 text-[11px] font-mono transition"
              >
                📁 {sf.name}
              </button>
            ))}
          </div>
        )}

        {inspectError && (
          <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{inspectError}</span>
          </div>
        )}
      </div>
    </div>
  );
};
