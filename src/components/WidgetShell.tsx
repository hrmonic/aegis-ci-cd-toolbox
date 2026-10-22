import React from 'react';
import {
  ChevronUp,
  ChevronDown,
  Maximize2,
  EyeOff,
} from 'lucide-react';
import type { StudioWidgetConfig } from '../types/toolbox';

interface WidgetShellProps {
  config: StudioWidgetConfig;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  customizeMode: boolean;
  onMove: (id: StudioWidgetConfig['id'], dir: 'up' | 'down') => void;
  onCycleSize: (id: StudioWidgetConfig['id']) => void;
  onToggleVisible: (id: StudioWidgetConfig['id']) => void;
  children: React.ReactNode;
}

export const WidgetShell: React.FC<WidgetShellProps> = ({
  config,
  icon,
  badge,
  customizeMode,
  onMove,
  onCycleSize,
  onToggleVisible,
  children,
}) => {
  if (!config.visible) return null;

  const colSpanClass =
    config.size === 'full'
      ? 'col-span-12'
      : config.size === 'wide'
        ? 'col-span-12 xl:col-span-8'
        : 'col-span-12 md:col-span-6 xl:col-span-4';

  return (
    <section
      className={`${colSpanClass} rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-panel)]/95 shadow-xl shadow-black/30 backdrop-blur-md flex flex-col transition-all duration-200 ${
        customizeMode ? 'ring-2 ring-indigo-500/50' : ''
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--studio-border)] bg-black/20 rounded-t-2xl">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 shrink-0">
            {icon}
          </span>
          <h2 className="font-semibold text-sm tracking-tight text-slate-100 truncate">
            {config.title}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {badge}
          {customizeMode && (
            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-slate-700/70">
              <button
                type="button"
                onClick={() => onMove(config.id, 'up')}
                title="Déplacer le widget vers le haut"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMove(config.id, 'down')}
                title="Déplacer le widget vers le bas"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onCycleSize(config.id)}
                title={`Taille actuelle: ${config.size} (Cliquer pour changer)`}
                className="px-1.5 py-0.5 text-[10px] font-mono uppercase rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition flex items-center gap-1"
              >
                <Maximize2 className="w-3 h-3" />
                {config.size}
              </button>
              <button
                type="button"
                onClick={() => onToggleVisible(config.id)}
                title="Masquer ce widget"
                className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition"
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="p-4 flex-1 flex flex-col justify-between">{children}</div>
    </section>
  );
};
