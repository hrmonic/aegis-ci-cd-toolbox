import React from 'react';
import {
  Bell,
  BrainCircuit,
  Clock,
  CheckCheck,
  Sparkles,
  Flame,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AdaptiveNotificationRule,
  SmartNotificationItem,
  Severity,
} from '../types/toolbox';

interface AdaptiveNotificationsPanelProps {
  rules: AdaptiveNotificationRule;
  notifications: SmartNotificationItem[];
  onUpdateRules: (next: AdaptiveNotificationRule) => void;
  onMarkAllRead: () => void;
  onFlushDeferredDigest: () => void;
  onSimulateFlowBurst: () => void;
}

export const AdaptiveNotificationsPanel: React.FC<AdaptiveNotificationsPanelProps> = ({
  rules,
  notifications,
  onUpdateRules,
  onMarkAllRead,
  onFlushDeferredDigest,
  onSimulateFlowBurst,
}) => {
  const deferredList = notifications.filter((n) => n.deferredBecauseOfFlow && !n.read);
  const activeList = notifications.filter((n) => !n.deferredBecauseOfFlow || n.read);

  const flowBadge =
    rules.currentFlowState === 'deep-focus'
      ? {
          label: 'Deep Focus (Flow Intense — Digest Actif)',
          color: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        }
      : rules.currentFlowState === 'active-review'
        ? {
            label: 'Revue Active (Filtrage Intelligent)',
            color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          }
        : {
            label: 'Veille / Disponible (Livraison Complète)',
            color: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
          };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
      {/* Left column: Cognitive Rhythm & Adaptive Configuration */}
      <div className="lg:col-span-5 space-y-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/90">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-slate-100">Rythme d’Utilisation & Flow</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[11px] border font-medium ${flowBadge.color}`}>
            {flowBadge.label}
          </span>
        </div>

        {/* Cadence Meter */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Cadence d’interaction temps réel</span>
            <span className="font-mono text-indigo-300 font-semibold">{rules.userCadenceRpm} actions / min</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-purple-500 transition-all duration-300"
              style={{ width: `${Math.min(100, (rules.userCadenceRpm / 25) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
            Lorsque votre cadence dépasse <strong className="text-slate-200">14 actions/min</strong>, le Studio passe automatiquement en{' '}
            <strong className="text-purple-300">Deep Focus</strong> et met en file d’attente les notifications non-critiques pour ne jamais interrompre votre résolution de bugs.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Mode d’Adaptation</label>
            <select
              value={rules.mode}
              onChange={(e) =>
                onUpdateRules({
                  ...rules,
                  mode: e.target.value as AdaptiveNotificationRule['mode'],
                })
              }
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="adaptive-flow">Auto-Adaptatif au Rythme</option>
              <option value="focus-dnd">Focus Strict (Critiques Seules)</option>
              <option value="instant-all">Temps Réel Intégral</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Seuil en Deep Focus</label>
            <select
              value={rules.minSeverityDuringFocus}
              onChange={(e) =>
                onUpdateRules({
                  ...rules,
                  minSeverityDuringFocus: e.target.value as Severity,
                })
              }
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="critical">Critique uniquement</option>
              <option value="high">Élevé & Critique</option>
              <option value="medium">Moyen et plus</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
          <label className="flex items-center gap-2 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={rules.quietHoursEnabled}
              onChange={(e) => onUpdateRules({ ...rules, quietHoursEnabled: e.target.checked })}
              className="rounded border-slate-600 text-indigo-500"
            />
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Heures Silencieuses ({rules.quietHoursStart} - {rules.quietHoursEnd})</span>
          </label>

          <button
            type="button"
            onClick={() => onUpdateRules({ ...rules, soundEnabled: !rules.soundEnabled })}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1"
          >
            {rules.soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
            <span>{rules.soundEnabled ? 'Son Actif' : 'Silencieux'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onSimulateFlowBurst}
            className="flex-1 px-2.5 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-200 font-medium flex items-center justify-center gap-1.5 transition"
          >
            <Flame className="w-3.5 h-3.5 text-purple-400" />
            Simuler Pic d’Activité (Deep Focus)
          </button>
          {deferredList.length > 0 && (
            <button
              type="button"
              onClick={onFlushDeferredDigest}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ouvrir Digest ({deferredList.length})
            </button>
          )}
        </div>
      </div>

      {/* Right column: Live Smart Notification Feed & Deferred Digest */}
      <div className="lg:col-span-7 flex flex-col justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/90">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-slate-100">
              Flux Intelligent ({activeList.length} livrées · {deferredList.length} différées par le Flow)
            </span>
          </div>

          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Tout marquer comme lu
          </button>
        </div>

        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
          {notifications.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              Aucune notification enregistrée. Lancez un scan ou appliquez un correctif.
            </div>
          ) : (
            notifications.slice(0, 10).map((item) => (
              <div
                key={item.id}
                className={`p-2.5 rounded-lg border flex items-start justify-between gap-3 transition ${
                  item.deferredBecauseOfFlow && !item.read
                    ? 'bg-purple-950/25 border-purple-500/30'
                    : item.severity === 'critical'
                      ? 'bg-rose-950/30 border-rose-500/40'
                      : 'bg-slate-900/70 border-slate-800'
                }`}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono uppercase ${
                        item.severity === 'critical'
                          ? 'bg-rose-500/20 text-rose-300'
                          : item.severity === 'high'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-indigo-500/20 text-indigo-300'
                      }`}
                    >
                      {item.severity}
                    </span>
                    <span className="font-semibold text-slate-100 truncate">{item.title}</span>
                    {item.deferredBecauseOfFlow && !item.read && (
                      <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[10px]">
                        Différée (Protection Flow)
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 text-[11px] leading-snug">{item.message}</p>
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                  {new Date(item.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
