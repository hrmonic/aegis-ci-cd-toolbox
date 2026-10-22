import type {
  AdaptiveNotificationRule,
  Severity,
  SmartNotificationItem,
  DiagnosticCategory,
} from '../types/toolbox';

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const DEFAULT_NOTIFICATION_RULES: AdaptiveNotificationRule = {
  mode: 'adaptive-flow',
  userCadenceRpm: 6,
  currentFlowState: 'active-review',
  minSeverityDuringFocus: 'critical',
  digestIntervalMinutes: 15,
  quietHoursEnabled: false,
  quietHoursStart: '23:00',
  quietHoursEnd: '07:00',
  soundEnabled: false,
  desktopPushEnabled: false,
};

export function computeFlowStateFromCadence(rpm: number): 'deep-focus' | 'active-review' | 'idle' {
  if (rpm >= 14) return 'deep-focus';
  if (rpm >= 3) return 'active-review';
  return 'idle';
}

export function isWithinQuietHours(rule: AdaptiveNotificationRule, now = new Date()): boolean {
  if (!rule.quietHoursEnabled) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = rule.quietHoursStart.split(':').map(Number);
  const [endH, endM] = rule.quietHoursEnd.split(':').map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  if (startTotal <= endTotal) {
    return currentMinutes >= startTotal && currentMinutes <= endTotal;
  }
  return currentMinutes >= startTotal || currentMinutes <= endTotal;
}

export function evaluateNotificationDelivery(
  input: {
    title: string;
    message: string;
    severity: Severity;
    category: DiagnosticCategory | 'system' | 'sync' | 'ai';
    actionLabel?: string;
    findingId?: string;
  },
  rule: AdaptiveNotificationRule
): SmartNotificationItem {
  const inQuiet = isWithinQuietHours(rule);
  const itemRank = SEVERITY_RANK[input.severity];
  const focusMinRank = SEVERITY_RANK[rule.minSeverityDuringFocus];

  let deliveredImmediately = true;
  let deferredBecauseOfFlow = false;

  if (rule.mode === 'focus-dnd') {
    deliveredImmediately = input.severity === 'critical';
    deferredBecauseOfFlow = !deliveredImmediately;
  } else if (rule.mode === 'adaptive-flow') {
    if (inQuiet && input.severity !== 'critical') {
      deliveredImmediately = false;
      deferredBecauseOfFlow = true;
    } else if (rule.currentFlowState === 'deep-focus' && itemRank < focusMinRank) {
      // User is coding/fixing rapidly in Deep Focus -> defer non-critical notifications to digest
      deliveredImmediately = false;
      deferredBecauseOfFlow = true;
    } else if (rule.currentFlowState === 'active-review' && itemRank < SEVERITY_RANK.medium) {
      deliveredImmediately = false;
      deferredBecauseOfFlow = true;
    }
  }

  return {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: input.title,
    message: input.message,
    severity: input.severity,
    category: input.category,
    createdAt: new Date().toISOString(),
    deliveredImmediately,
    deferredBecauseOfFlow,
    read: false,
    actionLabel: input.actionLabel,
    findingId: input.findingId,
  };
}
