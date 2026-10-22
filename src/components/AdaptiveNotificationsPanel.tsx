import React from 'react';
import {
  Clock,
  CheckCheck,
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
      {/* Left column: Cognitive Cadence & Filter Rules */}
      <div className="lg:col-span-5 space-y-4 p-4 rounded-md bg-[#0c0d10] border border-[#22242c]">
        <div className="flex items-center justify-between gap-2 border-b border-[#1e2028] pb-3">
          <div>
            <div className="font-semibold text-zinc-100">Adaptive Notification Cadence</div>
            <div className="text-[11px] text-zinc-400">
              Automatically batches non-critical alerts during high-cadence focus
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-[#181a20] border border-[#2a2d37] text-[10px] font-mono uppercase text-zinc-200">
            {rules.currentFlowState}
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Interaction Rate</span>
            <span className="font-mono text-zinc-200">{rules.userCadenceRpm} actions / min</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[#1a1c23] overflow-hidden">
            <div
              className="h-full bg-teal-400 transition-all duration-300"
              style={{ width: `${Math.min(100, (rules.userCadenceRpm / 25) * 100)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Delivery Policy</label>
            <select
              value={rules.mode}
              onChange={(e) =>
                onUpdateRules({
                  ...rules,
                  mode: e.target.value as AdaptiveNotificationRule['mode'],
                })
              }
              className="w-full rounded-md bg-[#121318] border border-[#252730] px-2.5 py-1.5 text-xs text-zinc-200"
            >
              <option value="adaptive-flow">Adaptive Flow</option>
              <option value="focus-dnd">Strict Focus (Critical Only)</option>
              <option value="instant-all">Immediate All</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Focus Threshold</label>
            <select
              value={rules.minSeverityDuringFocus}
              onChange={(e) =>
                onUpdateRules({
                  ...rules,
                  minSeverityDuringFocus: e.target.value as Severity,
                })
              }
              className="w-full rounded-md bg-[#121318] border border-[#252730] px-2.5 py-1.5 text-xs text-zinc-200"
            >
              <option value="critical">Critical Only</option>
              <option value="high">High & Critical</option>
              <option value="medium">Medium & Above</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#1e2028]">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
            <input
              type="checkbox"
              checked={rules.quietHoursEnabled}
              onChange={(e) => onUpdateRules({ ...rules, quietHoursEnabled: e.target.checked })}
              className="rounded border-zinc-700"
            />
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span>Quiet Hours ({rules.quietHoursStart} - {rules.quietHoursEnd})</span>
          </label>

          <button
            type="button"
            onClick={() => onUpdateRules({ ...rules, soundEnabled: !rules.soundEnabled })}
            className="px-2.5 py-1 rounded bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 flex items-center gap-1"
          >
            {rules.soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-zinc-500" />}
            <span>{rules.soundEnabled ? 'Sound On' : 'Muted'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onSimulateFlowBurst}
            className="flex-1 px-3 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-200 font-medium transition"
          >
            Test Deep-Focus Deferral (22 rpm)
          </button>
          {deferredList.length > 0 && (
            <button
              type="button"
              onClick={onFlushDeferredDigest}
              className="px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-medium transition"
            >
              Release Digest ({deferredList.length})
            </button>
          )}
        </div>
      </div>

      {/* Right column: Event Log */}
      <div className="lg:col-span-7 flex flex-col justify-between p-4 rounded-md bg-[#0c0d10] border border-[#22242c]">
        <div className="flex items-center justify-between mb-3 border-b border-[#1e2028] pb-2.5">
          <span className="font-semibold text-zinc-100">
            Activity & Notification Log ({notifications.length})
          </span>
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </button>
        </div>

        <div className="divide-y divide-[#181920] max-h-72 overflow-y-auto pr-1">
          {notifications.length === 0 ? (
            <div className="text-center py-10 text-zinc-500">No events logged yet.</div>
          ) : (
            notifications.slice(0, 14).map((item) => (
              <div
                key={item.id}
                className="py-2.5 flex items-start justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        item.severity === 'critical'
                          ? 'bg-red-400'
                          : item.severity === 'high'
                            ? 'bg-amber-400'
                            : 'bg-teal-400'
                      }`}
                    />
                    <span className="font-medium text-zinc-100 truncate">{item.title}</span>
                    {item.deferredBecauseOfFlow && !item.read && (
                      <span className="px-1.5 py-0.2 rounded bg-[#1b1d24] border border-[#2a2d38] text-zinc-400 text-[10px] font-mono">
                        Deferred (Flow)
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-400 text-[11px] pl-3.5">{item.message}</p>
                </div>
                <span className="text-[10px] font-mono text-zinc-500 shrink-0">
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
