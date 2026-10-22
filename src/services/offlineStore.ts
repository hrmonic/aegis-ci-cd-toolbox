import type {
  ScanReport,
  StackId,
  StudioWidgetConfig,
  ThemePreset,
  AIProviderConfig,
  AdaptiveNotificationRule,
  E2EESyncEnvelope,
} from '../types/toolbox';
import { DEFAULT_AI_PROVIDERS } from './aiEngine';
import { DEFAULT_NOTIFICATION_RULES } from './adaptiveNotify';

const STORAGE_KEYS = {
  LAST_REPORT: 'aegis_last_scan_report_v1',
  WIDGETS: 'aegis_studio_widgets_v1',
  THEME: 'aegis_studio_theme_v1',
  DENSITY: 'aegis_studio_density_v1',
  AI_PROVIDERS: 'aegis_ai_providers_v1',
  LOCAL_ONLY_AI: 'aegis_local_only_ai_v1',
  OFFLINE_FORCED: 'aegis_offline_forced_v1',
  NOTIF_RULES: 'aegis_notification_rules_v1',
  OFFLINE_QUEUE: 'aegis_offline_queue_v1',
  E2EE_ENVELOPE: 'aegis_e2ee_envelope_v1',
};

export const DEFAULT_STUDIO_WIDGETS: StudioWidgetConfig[] = [
  { id: 'health-overview', title: 'Santé Globale & Radar Zéro-Bug IA', visible: true, size: 'full', order: 1 },
  { id: 'stack-selector', title: 'Sélecteur & Architecture des Stacks', visible: true, size: 'normal', order: 2 },
  { id: 'ai-engine-hub', title: 'Moteur IA Hybride & Ollama Local', visible: true, size: 'normal', order: 3 },
  { id: 'diagnostics-explorer', title: 'Explorateur de Diagnostics CI/CD', visible: true, size: 'wide', order: 4 },
  { id: 'autofix-studio', title: 'Studio d’Auto-Correction & Diff Viewer', visible: true, size: 'normal', order: 5 },
  { id: 'pipeline-generator', title: 'Générateur de Pipelines & Docker Hardening', visible: true, size: 'wide', order: 6 },
  { id: 'e2ee-sync-vault', title: 'Synchronisation Multi-Appareils E2EE (AES-256-GCM)', visible: true, size: 'normal', order: 7 },
  { id: 'adaptive-notifications', title: 'Notifications Intelligentes & Rythme Cognitif', visible: true, size: 'full', order: 8 },
];

export interface OfflineQueuedAction {
  id: string;
  type: 'apply-fix' | 'sync-e2ee' | 'generate-pipeline';
  description: string;
  createdAt: string;
  payload: unknown;
}

export function loadSavedWidgets(): StudioWidgetConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WIDGETS);
    if (!raw) return DEFAULT_STUDIO_WIDGETS;
    const parsed = JSON.parse(raw) as StudioWidgetConfig[];
    return parsed.length === DEFAULT_STUDIO_WIDGETS.length ? parsed : DEFAULT_STUDIO_WIDGETS;
  } catch {
    return DEFAULT_STUDIO_WIDGETS;
  }
}

export function saveWidgets(widgets: StudioWidgetConfig[]): void {
  localStorage.setItem(STORAGE_KEYS.WIDGETS, JSON.stringify(widgets));
}

export function loadThemePreset(): ThemePreset {
  return (localStorage.getItem(STORAGE_KEYS.THEME) as ThemePreset) || 'obsidian-cyber';
}

export function saveThemePreset(theme: ThemePreset): void {
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

export function loadAIProviders(): AIProviderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AI_PROVIDERS);
    if (!raw) return DEFAULT_AI_PROVIDERS;
    return JSON.parse(raw);
  } catch {
    return DEFAULT_AI_PROVIDERS;
  }
}

export function saveAIProviders(providers: AIProviderConfig[]): void {
  localStorage.setItem(STORAGE_KEYS.AI_PROVIDERS, JSON.stringify(providers));
}

export function loadNotificationRules(): AdaptiveNotificationRule {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.NOTIF_RULES);
    if (!raw) return DEFAULT_NOTIFICATION_RULES;
    return { ...DEFAULT_NOTIFICATION_RULES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NOTIFICATION_RULES;
  }
}

export function saveNotificationRules(rules: AdaptiveNotificationRule): void {
  localStorage.setItem(STORAGE_KEYS.NOTIF_RULES, JSON.stringify(rules));
}

export function saveOfflineReport(report: ScanReport): void {
  localStorage.setItem(STORAGE_KEYS.LAST_REPORT, JSON.stringify(report));
}

export function loadOfflineReport(selectedStacks?: StackId[]): ScanReport {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_REPORT);
    if (raw) {
      const parsed = JSON.parse(raw) as ScanReport;
      if (!selectedStacks || selectedStacks.length === 0) return parsed;
    }
  } catch {
    // Fallback to rich offline snapshot
  }
  return buildOfflineFallbackReport(selectedStacks || ['nodejs', 'typescript', 'react-nextjs', 'docker', 'github-actions']);
}

export function loadOfflineQueue(): OfflineQueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineAction(action: Omit<OfflineQueuedAction, 'id' | 'createdAt'>): OfflineQueuedAction[] {
  const current = loadOfflineQueue();
  const next: OfflineQueuedAction[] = [
    ...current,
    {
      ...action,
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    },
  ];
  localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(next));
  return next;
}

export function clearOfflineQueue(): void {
  localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify([]));
}

export function saveLocalE2EEEnvelope(envelope: E2EESyncEnvelope): void {
  localStorage.setItem(STORAGE_KEYS.E2EE_ENVELOPE, JSON.stringify(envelope));
}

export function loadLocalE2EEEnvelope(): E2EESyncEnvelope | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.E2EE_ENVELOPE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function buildOfflineFallbackReport(stacks: StackId[]): ScanReport {
  return {
    id: `offline-scan-${Date.now()}`,
    projectPath: 'f:/APP/ci-cd-toolbox',
    projectName: 'ci-cd-toolbox (Cache Hors-Ligne Actif)',
    scannedAt: new Date().toISOString(),
    durationMs: 9,
    overallScore: 86,
    aiReadinessScore: 84,
    filesScanned: 28,
    detectedStacks: ['nodejs', 'typescript', 'react-nextjs', 'docker', 'github-actions'],
    selectedStacks: stacks,
    gitInfo: {
      branch: 'main',
      remoteUrl: 'https://github.com/hrmonic/ci-cd-toolbox.git',
      hasUncommitted: false,
    },
    categoryScores: [
      { category: 'pipeline-cicd', label: 'Pipelines CI/CD', score: 82, issuesCount: 1, criticalCount: 0 },
      { category: 'security-secrets', label: 'Sécurité & Secrets', score: 92, issuesCount: 1, criticalCount: 0 },
      { category: 'ai-code-quality', label: 'Robustesse Code IA', score: 85, issuesCount: 1, criticalCount: 0 },
      { category: 'test-robustness', label: 'Couverture & Tests', score: 84, issuesCount: 1, criticalCount: 0 },
      { category: 'dependencies-build', label: 'Build & Dépendances', score: 90, issuesCount: 1, criticalCount: 0 },
      { category: 'containers-infra', label: 'Docker & Infra', score: 85, issuesCount: 1, criticalCount: 0 },
    ],
    findings: [
      {
        id: 'offline-cicd-perms',
        ruleId: 'CICD-002',
        title: 'Permissions GITHUB_TOKEN à restreindre (Least-Privilege)',
        description:
          'Assurez-vous que chaque workflow GitHub Actions déclare explicitement `permissions: contents: read` pour protéger le dépôt contre les attaques Supply-Chain.',
        impact: 'Réduction de 90% de la surface d’attaque des actions tierces.',
        category: 'pipeline-cicd',
        severity: 'high',
        stack: 'github-actions',
        filePath: '.github/workflows/ci-cd-aegis.yml',
        line: 1,
        status: 'open',
        autoFix: {
          id: 'fix-offline-perms',
          available: true,
          reliable: true,
          confidence: 98,
          engine: 'deterministic',
          summary: 'Injecter le bloc `permissions: contents: read` en tête du workflow CI/CD.',
          filePath: '.github/workflows/ci-cd-aegis.yml',
          beforeSnippet: 'on:\n  push:\n    branches: [ main ]',
          afterSnippet: 'permissions:\n  contents: read\n\non:\n  push:\n    branches: [ main ]',
          actionType: 'replace-snippet',
        },
      },
      {
        id: 'offline-ai-catch',
        ruleId: 'AI-QUAL-001',
        title: 'Gestion d’erreur silencieuse potentielle dans les appels asynchrones IA',
        description:
          'Les promesses rejetées doivent systématiquement produire une trace structurée ou déclencher le moteur de fallback local.',
        impact: 'Garantit un comportement prédictible 100% sans bug silencieux.',
        category: 'ai-code-quality',
        severity: 'medium',
        stack: 'typescript',
        filePath: 'src/services/aiEngine.ts',
        line: 88,
        status: 'open',
        autoFix: {
          id: 'fix-offline-catch',
          available: true,
          reliable: true,
          confidence: 94,
          engine: 'hybrid-ai',
          summary: 'Journaliser le contexte de fallback et basculer proprement sur Ollama Local / AST.',
          filePath: 'src/services/aiEngine.ts',
          beforeSnippet: 'catch {\n  // Fallback\n}',
          afterSnippet: 'catch (err) {\n  console.debug("[Aegis Fallback Triggered]:", err);\n}',
          actionType: 'replace-snippet',
        },
      },
      {
        id: 'offline-docker-user',
        ruleId: 'DOCKER-002',
        title: 'Durcissement conteneur : Utilisateur non-root et HEALTHCHECK requis',
        description:
          'Le conteneur de production doit tourner sous l’utilisateur `node` non-privilégié avec une sonde `HEALTHCHECK`.',
        impact: 'Conformité CIS Docker Benchmark et auto-guérison en orchestrateur.',
        category: 'containers-infra',
        severity: 'medium',
        stack: 'docker',
        filePath: 'Dockerfile',
        line: 18,
        status: 'open',
        autoFix: {
          id: 'fix-offline-docker',
          available: true,
          reliable: true,
          confidence: 97,
          engine: 'deterministic',
          summary: 'Activer `USER node` et la directive `HEALTHCHECK` dans le Dockerfile.',
          filePath: 'Dockerfile',
          beforeSnippet: 'EXPOSE 4177\nCMD ["node", "bin/ci-cd-toolbox.js", "start"]',
          afterSnippet:
            'USER node\nEXPOSE 4177\nHEALTHCHECK --interval=30s --timeout=5s CMD wget --spider http://localhost:4177/api/health || exit 1\nCMD ["node", "bin/ci-cd-toolbox.js", "start"]',
          actionType: 'replace-snippet',
        },
      },
    ],
  };
}
