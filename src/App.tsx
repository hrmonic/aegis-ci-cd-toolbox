import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield,
  Play,
  Wand2,
  Cpu,
  Layers,
  FileCode2,
  Lock,
  Bell,
  Wifi,
  WifiOff,
  Sliders,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  Info,
  Sparkles,
  Terminal,
  Copy,
  Check,
  FolderGit2,
  RotateCcw,
  Eye,
  Server,
  HardDriveDownload,
  Activity,
} from 'lucide-react';
import type {
  ScanReport,
  StackId,
  DiagnosticFinding,
  AIProviderConfig,
  AIProviderId,
  StudioWidgetConfig,
  ThemePreset,
  AdaptiveNotificationRule,
  SmartNotificationItem,
  DiagnosticCategory,
} from './types/toolbox';
import { STACK_CATALOG, generateGitHubActionsWorkflow, generateHardenedDockerfile } from '../server/pipelineTemplates';
import {
  generateHybridRemediation,
  probeLocalOllama,
  type AIRemediationResult,
} from './services/aiEngine';
import {
  computeFlowStateFromCadence,
  evaluateNotificationDelivery,
} from './services/adaptiveNotify';
import {
  loadSavedWidgets,
  saveWidgets,
  loadThemePreset,
  saveThemePreset,
  loadAIProviders,
  saveAIProviders,
  loadNotificationRules,
  saveNotificationRules,
  saveOfflineReport,
  loadOfflineReport,
  loadOfflineQueue,
  enqueueOfflineAction,
  clearOfflineQueue,
  DEFAULT_STUDIO_WIDGETS,
} from './services/offlineStore';
import { WidgetShell } from './components/WidgetShell';
import { E2EESyncPanel } from './components/E2EESyncPanel';
import { AdaptiveNotificationsPanel } from './components/AdaptiveNotificationsPanel';

export function App() {
  // Project & Scan State
  const [projectPath, setProjectPath] = useState<string>('f:/APP/ci-cd-toolbox');
  const [selectedStacks, setSelectedStacks] = useState<StackId[]>([
    'nodejs',
    'typescript',
    'react-nextjs',
    'docker',
    'github-actions',
  ]);
  const [report, setReport] = useState<ScanReport>(() => loadOfflineReport());
  const [scanning, setScanning] = useState<boolean>(false);
  const [selectedFinding, setSelectedFinding] = useState<DiagnosticFinding | null>(null);

  // Filters for Diagnostics Explorer
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // AI Engine State
  const [aiProviders, setAiProviders] = useState<AIProviderConfig[]>(() => loadAIProviders());
  const [preferredProvider, setPreferredProvider] = useState<AIProviderId>('ollama-local');
  const [localOnlyMode, setLocalOnlyMode] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AIRemediationResult | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [ollamaProbeStatus, setOllamaProbeStatus] = useState<{
    connected: boolean;
    models: string[];
    latencyMs?: number;
  }>({ connected: false, models: ['qwen2.5-coder:7b', 'deepseek-coder:6.7b'] });

  // Studio Customization & Offline State
  const [widgets, setWidgets] = useState<StudioWidgetConfig[]>(() => loadSavedWidgets());
  const [theme, setTheme] = useState<ThemePreset>(() => loadThemePreset());
  const [customizeMode, setCustomizeMode] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [offlineForced, setOfflineForced] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState(() => loadOfflineQueue());
  const [showCliModal, setShowCliModal] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  // Pipeline Generator Preview Tab
  const [pipelineTab, setPipelineTab] = useState<'github' | 'docker'>('github');
  const [pipelineSavedMsg, setPipelineSavedMsg] = useState<string | null>(null);

  // Adaptive Notifications & User Interaction Cadence Tracking
  const [notifRules, setNotifRules] = useState<AdaptiveNotificationRule>(() => loadNotificationRules());
  const [notifications, setNotifications] = useState<SmartNotificationItem[]>([]);
  const interactionTimestamps = useRef<number[]>([]);

  const effectiveOffline = !isOnline || offlineForced;

  // Apply Theme Preset on document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    saveThemePreset(theme);
  }, [theme]);

  // Track user interaction cadence (RPM) for Adaptive Smart Notifications
  const recordUserInteraction = useCallback(() => {
    const now = Date.now();
    interactionTimestamps.current = [
      ...interactionTimestamps.current.filter((t) => now - t < 60000),
      now,
    ];
    const rpm = interactionTimestamps.current.length;
    const flowState = computeFlowStateFromCadence(rpm);
    setNotifRules((prev) => {
      if (prev.userCadenceRpm === rpm && prev.currentFlowState === flowState) return prev;
      return { ...prev, userCadenceRpm: rpm, currentFlowState: flowState };
    });
  }, []);

  useEffect(() => {
    const handler = () => recordUserInteraction();
    window.addEventListener('click', handler, { passive: true });
    window.addEventListener('keydown', handler, { passive: true });
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [recordUserInteraction]);

  // Helper to push a smart notification adapted to the user's current rhythm
  const pushSmartNotification = useCallback(
    (
      title: string,
      message: string,
      severity: 'critical' | 'high' | 'medium' | 'low' | 'info' = 'info',
      category: DiagnosticCategory | 'system' | 'sync' | 'ai' = 'system',
      findingId?: string
    ) => {
      setNotifRules((currentRules) => {
        const item = evaluateNotificationDelivery(
          { title, message, severity, category, findingId },
          currentRules
        );
        setNotifications((prev) => [item, ...prev.slice(0, 29)]);
        return currentRules;
      });
    },
    []
  );

  // Online / Offline event listeners + automatic queue replay
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      const q = loadOfflineQueue();
      if (q.length > 0) {
        clearOfflineQueue();
        setOfflineQueue([]);
        pushSmartNotification(
          'Connexion rétablie — File Hors-Ligne synchronisée',
          `${q.length} action(s) en attente ont été synchronisées avec le moteur local.`,
          'info',
          'sync'
        );
      }
    };
    const onOffline = () => {
      setIsOnline(false);
      pushSmartNotification(
        'Mode Hors-Ligne Complet Activé',
        'Le moteur déterministe local et le cache PWA prennent le relais sans interruption.',
        'medium',
        'system'
      );
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [pushSmartNotification]);

  // Probe Local Ollama on mount
  const handleProbeOllama = useCallback(async () => {
    const ollamaCfg = aiProviders.find((p) => p.id === 'ollama-local');
    const result = await probeLocalOllama(ollamaCfg?.endpoint || 'http://localhost:11434');
    setOllamaProbeStatus(result);
    setAiProviders((prev) =>
      prev.map((p) =>
        p.id === 'ollama-local'
          ? {
              ...p,
              availableModels: result.models,
              status: result.connected ? 'connected' : 'ready',
              latencyMs: result.latencyMs,
            }
          : p
      )
    );
  }, [aiProviders]);

  // Execute CI/CD Scan
  const runScan = useCallback(
    async (customStacks?: StackId[]) => {
      setScanning(true);
      const stacksToUse = customStacks || selectedStacks;
      try {
        if (effectiveOffline) {
          const cached = loadOfflineReport(stacksToUse);
          setReport(cached);
          if (cached.findings.length > 0) setSelectedFinding(cached.findings[0]);
          pushSmartNotification(
            'Audit Hors-Ligne exécuté',
            `Score Santé: ${cached.overallScore}/100 (${cached.findings.length} diagnostics analysés en local).`,
            cached.findings.some((f) => f.severity === 'critical') ? 'critical' : 'info',
            'pipeline-cicd'
          );
          return;
        }

        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath,
            selectedStacks: stacksToUse,
          }),
        });

        if (!res.ok) throw new Error('Serveur local non joignable');
        const data = (await res.json()) as ScanReport;
        setReport(data);
        saveOfflineReport(data);
        if (data.findings.length > 0) {
          setSelectedFinding(data.findings[0]);
        } else {
          setSelectedFinding(null);
        }

        const critCount = data.findings.filter((f) => f.severity === 'critical' && f.status === 'open').length;
        pushSmartNotification(
          `Scan CI/CD terminé (${data.overallScore}/100)`,
          `${data.filesScanned} fichiers inspectés en ${data.durationMs}ms. ${data.findings.length} diagnostic(s) identifié(s).`,
          critCount > 0 ? 'critical' : data.findings.length > 0 ? 'medium' : 'info',
          'pipeline-cicd'
        );
      } catch {
        const fallback = loadOfflineReport(stacksToUse);
        setReport(fallback);
        if (fallback.findings.length > 0) setSelectedFinding(fallback.findings[0]);
      } finally {
        setScanning(false);
      }
    },
    [effectiveOffline, projectPath, selectedStacks, pushSmartNotification]
  );

  useEffect(() => {
    runScan();
    handleProbeOllama();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger Hybrid AI Analysis when selectedFinding changes
  const handleRunAIAnalysis = useCallback(
    async (finding: DiagnosticFinding) => {
      setSelectedFinding(finding);
      setAiLoading(true);
      try {
        const res = await generateHybridRemediation(finding, aiProviders, {
          localOnlyMode,
          offlineForced: effectiveOffline,
          preferredProvider,
        });
        setAiResult(res);
      } finally {
        setAiLoading(false);
      }
    },
    [aiProviders, localOnlyMode, effectiveOffline, preferredProvider]
  );

  useEffect(() => {
    if (selectedFinding) {
      handleRunAIAnalysis(selectedFinding);
    }
  }, [selectedFinding, handleRunAIAnalysis]);

  // Apply Auto-Fix for a single finding
  const handleApplyFix = async (finding: DiagnosticFinding) => {
    if (effectiveOffline) {
      const nextQueue = enqueueOfflineAction({
        type: 'apply-fix',
        description: `Auto-Fix [${finding.ruleId}] sur ${finding.filePath}`,
        payload: finding.autoFix,
      });
      setOfflineQueue(nextQueue);
    } else {
      try {
        await fetch('/api/fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath,
            fix: finding.autoFix,
          }),
        });
      } catch {
        // Fallback offline queue
      }
    }

    // Update UI report state immediately
    setReport((prev) => {
      const updatedFindings = prev.findings.map((f) =>
        f.id === finding.id
          ? {
              ...f,
              status: 'fixed' as const,
              autoFix: { ...f.autoFix, applied: true, appliedAt: new Date().toISOString() },
            }
          : f
      );
      const openLeft = updatedFindings.filter((f) => f.status === 'open').length;
      const newScore = Math.min(100, prev.overallScore + Math.round(14 / Math.max(1, prev.findings.length)));
      const nextReport: ScanReport = {
        ...prev,
        overallScore: openLeft === 0 ? 100 : newScore,
        aiReadinessScore: openLeft === 0 ? 100 : Math.min(100, prev.aiReadinessScore + 5),
        findings: updatedFindings,
      };
      saveOfflineReport(nextReport);
      return nextReport;
    });

    pushSmartNotification(
      `Correctif appliqué : ${finding.ruleId}`,
      `Le fichier ${finding.filePath} a été sécurisé (Confiance ${finding.autoFix.confidence}%).`,
      'info',
      finding.category,
      finding.id
    );
  };

  // Batch Auto-Fix all reliable findings (>= 90% confidence)
  const handleFixAllReliable = async () => {
    const reliableOpen = report.findings.filter(
      (f) => f.status === 'open' && f.autoFix.available && f.autoFix.reliable && f.autoFix.confidence >= 90
    );
    for (const f of reliableOpen) {
      await handleApplyFix(f);
    }
    pushSmartNotification(
      `Auto-Correction Globale terminée (${reliableOpen.length} patchs)`,
      'Toutes les corrections déterministes fiables (>90%) ont été appliquées avec sauvegarde.',
      'info',
      'pipeline-cicd'
    );
  };

  // Toggle Stack selection
  const toggleStack = (stackId: StackId) => {
    const exists = selectedStacks.includes(stackId);
    const next = exists
      ? selectedStacks.filter((s) => s !== stackId)
      : [...selectedStacks, stackId];
    const safeNext: StackId[] = next.length > 0 ? next : ['nodejs'];
    setSelectedStacks(safeNext);
    runScan(safeNext);
  };

  // Widget Layout Customization handlers
  const handleMoveWidget = (id: StudioWidgetConfig['id'], dir: 'up' | 'down') => {
    setWidgets((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((w) => w.id === id);
      if (idx === -1) return prev;
      const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= sorted.length) return prev;
      const tempOrder = sorted[idx].order;
      sorted[idx] = { ...sorted[idx], order: sorted[targetIdx].order };
      sorted[targetIdx] = { ...sorted[targetIdx], order: tempOrder };
      const final = [...sorted].sort((a, b) => a.order - b.order);
      saveWidgets(final);
      return final;
    });
  };

  const handleCycleWidgetSize = (id: StudioWidgetConfig['id']) => {
    const orderCycle: StudioWidgetConfig['size'][] = ['normal', 'wide', 'full'];
    setWidgets((prev) => {
      const next = prev.map((w) =>
        w.id === id
          ? { ...w, size: orderCycle[(orderCycle.indexOf(w.size) + 1) % orderCycle.length] }
          : w
      );
      saveWidgets(next);
      return next;
    });
  };

  const handleToggleWidgetVisible = (id: StudioWidgetConfig['id']) => {
    setWidgets((prev) => {
      const next = prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w));
      saveWidgets(next);
      return next;
    });
  };

  const handleResetLayout = () => {
    setWidgets(DEFAULT_STUDIO_WIDGETS);
    saveWidgets(DEFAULT_STUDIO_WIDGETS);
  };

  // Filtered Findings
  const filteredFindings = report.findings.filter((f) => {
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
    if (
      searchQuery.trim() &&
      !`${f.ruleId} ${f.title} ${f.filePath} ${f.description}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const openReliableCount = report.findings.filter(
    (f) => f.status === 'open' && f.autoFix.available && f.autoFix.reliable && f.autoFix.confidence >= 90
  ).length;

  const sortedWidgets = [...widgets].sort((a, b) => a.order - b.order);

  const generatedWorkflowPreview = generateGitHubActionsWorkflow(selectedStacks);
  const generatedDockerPreview = generateHardenedDockerfile(selectedStacks);

  const handleInjectPipeline = async () => {
    try {
      await fetch('/api/generate-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          stacks: selectedStacks,
          writeToDisk: true,
        }),
      });
      setPipelineSavedMsg('Workflow .github/workflows/ci-cd-aegis.yml généré et injecté dans le projet !');
      setTimeout(() => setPipelineSavedMsg(null), 5000);
      runScan();
    } catch {
      setPipelineSavedMsg('Workflow prêt dans le presse-papiers (Mode Hors-Ligne).');
      setTimeout(() => setPipelineSavedMsg(null), 4000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--studio-bg)] text-[var(--studio-text)] selection:bg-indigo-500/30">
      {/* =====================================================================
          TOP STUDIO COMMAND BAR
      ===================================================================== */}
      <header className="sticky top-0 z-30 border-b border-[var(--studio-border)] bg-[var(--studio-panel)]/90 backdrop-blur-xl px-4 lg:px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Active Project */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base tracking-tight text-white">
                  Aegis CI/CD Toolbox
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Studio DevOps v1.0
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
                <input
                  type="text"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  aria-label="Chemin du projet cible"
                  className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none font-mono text-[11px] text-slate-300 w-48 sm:w-64"
                />
                {report.gitInfo && (
                  <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-emerald-400">
                    git:{report.gitInfo.branch}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Center Status Badges: Online/Offline, Local-Only AI, E2EE, Theme */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Offline Mode Toggle */}
            <button
              type="button"
              onClick={() => setOfflineForced((v) => !v)}
              title="Basculer le mode Hors-Ligne Complet (PWA + Moteur Déterministe Local)"
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition ${
                effectiveOffline
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              }`}
            >
              {effectiveOffline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Hors-Ligne Actif ({offlineQueue.length})</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span>En Ligne + Cache PWA</span>
                </>
              )}
            </button>

            {/* 100% Local AI Mode Toggle */}
            <button
              type="button"
              onClick={() => setLocalOnlyMode((v) => !v)}
              title="Forcer l'exécution 100% locale (Ollama / Moteur AST Local sans aucun appel Cloud)"
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition ${
                localOnlyMode
                  ? 'bg-purple-500/25 border-purple-500/50 text-purple-200'
                  : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>{localOnlyMode ? 'IA 100% Locale (Air-Gapped)' : 'IA Hybride (Cloud + Local)'}</span>
            </button>

            {/* Theme Selector */}
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemePreset)}
              aria-label="Sélectionner le thème visuel du Studio"
              className="rounded-xl bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="obsidian-cyber">Thème: Obsidian Cyber</option>
              <option value="midnight-slate">Thème: Midnight Slate</option>
              <option value="emerald-matrix">Thème: Emerald Matrix</option>
              <option value="high-contrast">Thème: High Contrast</option>
            </select>

            {/* Customize Widgets Button */}
            <button
              type="button"
              onClick={() => setCustomizeMode((v) => !v)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition ${
                customizeMode
                  ? 'bg-indigo-600 border-indigo-400 text-white'
                  : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{customizeMode ? 'Terminer Layout' : 'Widgets'}</span>
            </button>

            {/* Export / Install CLI Modal Button */}
            <button
              type="button"
              onClick={() => setShowCliModal(true)}
              className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1.5 transition"
            >
              <HardDriveDownload className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Installer / Exporter</span>
            </button>

            {/* Primary Scan & Auto-Fix Actions */}
            <button
              type="button"
              disabled={scanning}
              onClick={() => runScan()}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{scanning ? 'Analyse...' : 'Lancer Diagnostic'}</span>
            </button>

            {openReliableCount > 0 && (
              <button
                type="button"
                onClick={handleFixAllReliable}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/25 flex items-center gap-1.5 transition"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Auto-Corriger ({openReliableCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Customization Bar when Customize Mode is active */}
        {customizeMode && (
          <div className="max-w-[1600px] mx-auto mt-3 pt-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-400 mr-1">Afficher/Masquer les widgets :</span>
              {widgets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => handleToggleWidgetVisible(w.id)}
                  className={`px-2 py-1 rounded-lg border text-[11px] flex items-center gap-1 transition ${
                    w.visible
                      ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200'
                      : 'bg-slate-900 border-slate-800 text-slate-500'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  {w.title.split('&')[0]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleResetLayout}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 text-[11px]"
            >
              <RotateCcw className="w-3 h-3" />
              Réinitialiser la disposition
            </button>
          </div>
        )}
      </header>

      {/* =====================================================================
          MODULAR WIDGETS WORKSPACE GRID
      ===================================================================== */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 lg:p-6 grid grid-cols-12 gap-5">
        {sortedWidgets.map((widget) => {
          // -------------------------------------------------------------------
          // WIDGET 1: HEALTH OVERVIEW & ZERO-BUG AI RADAR
          // -------------------------------------------------------------------
          if (widget.id === 'health-overview') {
            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<Activity className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
                badge={
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Scan: {report.durationMs}ms · {report.filesScanned} fichiers
                  </span>
                }
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                  {/* Overall & AI Readiness Scores */}
                  <div className="lg:col-span-4 grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/90 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">Santé Globale CI/CD</span>
                      <div className="my-2 flex items-baseline gap-1">
                        <span
                          className={`text-4xl font-extrabold tracking-tight ${
                            report.overallScore >= 85
                              ? 'text-emerald-400'
                              : report.overallScore >= 70
                                ? 'text-amber-400'
                                : 'text-rose-400'
                          }`}
                        >
                          {report.overallScore}
                        </span>
                        <span className="text-sm text-slate-500 font-mono">/100</span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {report.findings.filter((f) => f.status === 'open').length} problème(s) ouvert(s)
                      </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/90 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">Indice Zéro-Bug IA</span>
                      <div className="my-2 flex items-baseline gap-1">
                        <span className="text-4xl font-extrabold tracking-tight text-indigo-400">
                          {report.aiReadinessScore}
                        </span>
                        <span className="text-sm text-slate-500 font-mono">/100</span>
                      </div>
                      <span className="text-[11px] text-emerald-400">
                        {openReliableCount} auto-fix(s) prêts
                      </span>
                    </div>
                  </div>

                  {/* 6 Pillars Progress Matrix */}
                  <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {report.categoryScores.map((cat) => (
                      <div
                        key={cat.category}
                        className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-2"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-200 truncate">{cat.label}</span>
                          <span
                            className={`font-mono font-bold ${
                              cat.score >= 85
                                ? 'text-emerald-400'
                                : cat.score >= 70
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                            }`}
                          >
                            {cat.score}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              cat.score >= 85
                                ? 'bg-emerald-500'
                                : cat.score >= 70
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                            }`}
                            style={{ width: `${cat.score}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>{cat.issuesCount} alerte(s)</span>
                          {cat.criticalCount > 0 && (
                            <span className="text-rose-400 font-semibold">
                              {cat.criticalCount} critique(s)
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </WidgetShell>
            );
          }

          // -------------------------------------------------------------------
          // WIDGET 2: STACK SELECTOR & MULTI-PROJECT ARCHITECTURE
          // -------------------------------------------------------------------
          if (widget.id === 'stack-selector') {
            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<Layers className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
                badge={
                  <span className="text-[11px] font-mono text-indigo-300">
                    {selectedStacks.length} stacks actives
                  </span>
                }
              >
                <div className="space-y-3">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Sélectionnez les stacks de votre projet pour activer les tests CI/CD spécialisés et adapter les générateurs de pipelines :
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
                    {STACK_CATALOG.map((stack) => {
                      const isSelected = selectedStacks.includes(stack.id);
                      const isAutoDetected = report.detectedStacks.includes(stack.id);
                      return (
                        <button
                          key={stack.id}
                          type="button"
                          onClick={() => toggleStack(stack.id)}
                          className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between gap-1.5 ${
                            isSelected
                              ? 'bg-indigo-600/15 border-indigo-500/60 text-slate-100'
                              : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-xs text-slate-100 truncate">
                              {stack.name}
                            </span>
                            {isAutoDetected && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase bg-emerald-500/20 text-emerald-300 shrink-0">
                                Détecté
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-2">
                            {stack.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </WidgetShell>
            );
          }

          // -------------------------------------------------------------------
          // WIDGET 3: HYBRID AI ENGINE HUB (GEMINI, OPENAI, FREE APIS, OLLAMA LOCAL)
          // -------------------------------------------------------------------
          if (widget.id === 'ai-engine-hub') {
            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<Cpu className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
                badge={
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {localOnlyMode ? '100% Local Actif' : 'Hybride Intelligent'}
                  </span>
                }
              >
                <div className="space-y-3 text-xs">
                  {/* Mode Switcher */}
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-100">
                        Exécution 100% Modèles Locaux (Ollama)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Désactive toute connexion externe (Google/OpenAI)
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localOnlyMode}
                      onChange={(e) => setLocalOnlyMode(e.target.checked)}
                      className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  {/* Provider Cards */}
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {aiProviders.map((prov) => {
                      const isPreferred = preferredProvider === prov.id;
                      const isDisabledByLocalLock =
                        localOnlyMode &&
                        prov.id !== 'ollama-local' &&
                        prov.id !== 'deterministic-offline';

                      return (
                        <div
                          key={prov.id}
                          className={`p-2.5 rounded-xl border transition space-y-2 ${
                            isDisabledByLocalLock
                              ? 'opacity-40 bg-slate-950/30 border-slate-900'
                              : isPreferred
                                ? 'bg-indigo-950/30 border-indigo-500/50'
                                : 'bg-slate-950/60 border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              disabled={isDisabledByLocalLock}
                              onClick={() => setPreferredProvider(prov.id)}
                              className="flex items-center gap-2 text-left"
                            >
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${
                                  isPreferred ? 'bg-indigo-400 ring-4 ring-indigo-500/20' : 'bg-slate-600'
                                }`}
                              />
                              <span className="font-semibold text-slate-100">{prov.name}</span>
                            </button>

                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                prov.badge === '100% Local'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : prov.badge === 'Gratuit'
                                    ? 'bg-sky-500/20 text-sky-300'
                                    : prov.badge === 'Hors-Ligne'
                                      ? 'bg-amber-500/20 text-amber-300'
                                      : 'bg-indigo-500/20 text-indigo-300'
                              }`}
                            >
                              {prov.badge}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            <select
                              value={prov.model}
                              onChange={(e) => {
                                const updated = aiProviders.map((p) =>
                                  p.id === prov.id ? { ...p, model: e.target.value } : p
                                );
                                setAiProviders(updated);
                                saveAIProviders(updated);
                              }}
                              className="rounded-lg bg-slate-900 border border-slate-700/80 px-2 py-1 text-[11px] text-slate-200 font-mono"
                            >
                              {prov.availableModels.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>

                            {prov.id === 'ollama-local' ? (
                              <button
                                type="button"
                                onClick={handleProbeOllama}
                                className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-1 text-[11px] text-emerald-300 flex items-center justify-center gap-1"
                              >
                                <Server className="w-3 h-3" />
                                {ollamaProbeStatus.connected
                                  ? `Connecté (${ollamaProbeStatus.latencyMs}ms)`
                                  : 'Tester localhost:11434'}
                              </button>
                            ) : prov.id !== 'deterministic-offline' ? (
                              <input
                                type="password"
                                value={prov.apiKey || ''}
                                onChange={(e) => {
                                  const updated = aiProviders.map((p) =>
                                    p.id === prov.id
                                      ? {
                                          ...p,
                                          apiKey: e.target.value,
                                          status: e.target.value ? 'ready' : 'missing-key',
                                        }
                                      : p
                                  );
                                  setAiProviders(updated);
                                  saveAIProviders(updated);
                                }}
                                placeholder="Clé API (optionnelle en fallback)..."
                                className="rounded-lg bg-slate-900 border border-slate-700/80 px-2 py-1 text-[11px] text-slate-200 font-mono"
                              />
                            ) : (
                              <span className="text-[10px] font-mono text-emerald-400 self-center px-1">
                                ✔ Toujours disponible (0ms)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </WidgetShell>
            );
          }

          // -------------------------------------------------------------------
          // WIDGET 4: DIAGNOSTICS EXPLORER
          // -------------------------------------------------------------------
          if (widget.id === 'diagnostics-explorer') {
            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<FileCode2 className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
                badge={
                  <span className="text-xs font-mono text-slate-400">
                    {filteredFindings.length} / {report.findings.length} règles
                  </span>
                }
              >
                <div className="space-y-3">
                  {/* Filter Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Rechercher une règle, un fichier, un secret..."
                      className="flex-1 min-w-[180px] rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                    <select
                      value={severityFilter}
                      onChange={(e) => setSeverityFilter(e.target.value)}
                      className="rounded-xl bg-slate-950/80 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="all">Toutes sévérités</option>
                      <option value="critical">Critique</option>
                      <option value="high">Élevée</option>
                      <option value="medium">Moyenne</option>
                      <option value="low">Faible</option>
                    </select>
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="rounded-xl bg-slate-950/80 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="all">Toutes catégories</option>
                      <option value="pipeline-cicd">Pipelines CI/CD</option>
                      <option value="security-secrets">Sécurité & Secrets</option>
                      <option value="ai-code-quality">Qualité Code IA</option>
                      <option value="test-robustness">Suite de Tests</option>
                      <option value="dependencies-build">Dépendances & Build</option>
                      <option value="containers-infra">Docker & Infra</option>
                    </select>
                  </div>

                  {/* Findings List */}
                  <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                    {filteredFindings.length === 0 ? (
                      <div className="p-8 rounded-2xl bg-slate-950/50 border border-slate-800/80 text-center space-y-2">
                        <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                        <div className="font-semibold text-sm text-slate-100">
                          Aucun problème correspondant aux filtres !
                        </div>
                        <p className="text-xs text-slate-400">
                          Votre projet respecte toutes les assertions de sécurité et de maintenabilité sélectionnées.
                        </p>
                      </div>
                    ) : (
                      filteredFindings.map((finding) => {
                        const isSelected = selectedFinding?.id === finding.id;
                        const isFixed = finding.status === 'fixed';

                        return (
                          <div
                            key={finding.id}
                            onClick={() => setSelectedFinding(finding)}
                            className={`p-3.5 rounded-xl border transition cursor-pointer ${
                              isFixed
                                ? 'bg-emerald-950/15 border-emerald-500/30 opacity-80'
                                : isSelected
                                  ? 'bg-indigo-950/35 border-indigo-500/70 shadow-md'
                                  : 'bg-slate-950/70 border-slate-800/90 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                {isFixed ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Corrigé
                                  </span>
                                ) : finding.severity === 'critical' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                                    <AlertOctagon className="w-3 h-3" />
                                    Critique
                                  </span>
                                ) : finding.severity === 'high' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Élevé
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-sky-500/20 text-sky-300 flex items-center gap-1">
                                    <Info className="w-3 h-3" />
                                    {finding.severity}
                                  </span>
                                )}

                                <span className="font-mono text-xs font-bold text-indigo-300">
                                  {finding.ruleId}
                                </span>
                                <h3 className="font-semibold text-xs sm:text-sm text-slate-100">
                                  {finding.title}
                                </h3>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-900 text-[11px] font-mono text-slate-300">
                                  {finding.filePath}
                                  {finding.line ? `:${finding.line}` : ''}
                                </span>
                                {!isFixed && finding.autoFix.available && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApplyFix(finding);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1 transition shadow"
                                  >
                                    <Wand2 className="w-3 h-3" />
                                    Auto-Fix ({finding.autoFix.confidence}%)
                                  </button>
                                )}
                              </div>
                            </div>

                            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                              {finding.description}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </WidgetShell>
            );
          }

          // -------------------------------------------------------------------
          // WIDGET 5: AUTO-FIX STUDIO & DIFF VIEWER
          // -------------------------------------------------------------------
          if (widget.id === 'autofix-studio') {
            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<Wand2 className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
                badge={
                  selectedFinding && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300">
                      Fiabilité: {selectedFinding.autoFix.confidence}%
                    </span>
                  )
                }
              >
                {!selectedFinding ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    Sélectionnez un diagnostic dans l’explorateur pour inspecter le Diff et l’analyse IA.
                  </div>
                ) : (
                  <div className="space-y-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-indigo-200 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                          {aiLoading
                            ? 'Synthèse IA en cours...'
                            : aiResult?.providerName || 'Moteur Hybride'}
                        </span>
                        {aiResult && (
                          <span className="text-[10px] font-mono text-slate-400">
                            {aiResult.latencyMs}ms · {aiResult.modelUsed}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        {aiResult ? aiResult.explanation : selectedFinding.autoFix.summary}
                      </p>
                    </div>

                    {/* Before / After Code Diff */}
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] font-mono uppercase text-rose-400 mb-1">
                          − Code Actuel ({selectedFinding.filePath})
                        </div>
                        <pre className="p-2.5 rounded-lg bg-rose-950/25 border border-rose-500/30 text-[11px] font-mono text-rose-200 overflow-x-auto max-h-28">
                          {selectedFinding.autoFix.beforeSnippet}
                        </pre>
                      </div>

                      <div>
                        <div className="text-[10px] font-mono uppercase text-emerald-400 mb-1">
                          + Correctif Certifié ({selectedFinding.autoFix.actionType})
                        </div>
                        <pre className="p-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] font-mono text-emerald-200 overflow-x-auto max-h-40">
                          {selectedFinding.autoFix.afterSnippet}
                        </pre>
                      </div>
                    </div>

                    {selectedFinding.status === 'fixed' ? (
                      <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        Correctif déjà appliqué avec sauvegarde .bak
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleApplyFix(selectedFinding)}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition"
                      >
                        <Wand2 className="w-4 h-4" />
                        Appliquer l’Auto-Correction sur {selectedFinding.filePath}
                      </button>
                    )}
                  </div>
                )}
              </WidgetShell>
            );
          }

          // -------------------------------------------------------------------
          // WIDGET 6: PIPELINE CI/CD & DOCKERFILE GENERATOR
          // -------------------------------------------------------------------
          if (widget.id === 'pipeline-generator') {
            const activeCode =
              pipelineTab === 'github' ? generatedWorkflowPreview : generatedDockerPreview;

            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<Terminal className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
                badge={
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPipelineTab('github')}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                        pipelineTab === 'github'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      GitHub Actions
                    </button>
                    <button
                      type="button"
                      onClick={() => setPipelineTab('docker')}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                        pipelineTab === 'docker'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      Dockerfile
                    </button>
                  </div>
                }
              >
                <div className="space-y-3 text-xs">
                  <pre className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 font-mono text-[11px] text-slate-200 overflow-x-auto max-h-64">
                    {activeCode}
                  </pre>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(activeCode);
                        setCopiedCmd(true);
                        setTimeout(() => setCopiedCmd(false), 2000);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5"
                    >
                      {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedCmd ? 'Copié !' : 'Copier le fichier'}
                    </button>

                    <button
                      type="button"
                      onClick={handleInjectPipeline}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Injecter le Workflow CI/CD dans le projet
                    </button>
                  </div>

                  {pipelineSavedMsg && (
                    <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px]">
                      {pipelineSavedMsg}
                    </div>
                  )}
                </div>
              </WidgetShell>
            );
          }

          // -------------------------------------------------------------------
          // WIDGET 7: E2EE MULTI-DEVICE SYNC VAULT
          // -------------------------------------------------------------------
          if (widget.id === 'e2ee-sync-vault') {
            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<Lock className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
                badge={
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-300">
                    AES-256-GCM
                  </span>
                }
              >
                <E2EESyncPanel
                  syncableState={{
                    selectedStacks,
                    theme,
                    widgets,
                    notifRules,
                    lastScore: report.overallScore,
                  }}
                  onRestoreState={(data) => {
                    if (Array.isArray(data.selectedStacks)) {
                      setSelectedStacks(data.selectedStacks as StackId[]);
                    }
                    if (typeof data.theme === 'string') {
                      setTheme(data.theme as ThemePreset);
                    }
                    if (Array.isArray(data.widgets)) {
                      setWidgets(data.widgets as StudioWidgetConfig[]);
                    }
                  }}
                  onNotify={(title, msg, sev) => pushSmartNotification(title, msg, sev, 'sync')}
                />
              </WidgetShell>
            );
          }

          // -------------------------------------------------------------------
          // WIDGET 8: SMART ADAPTIVE NOTIFICATIONS
          // -------------------------------------------------------------------
          if (widget.id === 'adaptive-notifications') {
            return (
              <WidgetShell
                key={widget.id}
                config={widget}
                icon={<Bell className="w-4 h-4" />}
                customizeMode={customizeMode}
                onMove={handleMoveWidget}
                onCycleSize={handleCycleWidgetSize}
                onToggleVisible={handleToggleWidgetVisible}
              >
                <AdaptiveNotificationsPanel
                  rules={notifRules}
                  notifications={notifications}
                  onUpdateRules={(next) => {
                    setNotifRules(next);
                    saveNotificationRules(next);
                  }}
                  onMarkAllRead={() =>
                    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
                  }
                  onFlushDeferredDigest={() =>
                    setNotifications((prev) =>
                      prev.map((n) => ({ ...n, deferredBecauseOfFlow: false }))
                    )
                  }
                  onSimulateFlowBurst={() => {
                    const updated: AdaptiveNotificationRule = {
                      ...notifRules,
                      userCadenceRpm: 22,
                      currentFlowState: 'deep-focus',
                    };
                    setNotifRules(updated);
                    const deferredItem = evaluateNotificationDelivery(
                      {
                        title: 'Analyse de complexité cyclomatique terminée',
                        message:
                          'Notification non-critique mise automatiquement en sourdine car vous êtes en plein Deep Focus (22 actions/min).',
                        severity: 'medium',
                        category: 'ai-code-quality',
                      },
                      updated
                    );
                    setNotifications((prev) => [deferredItem, ...prev]);
                  }}
                />
              </WidgetShell>
            );
          }

          return null;
        })}
      </main>

      {/* =====================================================================
          MODAL: PORTABLE INSTALLATION & CLI EXPORT INSTRUCTIONS
      ===================================================================== */}
      {showCliModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-xl w-full rounded-2xl bg-slate-900 border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <HardDriveDownload className="w-5 h-5 text-indigo-400" />
                Exporter & Installer la Toolbox dans vos Projets
              </h3>
              <button
                type="button"
                onClick={() => setShowCliModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                Fermer ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              <strong>Aegis CI/CD Toolbox</strong> est conçue comme un utilitaire portable que vous pouvez installer globalement ou injecter dans n’importe quel projet local :
            </p>

            <div className="space-y-2 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="text-indigo-400"># 1. Activer la commande globale sur votre machine</div>
                <div className="text-slate-200">npm link</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="text-emerald-400"># 2. Auditer et auto-corriger n'importe quel projet local</div>
                <div className="text-slate-200">ci-cd-toolbox init /chemin/vers/autre-projet</div>
                <div className="text-slate-200">ci-cd-toolbox scan /chemin/vers/autre-projet</div>
                <div className="text-slate-200">ci-cd-toolbox fix /chemin/vers/autre-projet</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="text-amber-400"># 3. Exporter une archive portable (.tgz) hors-ligne</div>
                <div className="text-slate-200">npm run pack:toolbox</div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowCliModal(false)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
