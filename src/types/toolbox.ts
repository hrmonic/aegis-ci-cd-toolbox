export type StackId =
  | 'nodejs'
  | 'typescript'
  | 'react-nextjs'
  | 'python'
  | 'php-symfony'
  | 'go'
  | 'rust'
  | 'docker'
  | 'github-actions'
  | 'gitlab-ci';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type DiagnosticCategory =
  | 'pipeline-cicd'
  | 'security-secrets'
  | 'ai-code-quality'
  | 'test-robustness'
  | 'dependencies-build'
  | 'containers-infra';

export type AIProviderId =
  | 'gemini'
  | 'openai'
  | 'free-openrouter'
  | 'free-groq'
  | 'ollama-local'
  | 'deterministic-offline';

export interface StackDefinition {
  id: StackId;
  name: string;
  category: 'language' | 'framework' | 'devops';
  description: string;
  detected: boolean;
  selected: boolean;
  indicators: string[];
  recommendedChecks: string[];
}

export interface AutoFixProposal {
  id: string;
  available: boolean;
  reliable: boolean;
  confidence: number; // 0 - 100
  engine: 'deterministic' | 'hybrid-ai' | 'ollama-local';
  summary: string;
  filePath: string;
  beforeSnippet: string;
  afterSnippet: string;
  actionType: 'replace-snippet' | 'create-file' | 'append-file' | 'json-patch';
  applied?: boolean;
  appliedAt?: string;
}

export interface DiagnosticFinding {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  impact: string;
  category: DiagnosticCategory;
  severity: Severity;
  stack: StackId;
  filePath: string;
  line?: number;
  status: 'open' | 'fixed' | 'ignored';
  autoFix: AutoFixProposal;
}

export interface CategoryScore {
  category: DiagnosticCategory;
  label: string;
  score: number;
  issuesCount: number;
  criticalCount: number;
}

export interface ScanReport {
  id: string;
  projectPath: string;
  projectName: string;
  scannedAt: string;
  durationMs: number;
  overallScore: number;
  aiReadinessScore: number;
  filesScanned: number;
  detectedStacks: StackId[];
  selectedStacks: StackId[];
  categoryScores: CategoryScore[];
  findings: DiagnosticFinding[];
  gitInfo?: {
    branch: string;
    remoteUrl: string;
    hasUncommitted: boolean;
  };
}

export interface AIProviderConfig {
  id: AIProviderId;
  name: string;
  badge: 'Cloud' | 'Gratuit' | '100% Local' | 'Hors-Ligne';
  enabled: boolean;
  apiKey?: string;
  endpoint: string;
  model: string;
  availableModels: string[];
  status: 'ready' | 'missing-key' | 'offline' | 'connected';
  latencyMs?: number;
}

export interface StudioWidgetConfig {
  id:
    | 'health-overview'
    | 'stack-selector'
    | 'diagnostics-explorer'
    | 'autofix-studio'
    | 'ai-engine-hub'
    | 'pipeline-generator'
    | 'e2ee-sync-vault'
    | 'adaptive-notifications';
  title: string;
  visible: boolean;
  size: 'normal' | 'wide' | 'full';
  order: number;
}

export type ThemePreset = 'obsidian-cyber' | 'midnight-slate' | 'emerald-matrix' | 'high-contrast';

export interface AdaptiveNotificationRule {
  mode: 'adaptive-flow' | 'focus-dnd' | 'instant-all';
  userCadenceRpm: number; // actions per minute
  currentFlowState: 'deep-focus' | 'active-review' | 'idle';
  minSeverityDuringFocus: Severity;
  digestIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  soundEnabled: boolean;
  desktopPushEnabled: boolean;
}

export interface SmartNotificationItem {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  category: DiagnosticCategory | 'system' | 'sync' | 'ai';
  createdAt: string;
  deliveredImmediately: boolean;
  deferredBecauseOfFlow: boolean;
  read: boolean;
  actionLabel?: string;
  findingId?: string;
}

export interface E2EESyncEnvelope {
  version: '1.0';
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  deviceId: string;
  deviceName: string;
  syncedAt: string;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  cleartextHashSha256: string;
}
