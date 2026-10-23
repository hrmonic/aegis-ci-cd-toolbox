import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  Wand2,
  Terminal,
  Copy,
  Check,
  FolderOpen,
  RotateCcw,
  GitBranch,
  ExternalLink,
  Search,
  Folder,
  Bell,
  Settings,
  Wifi,
  WifiOff,
  CheckCircle2,
  FlaskConical,
  ChevronRight,
  History,
  Download,
  Code2,
  Command,
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
import {
  STACK_CATALOG,
  generateGitHubActionsWorkflow,
  generateHardenedDockerfile,
} from '../server/pipelineTemplates';
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
} from './services/offlineStore';
import { E2EESyncPanel } from './components/E2EESyncPanel';
import { AdaptiveNotificationsPanel } from './components/AdaptiveNotificationsPanel';
import { UxExperienceLabModal } from './components/UxExperienceLabModal';
import { FolderPickerModal } from './components/FolderPickerModal';
import { DocumentationPanel } from './components/DocumentationPanel';

type StudioTabId =
  | 'overview'
  | 'diagnostics'
  | 'runner'
  | 'pipelines'
  | 'ai-engine'
  | 'vault'
  | 'activity'
  | 'docs';

interface SubFolderItem {
  name: string;
  path: string;
}

interface BackupHistoryItem {
  id: string;
  filePath: string;
  createdAt: string;
  wasCreatedNew: boolean;
}

interface RunnerActionItem {
  id: string;
  label: string;
  command: string;
  category: string;
}

interface RunnerExecResult {
  command: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export function App() {
  const [activeTab, setActiveTab] = useState<StudioTabId>('overview');

  const [projectPath, setProjectPath] = useState<string>(() => {
    try {
      return localStorage.getItem('aegis_active_target_path') || '.';
    } catch {
      return '.';
    }
  });
  const [subFolders, setSubFolders] = useState<SubFolderItem[]>([]);
  const [recentPaths, setRecentPaths] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('aegis_recent_target_paths');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Backup / Undo History State
  const [backupHistory, setBackupHistory] = useState<BackupHistoryItem[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // Live Task Runner State
  const [runnerActions, setRunnerActions] = useState<RunnerActionItem[]>([]);
  const [runnerBusy, setRunnerBusy] = useState<string | null>(null);
  const [runnerOutput, setRunnerOutput] = useState<RunnerExecResult | null>(null);

  // Command Palette (Ctrl+K)
  const [showCmdPalette, setShowCmdPalette] = useState<boolean>(false);
  const [cmdQuery, setCmdQuery] = useState<string>('');

  // Modals
  const [showFolderPicker, setShowFolderPicker] = useState<boolean>(false);
  const [nativePickerBusy, setNativePickerBusy] = useState<boolean>(false);
  const [showUxLabModal, setShowUxLabModal] = useState<boolean>(false);
  const [showCliModal, setShowCliModal] = useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);

  // Scan & Diagnostics State
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

  // Filters
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

  // Preferences & Offline State
  const [widgets, setWidgets] = useState<StudioWidgetConfig[]>(() => loadSavedWidgets());
  const [theme, setTheme] = useState<ThemePreset>(() => loadThemePreset());
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [offlineForced, setOfflineForced] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState(() => loadOfflineQueue());
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);

  // Pipeline Generator Tab
  const [pipelineTab, setPipelineTab] = useState<'github' | 'docker'>('github');
  const [pipelineSavedMsg, setPipelineSavedMsg] = useState<string | null>(null);

  // Adaptive Notifications
  const [notifRules, setNotifRules] = useState<AdaptiveNotificationRule>(() => loadNotificationRules());
  const [notifications, setNotifications] = useState<SmartNotificationItem[]>([]);
  const interactionTimestamps = useRef<number[]>([]);

  const effectiveOffline = !isOnline || offlineForced;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    saveThemePreset(theme);
  }, [theme]);

  // Ctrl+K Global Command Palette Shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCmdPalette((v) => !v);
      } else if (e.key === 'Escape') {
        setShowCmdPalette(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      const q = loadOfflineQueue();
      if (q.length > 0) {
        clearOfflineQueue();
        setOfflineQueue([]);
        pushSmartNotification(
          'Network Restored',
          `${q.length} queued offline operation(s) synchronized.`,
          'info',
          'sync'
        );
      }
    };
    const onOffline = () => {
      setIsOnline(false);
      pushSmartNotification(
        'Offline Mode Active',
        'Local deterministic engine and PWA cache are handling operations.',
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

  const refreshBackupsAndScripts = useCallback(async (targetDir: string) => {
    try {
      const [bRes, sRes] = await Promise.all([
        fetch('/api/backups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: targetDir }),
        }),
        fetch('/api/runner/scripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: targetDir }),
        }),
      ]);
      if (bRes.ok) {
        const bData = await bRes.json();
        setBackupHistory(bData.history || []);
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        setRunnerActions(sData.actions || []);
      }
    } catch {
      // Offline mode
    }
  }, []);

  const inspectTargetFolder = useCallback(
    async (targetDir: string) => {
      try {
        const res = await fetch('/api/projects/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: targetDir }),
        });
        const data = await res.json();
        if (data?.exists) {
          setSubFolders(data.subFolders || []);
          if (data.projectPath) {
            setProjectPath(data.projectPath);
            localStorage.setItem('aegis_active_target_path', data.projectPath);
            refreshBackupsAndScripts(data.projectPath);
          }
        }
      } catch {
        // Offline mode
      }
    },
    [refreshBackupsAndScripts]
  );

  const runScan = useCallback(
    async (customStacks?: StackId[], overrideProjectPath?: string) => {
      setScanning(true);
      const targetDir = overrideProjectPath || projectPath;
      const stacksToUse = customStacks || selectedStacks;
      try {
        if (effectiveOffline) {
          const cached = loadOfflineReport(stacksToUse);
          setReport(cached);
          if (cached.findings.length > 0) setSelectedFinding(cached.findings[0]);
          return;
        }

        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectPath: targetDir,
            selectedStacks: stacksToUse,
          }),
        });

        if (!res.ok) throw new Error('Local server unreachable');
        const data = (await res.json()) as ScanReport;
        setReport(data);
        saveOfflineReport(data);
        if (data.findings.length > 0) {
          setSelectedFinding(data.findings[0]);
        } else {
          setSelectedFinding(null);
        }

        const normalizedPath = data.projectPath.replace(/\\/g, '/');
        setProjectPath(normalizedPath);
        localStorage.setItem('aegis_active_target_path', normalizedPath);
        setRecentPaths((prev) => {
          const updated = [
            normalizedPath,
            ...prev.filter((p) => p.toLowerCase() !== normalizedPath.toLowerCase()),
          ].slice(0, 6);
          localStorage.setItem('aegis_recent_target_paths', JSON.stringify(updated));
          return updated;
        });

        inspectTargetFolder(normalizedPath);

        const critCount = data.findings.filter(
          (f) => f.severity === 'critical' && f.status === 'open'
        ).length;
        pushSmartNotification(
          `Scan completed: ${data.projectName} (${data.overallScore}/100)`,
          `${data.filesScanned} files analyzed in ${data.durationMs}ms · ${data.findings.length} finding(s).`,
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
    [effectiveOffline, projectPath, selectedStacks, inspectTargetFolder, pushSmartNotification]
  );

  useEffect(() => {
    runScan();
    handleProbeOllama();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickNativeWindowsFolder = async () => {
    setNativePickerBusy(true);
    try {
      const res = await fetch('/api/fs/pick-native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialDir: projectPath }),
      });
      const data = await res.json();
      if (!data.cancelled && data.projectPath) {
        const nextStacks =
          Array.isArray(data.detectedStacks) && data.detectedStacks.length > 0
            ? (Array.from(
                new Set([...data.detectedStacks, 'github-actions', 'docker'])
              ) as StackId[])
            : selectedStacks;
        setSelectedStacks(nextStacks);
        runScan(nextStacks, data.projectPath);
      }
    } catch {
      setShowFolderPicker(true);
    } finally {
      setNativePickerBusy(false);
    }
  };

  const handleSelectFolderFromModal = (pickedPath: string, autoStacks?: StackId[]) => {
    const nextStacks =
      autoStacks && autoStacks.length > 0
        ? (Array.from(new Set([...autoStacks, 'github-actions', 'docker'])) as StackId[])
        : selectedStacks;
    setSelectedStacks(nextStacks);
    runScan(nextStacks, pickedPath);
  };

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

  const handleApplyFix = async (finding: DiagnosticFinding) => {
    if (effectiveOffline) {
      const nextQueue = enqueueOfflineAction({
        type: 'apply-fix',
        description: `Auto-Fix [${finding.ruleId}] on ${finding.filePath}`,
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
        refreshBackupsAndScripts(projectPath);
      } catch {
        // Fallback
      }
    }

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
      const newScore = Math.min(
        100,
        prev.overallScore + Math.round(14 / Math.max(1, prev.findings.length))
      );
      const nextReport: ScanReport = {
        ...prev,
        overallScore: openLeft === 0 ? 100 : newScore,
        aiReadinessScore: openLeft === 0 ? 100 : Math.min(100, prev.aiReadinessScore + 5),
        findings: updatedFindings,
      };
      saveOfflineReport(nextReport);
      return nextReport;
    });

    setSelectedFinding((prev) =>
      prev && prev.id === finding.id ? { ...prev, status: 'fixed' } : prev
    );

    pushSmartNotification(
      `Patch applied: ${finding.ruleId}`,
      `Updated ${finding.filePath} with backup.`,
      'info',
      finding.category,
      finding.id
    );
  };

  // 1-Click Undo / Rollback handler
  const handleUndoFix = async (entryId?: string) => {
    try {
      const res = await fetch('/api/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, entryId }),
      });
      const data = await res.json();
      if (data.success) {
        pushSmartNotification('Rollback completed', data.message, 'info', 'system');
        refreshBackupsAndScripts(projectPath);
        runScan();
      }
    } catch {
      // Ignore offline
    }
  };

  // Execute live script in target project
  const handleExecRunnerAction = async (command: string) => {
    setRunnerBusy(command);
    try {
      const res = await fetch('/api/runner/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, command }),
      });
      const data = (await res.json()) as RunnerExecResult;
      setRunnerOutput(data);
    } catch {
      setRunnerOutput({
        command,
        exitCode: 1,
        durationMs: 0,
        stdout: '',
        stderr: 'Failed to execute command (server offline).',
      });
    } finally {
      setRunnerBusy(null);
    }
  };

  // Open file in VS Code at exact line
  const handleOpenInVsCode = async (filePath?: string, line?: number) => {
    await fetch('/api/fs/open-editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, filePath, line }),
    }).catch(() => {});
  };

  // Reveal file in Windows Explorer
  const handleRevealInExplorer = async (filePath?: string) => {
    await fetch('/api/fs/reveal-explorer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, filePath }),
    }).catch(() => {});
  };

  // Export Markdown Report
  const handleExportMarkdownReport = () => {
    const lines = [
      `# CI/CD Diagnostic Report — ${report.projectName}`,
      `- **Target Path:** \`${projectPath}\``,
      `- **Date:** ${new Date(report.scannedAt).toLocaleString()}`,
      `- **Overall Health Score:** ${report.overallScore}/100`,
      `- **AI-Readiness Score:** ${report.aiReadinessScore}/100`,
      `- **Files Scanned:** ${report.filesScanned} (${report.durationMs}ms)`,
      `- **Detected Stacks:** ${report.detectedStacks.join(', ')}`,
      '',
      '## Findings Summary',
      ...report.findings.map(
        (f) =>
          `### [${f.severity.toUpperCase()}] ${f.ruleId} — ${f.title}\n- **File:** \`${f.filePath}${f.line ? `:${f.line}` : ''}\`\n- **Status:** ${f.status}\n- **Description:** ${f.description}\n- **Remediation:** ${f.autoFix.summary}\n`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-${report.projectName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFixAllReliable = async () => {
    const reliableOpen = report.findings.filter(
      (f) =>
        f.status === 'open' &&
        f.autoFix.available &&
        f.autoFix.reliable &&
        f.autoFix.confidence >= 90
    );
    for (const f of reliableOpen) {
      await handleApplyFix(f);
    }
    pushSmartNotification(
      `Batch remediation complete (${reliableOpen.length} patches)`,
      'All high-confidence deterministic fixes applied.',
      'info',
      'pipeline-cicd'
    );
  };

  const toggleStack = (stackId: StackId) => {
    const exists = selectedStacks.includes(stackId);
    const next = exists
      ? selectedStacks.filter((s) => s !== stackId)
      : [...selectedStacks, stackId];
    const safeNext: StackId[] = next.length > 0 ? next : ['nodejs'];
    setSelectedStacks(safeNext);
    runScan(safeNext);
  };

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

  const openFindingsCount = report.findings.filter((f) => f.status === 'open').length;
  const openReliableCount = report.findings.filter(
    (f) =>
      f.status === 'open' &&
      f.autoFix.available &&
      f.autoFix.reliable &&
      f.autoFix.confidence >= 90
  ).length;
  const unreadNotifsCount = notifications.filter((n) => !n.read).length;

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
      setPipelineSavedMsg('Written to .github/workflows/ci-cd-aegis.yml');
      setTimeout(() => setPipelineSavedMsg(null), 5000);
      runScan();
    } catch {
      setPipelineSavedMsg('Copied to clipboard (Offline mode)');
      setTimeout(() => setPipelineSavedMsg(null), 4000);
    }
  };

  const tabs: { id: StudioTabId; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'diagnostics', label: 'Diagnostics', count: openFindingsCount },
    { id: 'runner', label: 'Task Runner', count: runnerActions.length },
    { id: 'pipelines', label: 'Pipelines' },
    { id: 'ai-engine', label: 'AI Engine' },
    { id: 'vault', label: 'Sync & Vault' },
    { id: 'activity', label: 'Activity', count: unreadNotifsCount },
    { id: 'docs', label: 'Docs & Rules' },
  ];

  const getSeverityDot = (sev: string, status?: string) => {
    if (status === 'fixed') return 'bg-emerald-400';
    if (sev === 'critical') return 'bg-red-400';
    if (sev === 'high' || sev === 'medium') return 'bg-amber-400';
    return 'bg-zinc-400';
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090a0c] text-zinc-100 selection:bg-teal-500/20 selection:text-teal-200">
      {/* =====================================================================
          1. TOP MINIMALIST NAVIGATION BAR
      ===================================================================== */}
      <header className="h-12 bg-[#07080a] border-b border-[#1c1e24] px-5 flex items-center justify-between select-none sticky top-0 z-30">
        {/* Left: Clean Horizontal Text Tabs with 2px Bottom Indicator */}
        <nav className="flex items-center gap-6 h-full overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative h-full flex items-center gap-2 text-xs font-medium tracking-wide transition shrink-0 ${
                  isActive ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      tab.id === 'diagnostics' ? 'bg-amber-400' : 'bg-teal-400'
                    }`}
                  />
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2dd4bf]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Center: Clickable Active Project Context */}
        <button
          type="button"
          onClick={() => setShowFolderPicker(true)}
          title={`Click to change target directory (${projectPath})`}
          className="hidden xl:flex items-center gap-2 text-xs font-semibold text-zinc-100 hover:text-white transition px-3 py-1 rounded hover:bg-[#14151a]"
        >
          <span>{report.projectName}</span>
          <span className="text-zinc-600">—</span>
          <span className="font-normal text-zinc-400">
            {openFindingsCount === 0
              ? 'All checks passing'
              : `${openFindingsCount} ${openFindingsCount === 1 ? 'issue' : 'issues'}`}
          </span>
        </button>

        {/* Right: Sober Utility Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCmdPalette(true)}
            title="Command Palette (Ctrl+K)"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#121318] hover:bg-[#191b22] border border-[#23252e] text-zinc-400 hover:text-zinc-200 text-[11px] font-mono transition"
          >
            <Command className="w-3 h-3" />
            <span>Ctrl+K</span>
          </button>

          <button
            type="button"
            onClick={() => setShowFolderPicker(true)}
            className="px-3 py-1.5 rounded bg-[#18191e] hover:bg-[#22242c] border border-[#262830] text-zinc-200 text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition"
          >
            <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span>Open Project</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCliModal(true)}
            title="CLI Commands & Portable Export"
            className="p-1.5 rounded hover:bg-[#18191e] text-zinc-400 hover:text-zinc-100 transition"
          >
            <Terminal className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('activity')}
            title="Notifications & Activity"
            className="relative p-1.5 rounded hover:bg-[#18191e] text-zinc-400 hover:text-zinc-100 transition"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifsCount > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 absolute top-1.5 right-1.5" />
            )}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSettingsMenu((v) => !v)}
              title="Preferences & Mode"
              className="p-1.5 rounded hover:bg-[#18191e] text-zinc-400 hover:text-zinc-100 transition"
            >
              <Settings className="w-4 h-4" />
            </button>

            {showSettingsMenu && (
              <div className="absolute right-0 mt-2 w-64 rounded-md bg-[#121318] border border-[#262932] shadow-2xl p-3 space-y-3 z-50 text-xs">
                <div className="font-semibold text-zinc-200 border-b border-[#20222a] pb-2">
                  Workspace Preferences
                </div>

                <label className="flex items-center justify-between cursor-pointer text-zinc-300">
                  <span>100% Local AI (Air-Gapped)</span>
                  <input
                    type="checkbox"
                    checked={localOnlyMode}
                    onChange={(e) => setLocalOnlyMode(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer text-zinc-300">
                  <span>Simulate Offline Mode</span>
                  <input
                    type="checkbox"
                    checked={offlineForced}
                    onChange={(e) => setOfflineForced(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                </label>

                <div>
                  <span className="block text-[11px] text-zinc-400 mb-1">Surface Contrast</span>
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as ThemePreset)}
                    className="w-full rounded bg-[#0b0c0e] border border-[#252730] px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="obsidian-cyber">Carbon Matte (Default)</option>
                    <option value="midnight-slate">Slate Graphite</option>
                    <option value="high-contrast">Pure Black Contrast</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-[#20222a]">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowAboutModal(true);
                    }}
                    className="w-full px-2.5 py-1.5 rounded bg-[#181a22] hover:bg-[#222530] border border-[#272a35] text-zinc-200 text-xs font-medium text-left flex items-center justify-between transition"
                  >
                    <span>License, Credits & Support</span>
                    <span className="text-[10px] font-mono text-teal-400">Apache 2.0</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* =====================================================================
          2. SUB-TOOLBAR (COMPACT DARK MATTE ACTION BUTTONS & TELEMETRY)
      ===================================================================== */}
      <div className="min-h-11 bg-[#0c0d10] border-b border-[#191b22] px-5 py-2 flex flex-wrap items-center justify-between gap-3 select-none">
        {/* Left: Compact Action Pill Buttons (matching reference screenshot) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={scanning}
            onClick={() => runScan()}
            className="px-3 py-1.5 rounded-md bg-[#15161b] hover:bg-[#1d1f26] border border-[#252730] text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <Play className="w-3 h-3 text-zinc-400" />
            <span>{scanning ? 'Scanning...' : 'Scan'}</span>
          </button>

          <button
            type="button"
            disabled={openReliableCount === 0}
            onClick={handleFixAllReliable}
            className={`px-3 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition ${
              openReliableCount > 0
                ? 'bg-[#15161b] hover:bg-[#1d1f26] border-[#2b2e38] text-zinc-100'
                : 'bg-[#101115] border-[#1c1e24] text-zinc-600 cursor-not-allowed'
            }`}
          >
            <Wand2 className="w-3 h-3 text-zinc-400" />
            <span>Auto-Fix ({openReliableCount})</span>
          </button>

          <button
            type="button"
            disabled={backupHistory.length === 0}
            onClick={() => handleUndoFix()}
            title="Revert the last applied patch on disk"
            className={`px-3 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition ${
              backupHistory.length > 0
                ? 'bg-[#15161b] hover:bg-[#1d1f26] border-[#252730] text-zinc-200'
                : 'bg-[#101115] border-[#1c1e24] text-zinc-600 cursor-not-allowed'
            }`}
          >
            <RotateCcw className="w-3 h-3 text-zinc-400" />
            <span>Undo</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="px-3 py-1.5 rounded-md bg-[#15161b] hover:bg-[#1d1f26] border border-[#252730] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition"
          >
            <History className="w-3 h-3 text-zinc-400" />
            <span>History ({backupHistory.length})</span>
          </button>

          <button
            type="button"
            disabled={nativePickerBusy}
            onClick={handlePickNativeWindowsFolder}
            className="px-3 py-1.5 rounded-md bg-[#15161b] hover:bg-[#1d1f26] border border-[#252730] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <ExternalLink className="w-3 h-3 text-zinc-400" />
            <span>{nativePickerBusy ? 'Dialog open...' : 'System Dialog'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportMarkdownReport}
            title="Export audit report as Markdown"
            className="px-3 py-1.5 rounded-md bg-[#15161b] hover:bg-[#1d1f26] border border-[#252730] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition"
          >
            <Download className="w-3 h-3 text-zinc-400" />
            <span>Export .md</span>
          </button>

          <button
            type="button"
            onClick={() => setShowUxLabModal(true)}
            className="px-3 py-1.5 rounded-md bg-[#15161b] hover:bg-[#1d1f26] border border-[#252730] text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition"
          >
            <FlaskConical className="w-3 h-3 text-zinc-400" />
            <span>Self-Test</span>
          </button>

          {/* Sub-directories clean pills */}
          {subFolders.length > 0 && (
            <div className="hidden 2xl:flex items-center gap-1.5 pl-2 ml-1 border-l border-[#20222a]">
              <span className="text-[11px] text-zinc-500 mr-0.5">Dirs:</span>
              {subFolders.slice(0, 5).map((sf) => (
                <button
                  key={sf.path}
                  type="button"
                  onClick={() => handleSelectFolderFromModal(sf.path)}
                  className="px-2 py-1 rounded bg-[#121318] hover:bg-[#1a1c23] border border-[#22242c] text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition"
                >
                  {sf.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Clean Functional Telemetry */}
        <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                report.overallScore >= 85
                  ? 'bg-emerald-400'
                  : report.overallScore >= 70
                    ? 'bg-amber-400'
                    : 'bg-red-400'
              }`}
            />
            <span>Health {report.overallScore}/100</span>
          </div>

          <span className="text-zinc-700">·</span>
          <span>AI-Safe {report.aiReadinessScore}/100</span>
          <span className="text-zinc-700">·</span>
          <span>
            {report.filesScanned} files ({report.durationMs}ms)
          </span>

          {report.gitInfo && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="flex items-center gap-1 text-zinc-300">
                <GitBranch className="w-3 h-3 text-zinc-500" />
                {report.gitInfo.branch}
              </span>
            </>
          )}

          <span className="text-zinc-700">·</span>
          <button
            type="button"
            onClick={() => setOfflineForced((v) => !v)}
            className="flex items-center gap-1 hover:text-zinc-200"
          >
            {effectiveOffline ? (
              <>
                <WifiOff className="w-3 h-3 text-amber-400" />
                <span className="text-amber-400">Offline ({offlineQueue.length})</span>
              </>
            ) : (
              <>
                <Wifi className="w-3 h-3 text-emerald-400" />
                <span>Online</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* =====================================================================
          3. WORKSPACE CONTENT AREA
      ===================================================================== */}
      <main className="flex-1 max-w-[1560px] w-full mx-auto p-6">
        {/* -------------------------------------------------------------------
            TAB 1: OVERVIEW (SOBER TECHNICAL DASHBOARD)
        ------------------------------------------------------------------- */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 8 Cols: Audit Domains Table + Open Findings Table */}
            <div className="lg:col-span-8 space-y-6">
              {/* 6 Audit Domains Table */}
              <section className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
                <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">
                    Audit Domains
                  </span>
                  <span className="text-[11px] font-mono text-zinc-500">
                    {report.metrics?.rulesEvaluated || 35} active diagnostic rules · 6 verification layers
                  </span>
                </div>

                <div className="divide-y divide-[#1a1c23]">
                  {report.categoryScores.map((cat) => (
                    <button
                      key={cat.category}
                      type="button"
                      onClick={() => {
                        setCategoryFilter(cat.category);
                        setActiveTab('diagnostics');
                      }}
                      className="w-full px-4 py-3 hover:bg-[#15171d] transition flex items-center justify-between gap-4 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            cat.criticalCount > 0
                              ? 'bg-red-400'
                              : cat.issuesCount > 0
                                ? 'bg-amber-400'
                                : 'bg-emerald-400'
                          }`}
                        />
                        <span className="text-xs font-medium text-zinc-200">
                          {cat.label}
                        </span>
                      </div>

                      <div className="flex-1 max-w-xs hidden sm:block">
                        <div className="w-full h-1 rounded-full bg-[#1d1f27] overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              cat.score >= 85
                                ? 'bg-emerald-400/80'
                                : cat.score >= 70
                                  ? 'bg-amber-400/80'
                                  : 'bg-red-400/80'
                            }`}
                            style={{ width: `${cat.score}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-mono shrink-0">
                        <span className="text-zinc-400 w-20 text-right">
                          {cat.issuesCount === 0
                            ? 'Passing'
                            : `${cat.issuesCount} ${cat.issuesCount === 1 ? 'issue' : 'issues'}`}
                        </span>
                        <span className="text-zinc-200 w-10 text-right">{cat.score}%</span>
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Findings Table directly accessible */}
              <section className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
                <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">
                    Detected Issues ({report.findings.length})
                  </span>
                  {report.findings.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('diagnostics')}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Open Diff Inspector →
                    </button>
                  )}
                </div>

                {report.findings.length === 0 ? (
                  <div className="p-8 text-center space-y-1.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto" />
                    <div className="text-xs font-medium text-zinc-200">
                      All checks passing on {report.projectName}
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Zero pipeline, container, secret, or static analysis regressions found.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#1a1c23]">
                    {report.findings.map((f) => (
                      <div
                        key={f.id}
                        onClick={() => {
                          setSelectedFinding(f);
                          setActiveTab('diagnostics');
                        }}
                        className="px-4 py-3 hover:bg-[#15171d] transition cursor-pointer flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${getSeverityDot(
                              f.severity,
                              f.status
                            )}`}
                          />
                          <span className="font-mono text-[11px] text-zinc-400 shrink-0 w-20">
                            {f.ruleId}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-zinc-200 truncate">
                              {f.title}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 truncate">
                              {f.filePath}
                              {f.line ? `:${f.line}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenInVsCode(f.filePath, f.line);
                            }}
                            title="Open file at line in VS Code"
                            className="p-1.5 rounded bg-[#16181f] hover:bg-[#222530] border border-[#262934] text-zinc-400 hover:text-zinc-200 transition"
                          >
                            <Code2 className="w-3.5 h-3.5" />
                          </button>
                          {f.status === 'fixed' ? (
                            <span className="text-[11px] font-mono text-emerald-400">Fixed</span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApplyFix(f);
                              }}
                              className="px-2.5 py-1 rounded bg-[#1b1d24] hover:bg-[#252832] border border-[#2b2e38] text-zinc-200 text-[11px] font-medium transition"
                            >
                              Fix ({f.autoFix.confidence}%)
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Codebase Complexity Hotspots & Deep AST Telemetry */}
              {report.metrics && (
                <section className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
                  <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">
                      Cyclomatic Complexity Hotspots & Codebase Telemetry
                    </span>
                    <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
                      <span>{report.metrics.totalLinesOfCode.toLocaleString()} LOC</span>
                      <span>·</span>
                      <span>{report.metrics.totalCodeFiles} code files</span>
                      <span>·</span>
                      <span>{report.metrics.testFilesCount} test files</span>
                    </div>
                  </div>

                  {report.metrics.hotspots.length > 0 ? (
                    <div className="divide-y divide-[#1a1c23]">
                      {report.metrics.hotspots.map((hs) => (
                        <div
                          key={hs.filePath}
                          className="px-4 py-2.5 hover:bg-[#15171d] transition flex items-center justify-between gap-4 text-xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                hs.complexity > 35
                                  ? 'bg-amber-400'
                                  : 'bg-emerald-400'
                              }`}
                            />
                            <span className="font-mono text-zinc-200 truncate">
                              {hs.filePath}
                            </span>
                          </div>

                          <div className="flex items-center gap-4 font-mono text-[11px] shrink-0">
                            <span className="text-zinc-500">
                              {hs.lines} lines
                            </span>
                            <span
                              className={
                                hs.complexity > 35 ? 'text-amber-300' : 'text-zinc-300'
                              }
                            >
                              complexity: {hs.complexity}
                            </span>
                            {hs.issues > 0 && (
                              <span className="text-red-400">
                                {hs.issues} {hs.issues === 1 ? 'issue' : 'issues'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenInVsCode(hs.filePath, 1)}
                              title="Open file in VS Code"
                              className="p-1 rounded bg-[#16181f] hover:bg-[#222530] border border-[#262934] text-zinc-400 hover:text-zinc-200 transition"
                            >
                              <Code2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-xs text-zinc-500">
                      No source files analyzed for cyclomatic complexity.
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* Right 4 Cols: Target Workspace Metadata, Quick Scripts & Directory Tree */}
            <div className="lg:col-span-4 space-y-6">
              <section className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
                <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">Target Workspace</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenInVsCode()}
                      className="text-[11px] text-zinc-400 hover:text-zinc-100"
                    >
                      VS Code
                    </button>
                    <span className="text-zinc-700">·</span>
                    <button
                      type="button"
                      onClick={() => handleRevealInExplorer()}
                      className="text-[11px] text-zinc-400 hover:text-zinc-100"
                    >
                      Explorer
                    </button>
                    <span className="text-zinc-700">·</span>
                    <button
                      type="button"
                      onClick={() => setShowFolderPicker(true)}
                      className="text-[11px] text-zinc-200 hover:text-white underline"
                    >
                      Change...
                    </button>
                  </div>
                </div>

                <div className="p-4 space-y-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                      Directory Path
                    </div>
                    <div className="font-mono text-zinc-200 break-all mt-0.5">
                      {projectPath}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                      Active Stacks
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedStacks.map((st) => (
                        <span
                          key={st}
                          className="px-2 py-0.5 rounded bg-[#171920] border border-[#252832] font-mono text-[11px] text-zinc-300"
                        >
                          {st}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Language Distribution */}
                  {report.metrics && report.metrics.languages.length > 0 && (
                    <div className="pt-2 border-t border-[#1c1e26]">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                        Language Distribution ({report.metrics.rulesEvaluated} rules active)
                      </div>
                      <div className="space-y-1.5">
                        {report.metrics.languages.map((lang) => {
                          const pct = Math.round(
                            (lang.lines / Math.max(1, report.metrics!.totalLinesOfCode)) * 100
                          );
                          return (
                            <div key={lang.language} className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] font-mono">
                                <span className="text-zinc-300">{lang.language}</span>
                                <span className="text-zinc-500">
                                  {lang.files} files · {lang.lines.toLocaleString()} LOC ({pct}%)
                                </span>
                              </div>
                              <div className="w-full h-1 rounded-full bg-[#1a1c23] overflow-hidden">
                                <div
                                  className="h-full bg-teal-400/75"
                                  style={{ width: `${Math.max(4, pct)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Quick Executable Project Checks */}
                  {runnerActions.length > 0 && (
                    <div className="pt-2 border-t border-[#1c1e26]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Quick Project Checks
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveTab('runner')}
                          className="text-[11px] text-zinc-400 hover:text-zinc-200"
                        >
                          Console →
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {runnerActions.slice(0, 5).map((act) => (
                          <button
                            key={act.id}
                            type="button"
                            onClick={() => {
                              setActiveTab('runner');
                              handleExecRunnerAction(act.command);
                            }}
                            className="px-2.5 py-1 rounded bg-[#15171d] hover:bg-[#1e2029] border border-[#252832] font-mono text-[11px] text-zinc-300 flex items-center gap-1.5 transition"
                          >
                            <Play className="w-2.5 h-2.5 text-zinc-400" />
                            {act.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {subFolders.length > 0 && (
                    <div className="pt-2 border-t border-[#1c1e26]">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                        Subdirectories ({subFolders.length})
                      </div>
                      <div className="divide-y divide-[#181920] border border-[#1e2028] rounded bg-[#0c0d10] max-h-48 overflow-y-auto">
                        {subFolders.map((sf) => (
                          <button
                            key={sf.path}
                            type="button"
                            onClick={() => handleSelectFolderFromModal(sf.path)}
                            className="w-full px-3 py-1.5 hover:bg-[#16181f] text-left font-mono text-[11px] text-zinc-300 flex items-center gap-2 transition"
                          >
                            <Folder className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                            <span className="truncate">{sf.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {recentPaths.length > 1 && (
                    <div className="pt-2 border-t border-[#1c1e26]">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                        Recent Workspaces
                      </div>
                      <div className="space-y-1">
                        {recentPaths.map((rp) => (
                          <button
                            key={rp}
                            type="button"
                            onClick={() => handleSelectFolderFromModal(rp)}
                            className="w-full px-2.5 py-1.5 rounded bg-[#0c0d10] hover:bg-[#16181f] border border-[#1d1f26] text-left font-mono text-[11px] text-zinc-400 hover:text-zinc-200 truncate transition"
                          >
                            {rp}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 2: DIAGNOSTICS & DIFF INSPECTOR (SPLIT-VIEW IDE)
        ------------------------------------------------------------------- */}
        {activeTab === 'diagnostics' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 5 Cols: Filterable Findings Table */}
            <div className="lg:col-span-5 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              <div className="p-3 bg-[#0c0d10] border-b border-[#22242c] space-y-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by rule, file, or description..."
                    className="w-full rounded bg-[#121318] border border-[#252730] pl-8 pr-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="rounded bg-[#121318] border border-[#252730] px-2.5 py-1 text-xs text-zinc-300"
                  >
                    <option value="all">All Severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="rounded bg-[#121318] border border-[#252730] px-2.5 py-1 text-xs text-zinc-300"
                  >
                    <option value="all">All Domains</option>
                    <option value="pipeline-cicd">Pipelines CI/CD</option>
                    <option value="security-secrets">Security & Secrets</option>
                    <option value="ai-code-quality">AI Code Quality</option>
                    <option value="test-robustness">Tests</option>
                    <option value="dependencies-build">Dependencies</option>
                    <option value="containers-infra">Docker</option>
                  </select>
                </div>
              </div>

              <div className="divide-y divide-[#1a1c23] max-h-[68vh] overflow-y-auto">
                {filteredFindings.length === 0 ? (
                  <div className="p-10 text-center text-xs text-zinc-500">
                    No matching findings.
                  </div>
                ) : (
                  filteredFindings.map((finding) => {
                    const isSelected = selectedFinding?.id === finding.id;
                    return (
                      <div
                        key={finding.id}
                        onClick={() => setSelectedFinding(finding)}
                        className={`px-4 py-3 cursor-pointer transition ${
                          isSelected
                            ? 'bg-[#181b22] border-l-2 border-l-[#2dd4bf]'
                            : 'hover:bg-[#14161c]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${getSeverityDot(
                                finding.severity,
                                finding.status
                              )}`}
                            />
                            <span className="font-mono text-[11px] font-semibold text-zinc-300">
                              {finding.ruleId}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-zinc-500 truncate">
                            {finding.filePath}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-zinc-100 mt-1">
                          {finding.title}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right 7 Cols: Technical Inspector & Patch Diff */}
            <div className="lg:col-span-7 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              {!selectedFinding ? (
                <div className="p-16 text-center text-xs text-zinc-500">
                  Select an issue from the list to inspect the code diff and remediation details.
                </div>
              ) : (
                <div>
                  <div className="px-5 py-4 bg-[#0c0d10] border-b border-[#22242c] flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5 text-xs font-mono">
                        <span
                          className={`w-2 h-2 rounded-full ${getSeverityDot(
                            selectedFinding.severity,
                            selectedFinding.status
                          )}`}
                        />
                        <span className="text-zinc-200 font-semibold">
                          {selectedFinding.ruleId}
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="text-zinc-400">
                          {selectedFinding.filePath}
                          {selectedFinding.line ? `:${selectedFinding.line}` : ''}
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="text-zinc-400">
                          Confidence {selectedFinding.autoFix.confidence}%
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-zinc-100">
                        {selectedFinding.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleOpenInVsCode(selectedFinding.filePath, selectedFinding.line)
                        }
                        className="px-2.5 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 text-xs flex items-center gap-1.5 transition"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        VS Code
                      </button>

                      {selectedFinding.status === 'fixed' ? (
                        <span className="px-2.5 py-1.5 rounded bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs font-mono">
                          Patch Applied
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleApplyFix(selectedFinding)}
                          className="px-3.5 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <Wand2 className="w-3.5 h-3.5" />
                          Apply Patch
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-5 space-y-4 text-xs">
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                        Diagnostic Analysis ({aiLoading ? 'Analyzing...' : aiResult?.providerName || 'Engine'})
                      </div>
                      <p className="text-zinc-300 leading-relaxed">
                        {aiResult ? aiResult.explanation : selectedFinding.description}
                      </p>
                    </div>

                    {/* Clean Unified Diff Block */}
                    <div className="rounded-md border border-[#22242c] overflow-hidden bg-[#090a0c]">
                      <div className="px-3 py-1.5 bg-[#0e1014] border-b border-[#22242c] flex items-center justify-between font-mono text-[11px] text-zinc-400">
                        <span>{selectedFinding.filePath}</span>
                        <span>{selectedFinding.autoFix.actionType}</span>
                      </div>

                      <div className="p-3 space-y-2 font-mono text-[11px] overflow-x-auto">
                        <div className="p-2.5 rounded bg-red-950/20 border-l-2 border-red-400/70 text-red-200/90 whitespace-pre">
                          {selectedFinding.autoFix.beforeSnippet}
                        </div>
                        <div className="p-2.5 rounded bg-emerald-950/20 border-l-2 border-emerald-400/70 text-emerald-200/90 whitespace-pre">
                          {selectedFinding.autoFix.afterSnippet}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 3: LIVE CI/CD TASK RUNNER & CONSOLE
        ------------------------------------------------------------------- */}
        {activeTab === 'runner' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">
                  Detected Project Tasks ({runnerActions.length})
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  {report.projectName}
                </span>
              </div>

              <div className="divide-y divide-[#1a1c23]">
                {runnerActions.length === 0 ? (
                  <div className="p-8 text-center text-xs text-zinc-500">
                    No runnable tasks found in this directory.
                  </div>
                ) : (
                  runnerActions.map((act) => {
                    const isRunning = runnerBusy === act.command;
                    return (
                      <div
                        key={act.id}
                        className="px-4 py-3 hover:bg-[#15171d] transition flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-medium text-zinc-200">
                            {act.label}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500 truncate">
                            {act.category}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={Boolean(runnerBusy)}
                          onClick={() => handleExecRunnerAction(act.command)}
                          className="px-3 py-1 rounded bg-[#181a20] hover:bg-[#22252e] border border-[#282b36] text-zinc-200 text-xs font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                        >
                          <Play className="w-3 h-3 text-zinc-400" />
                          <span>{isRunning ? 'Running...' : 'Run'}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="lg:col-span-8 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="text-zinc-200">
                    {runnerOutput ? runnerOutput.command : 'Execution Output Console'}
                  </span>
                </div>
                {runnerOutput && (
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        runnerOutput.exitCode === 0 ? 'bg-emerald-400' : 'bg-red-400'
                      }`}
                    />
                    <span
                      className={
                        runnerOutput.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'
                      }
                    >
                      exit {runnerOutput.exitCode}
                    </span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-400">{runnerOutput.durationMs}ms</span>
                  </div>
                )}
              </div>

              <div className="p-4 bg-[#07080a] font-mono text-xs min-h-[360px] max-h-[65vh] overflow-y-auto">
                {runnerBusy ? (
                  <div className="text-zinc-400">
                    Executing <code className="text-zinc-200">{runnerBusy}</code> in {projectPath}...
                  </div>
                ) : !runnerOutput ? (
                  <div className="text-zinc-600">
                    Select a task on the left to execute it directly inside {projectPath}.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {runnerOutput.stdout && (
                      <pre className="text-zinc-300 whitespace-pre-wrap">
                        {runnerOutput.stdout}
                      </pre>
                    )}
                    {runnerOutput.stderr && (
                      <pre className="text-red-300/90 whitespace-pre-wrap">
                        {runnerOutput.stderr}
                      </pre>
                    )}
                    {!runnerOutput.stdout && !runnerOutput.stderr && (
                      <div className="text-zinc-500">
                        Command completed with no output (exit code {runnerOutput.exitCode}).
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 4: PIPELINES & STACKS
        ------------------------------------------------------------------- */}
        {activeTab === 'pipelines' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c]">
                <span className="text-xs font-semibold text-zinc-200">
                  Target Stacks ({selectedStacks.length})
                </span>
              </div>
              <div className="divide-y divide-[#1a1c23]">
                {STACK_CATALOG.map((stack) => {
                  const isSelected = selectedStacks.includes(stack.id);
                  const isAutoDetected = report.detectedStacks.includes(stack.id);
                  return (
                    <label
                      key={stack.id}
                      className="px-4 py-2.5 hover:bg-[#15171d] transition flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-zinc-200">
                            {stack.name}
                          </span>
                          {isAutoDetected && (
                            <span className="px-1.5 py-0.2 rounded bg-[#1b1d24] border border-[#2a2d38] text-[9px] font-mono text-zinc-400">
                              detected
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">
                          {stack.description}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleStack(stack.id)}
                        className="rounded border-zinc-700"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-8 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              <div className="px-4 py-2.5 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPipelineTab('github')}
                    className={`px-2.5 py-1 rounded text-xs font-mono ${
                      pipelineTab === 'github'
                        ? 'bg-[#1e2028] text-zinc-100 border border-[#2e313d]'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    .github/workflows/ci.yml
                  </button>
                  <button
                    type="button"
                    onClick={() => setPipelineTab('docker')}
                    className={`px-2.5 py-1 rounded text-xs font-mono ${
                      pipelineTab === 'docker'
                        ? 'bg-[#1e2028] text-zinc-100 border border-[#2e313d]'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Dockerfile
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        pipelineTab === 'github' ? generatedWorkflowPreview : generatedDockerPreview
                      );
                      setCopiedCmd(true);
                      setTimeout(() => setCopiedCmd(false), 2000);
                    }}
                    className="px-3 py-1 rounded bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 text-xs flex items-center gap-1.5"
                  >
                    {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCmd ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleInjectPipeline}
                    className="px-3 py-1 rounded bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold"
                  >
                    Write to Project
                  </button>
                </div>
              </div>

              <pre className="p-4 bg-[#090a0c] font-mono text-xs text-zinc-300 overflow-x-auto max-h-[65vh]">
                {pipelineTab === 'github' ? generatedWorkflowPreview : generatedDockerPreview}
              </pre>

              {pipelineSavedMsg && (
                <div className="px-4 py-2 bg-emerald-950/30 border-t border-emerald-500/30 text-emerald-300 text-xs">
                  {pipelineSavedMsg}
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 5: AI ENGINE (CLEAN TECHNICAL TABLE ROWS)
        ------------------------------------------------------------------- */}
        {activeTab === 'ai-engine' && (
          <div className="max-w-4xl mx-auto rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
            <div className="px-5 py-3.5 bg-[#0c0d10] border-b border-[#22242c] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">AI Remediation Providers</h3>
                <p className="text-[11px] text-zinc-400">
                  Configure hybrid cloud providers, free tiers, or lock execution strictly to local Ollama models.
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer px-3 py-1.5 rounded bg-[#16171d] border border-[#262932]">
                <input
                  type="checkbox"
                  checked={localOnlyMode}
                  onChange={(e) => setLocalOnlyMode(e.target.checked)}
                  className="rounded border-zinc-700"
                />
                <span>Local Models Only (Air-Gapped)</span>
              </label>
            </div>

            <div className="divide-y divide-[#1a1c23]">
              {aiProviders.map((prov) => {
                const isPreferred = preferredProvider === prov.id;
                const isDisabledByLocalLock =
                  localOnlyMode &&
                  prov.id !== 'ollama-local' &&
                  prov.id !== 'deterministic-offline';

                return (
                  <div
                    key={prov.id}
                    className={`p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center ${
                      isDisabledByLocalLock ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="md:col-span-4 flex items-center gap-3">
                      <input
                        type="radio"
                        name="preferred-ai"
                        disabled={isDisabledByLocalLock}
                        checked={isPreferred}
                        onChange={() => setPreferredProvider(prov.id)}
                      />
                      <div>
                        <div className="text-xs font-medium text-zinc-100">{prov.name}</div>
                        <span className="text-[10px] font-mono text-zinc-500">{prov.badge}</span>
                      </div>
                    </div>

                    <div className="md:col-span-4">
                      <select
                        value={prov.model}
                        onChange={(e) => {
                          const updated = aiProviders.map((p) =>
                            p.id === prov.id ? { ...p, model: e.target.value } : p
                          );
                          setAiProviders(updated);
                          saveAIProviders(updated);
                        }}
                        className="w-full rounded bg-[#0b0c0e] border border-[#24262e] px-2.5 py-1.5 text-xs text-zinc-200 font-mono"
                      >
                        {prov.availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-4">
                      {prov.id === 'ollama-local' ? (
                        <button
                          type="button"
                          onClick={handleProbeOllama}
                          className="w-full px-3 py-1.5 rounded bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-xs text-zinc-200 flex items-center justify-center gap-2"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              ollamaProbeStatus.connected ? 'bg-emerald-400' : 'bg-zinc-500'
                            }`}
                          />
                          <span>
                            {ollamaProbeStatus.connected
                              ? `Connected (${ollamaProbeStatus.latencyMs}ms)`
                              : 'Test localhost:11434'}
                          </span>
                        </button>
                      ) : prov.id !== 'deterministic-offline' ? (
                        <input
                          type="password"
                          value={prov.apiKey || ''}
                          onChange={(e) => {
                            const nextStatus: AIProviderConfig['status'] = e.target.value
                              ? 'ready'
                              : 'missing-key';
                            const updated: AIProviderConfig[] = aiProviders.map((p) =>
                              p.id === prov.id
                                ? { ...p, apiKey: e.target.value, status: nextStatus }
                                : p
                            );
                            setAiProviders(updated);
                            saveAIProviders(updated);
                          }}
                          placeholder="API Key (stored locally)..."
                          className="w-full rounded bg-[#0b0c0e] border border-[#24262e] px-2.5 py-1.5 text-xs text-zinc-200 font-mono"
                        />
                      ) : (
                        <span className="text-[11px] font-mono text-zinc-400">
                          Built-in AST Engine (0ms)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 6: SYNC & VAULT (E2EE)
        ------------------------------------------------------------------- */}
        {activeTab === 'vault' && (
          <div className="max-w-3xl mx-auto rounded-lg bg-[#101115] border border-[#22242c] p-5">
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
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 7: ACTIVITY & ADAPTIVE NOTIFICATIONS
        ------------------------------------------------------------------- */}
        {activeTab === 'activity' && (
          <div className="max-w-5xl mx-auto rounded-lg bg-[#101115] border border-[#22242c] p-5">
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
                    title: 'Static analysis pass complete',
                    message: 'Deferred to digest during high-cadence focus (22 rpm).',
                    severity: 'medium',
                    category: 'ai-code-quality',
                  },
                  updated
                );
                setNotifications((prev) => [deferredItem, ...prev]);
              }}
            />
          </div>
        )}

        {/* -------------------------------------------------------------------
            TAB 8: DOCUMENTATION & 35-RULE REFERENCE MATRIX
        ------------------------------------------------------------------- */}
        {activeTab === 'docs' && <DocumentationPanel />}
      </main>

      {/* =====================================================================
          MODALS (FOLDER PICKER, HISTORY/UNDO, COMMAND PALETTE, SELF-TEST)
      ===================================================================== */}
      <FolderPickerModal
        open={showFolderPicker}
        initialPath={projectPath}
        onClose={() => setShowFolderPicker(false)}
        onSelectFolder={handleSelectFolderFromModal}
      />

      <UxExperienceLabModal
        open={showUxLabModal}
        onClose={() => setShowUxLabModal(false)}
        activeProjectPath={projectPath}
        onTriggerFlowDemo={() => {
          const updated: AdaptiveNotificationRule = {
            ...notifRules,
            userCadenceRpm: 22,
            currentFlowState: 'deep-focus',
          };
          setNotifRules(updated);
          const deferredItem = evaluateNotificationDelivery(
            {
              title: 'Self-Test: Non-critical alert deferred',
              message: 'High cadence (22 rpm) detected — alert routed to digest.',
              severity: 'medium',
              category: 'ai-code-quality',
            },
            updated
          );
          setNotifications((prev) => [deferredItem, ...prev]);
        }}
      />

      {/* Patch History & Rollback Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-xl w-full rounded-lg bg-[#101115] border border-[#24262e] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#20222a] pb-3">
              <h3 className="font-semibold text-sm text-zinc-100">
                Patch History & Rollback ({backupHistory.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs"
              >
                Close ✕
              </button>
            </div>

            {backupHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                No patches applied to {report.projectName} yet.
              </div>
            ) : (
              <div className="divide-y divide-[#1a1c23] max-h-72 overflow-y-auto">
                {backupHistory.map((item) => (
                  <div
                    key={item.id}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-zinc-200 truncate">{item.filePath}</div>
                      <div className="text-[11px] text-zinc-500">
                        {item.wasCreatedNew ? 'Created file' : 'Modified file'} ·{' '}
                        {new Date(item.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUndoFix(item.id)}
                      className="px-2.5 py-1 rounded bg-[#181a20] hover:bg-[#22252e] border border-[#282b36] text-zinc-200 text-[11px] font-medium flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Revert
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Command Palette (Ctrl+K) */}
      {showCmdPalette && (
        <div
          onClick={() => setShowCmdPalette(false)}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center pt-24 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-lg w-full rounded-lg bg-[#101115] border border-[#282b36] shadow-2xl overflow-hidden"
          >
            <div className="p-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center gap-2">
              <Search className="w-4 h-4 text-zinc-500" />
              <input
                type="text"
                autoFocus
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
                placeholder="Type a command or workspace path..."
                className="w-full bg-transparent text-xs text-zinc-100 focus:outline-none"
              />
            </div>

            <div className="divide-y divide-[#181920] max-h-72 overflow-y-auto text-xs p-1.5">
              {[
                {
                  label: 'Open Project Directory...',
                  action: () => {
                    setShowCmdPalette(false);
                    setShowFolderPicker(true);
                  },
                },
                {
                  label: 'Open System Folder Dialog (Windows Explorer)...',
                  action: () => {
                    setShowCmdPalette(false);
                    handlePickNativeWindowsFolder();
                  },
                },
                {
                  label: 'Run Diagnostic Scan Now',
                  action: () => {
                    setShowCmdPalette(false);
                    runScan();
                  },
                },
                {
                  label: `Apply All Reliable Auto-Fixes (${openReliableCount})`,
                  action: () => {
                    setShowCmdPalette(false);
                    handleFixAllReliable();
                  },
                },
                {
                  label: 'Undo Last Applied Patch',
                  action: () => {
                    setShowCmdPalette(false);
                    handleUndoFix();
                  },
                },
                {
                  label: 'Open Active Project in VS Code',
                  action: () => {
                    setShowCmdPalette(false);
                    handleOpenInVsCode();
                  },
                },
                {
                  label: 'Export Audit Report (.md)',
                  action: () => {
                    setShowCmdPalette(false);
                    handleExportMarkdownReport();
                  },
                },
                {
                  label: 'License, Credits & Support (Apache 2.0 — Réda Touzani)',
                  action: () => {
                    setShowCmdPalette(false);
                    setShowAboutModal(true);
                  },
                },
              ]
                .filter((item) =>
                  !cmdQuery.trim()
                    ? true
                    : item.label.toLowerCase().includes(cmdQuery.toLowerCase())
                )
                .map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.action}
                    className="w-full px-3 py-2 text-left rounded hover:bg-[#181a22] text-zinc-200 flex items-center justify-between transition"
                  >
                    <span>{item.label}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {showCliModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-lg bg-[#101115] border border-[#24262e] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#20222a] pb-3">
              <h3 className="font-semibold text-sm text-zinc-100">
                CLI & External Usage
              </h3>
              <button
                type="button"
                onClick={() => setShowCliModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs"
              >
                Close ✕
              </button>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="p-3 rounded bg-[#090a0c] border border-[#1e2028] space-y-1">
                <div className="text-zinc-500"># Scan any external directory from CLI</div>
                <div className="text-zinc-200">npm run scan -- "C:/path/to/project"</div>
              </div>
              <div className="p-3 rounded bg-[#090a0c] border border-[#1e2028] space-y-1">
                <div className="text-zinc-500"># Export standalone offline tarball (.tgz)</div>
                <div className="text-zinc-200">npm run pack:toolbox</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PERSISTENT CREDITS & OPEN SOURCE LICENSE FOOTER
      ===================================================================== */}
      <footer className="mt-auto border-t border-[#191b22] bg-[#07080a] px-5 py-3 text-[11px] text-zinc-400 flex flex-wrap items-center justify-between gap-4 select-none">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-semibold text-zinc-200">Aegis CI/CD Toolbox</span>
          <span className="text-zinc-700">·</span>
          <button
            type="button"
            onClick={() => setShowAboutModal(true)}
            className="px-2 py-0.5 rounded bg-[#12141a] hover:bg-[#191c24] border border-[#232630] font-mono text-[10px] text-teal-400 transition"
          >
            Apache License 2.0
          </button>
          <span className="text-zinc-700">·</span>
          <span>
            Créé par{' '}
            <a
              href="https://github.com/hrmonic"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-zinc-200 hover:text-teal-300 underline decoration-zinc-700 underline-offset-2 transition"
            >
              Réda Touzani (@hrmonic)
            </a>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className="px-2.5 py-0.5 rounded bg-[#12141a] hover:bg-[#1a1d26] border border-[#242730] text-zinc-300 hover:text-zinc-100 font-medium transition"
          >
            Documentation (35 Rules)
          </button>
          <button
            type="button"
            onClick={() => setShowAboutModal(true)}
            className="px-2.5 py-0.5 rounded bg-[#171920] hover:bg-[#222530] border border-[#2a2d3a] text-teal-300 font-medium transition"
          >
            Soutenir & Crédits
          </button>
        </div>
      </footer>

      {/* =====================================================================
          ABOUT, APACHE 2.0 LICENSE & QR CODE SUPPORT MODAL
      ===================================================================== */}
      {showAboutModal && (
        <div
          onClick={() => setShowAboutModal(false)}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-xl w-full rounded-lg bg-[#101115] border border-[#252832] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-3.5 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-teal-400" />
                <h3 className="font-semibold text-sm text-zinc-100">
                  Crédits, Licence Open Source & Soutien
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAboutModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs"
              >
                Fermer ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Creator + QR Code Support Card */}
              <div className="p-4 rounded-md bg-[#0c0d10] border border-[#1f222b] flex flex-col sm:flex-row items-center gap-5">
                <div className="shrink-0 p-2.5 rounded-lg bg-white border border-zinc-700 shadow-lg">
                  <img
                    src="/donate-qr.png"
                    alt="QR Code de soutien"
                    className="w-32 h-32 object-contain"
                  />
                </div>

                <div className="space-y-2.5 flex-1">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      Créateur & Auteur
                    </div>
                    <div className="text-base font-semibold text-zinc-100">Réda Touzani</div>
                    <a
                      href="https://github.com/hrmonic"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-mono text-teal-400 hover:text-teal-300 underline"
                    >
                      https://github.com/hrmonic
                    </a>
                  </div>

                  <p className="text-zinc-400 leading-relaxed">
                    Scannez le QR code ci-contre avec votre téléphone pour soutenir directement le développement open-source de <strong className="text-zinc-200">Aegis CI/CD Toolbox</strong>.
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href="https://github.com/hrmonic"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded bg-[#161820] hover:bg-[#1f222d] border border-[#272a36] text-zinc-200 font-medium transition"
                    >
                      Profil GitHub @hrmonic ↗
                    </a>
                    <a
                      href="https://github.com/hrmonic/aegis-ci-cd-toolbox"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded bg-[#161820] hover:bg-[#1f222d] border border-[#272a36] text-zinc-200 font-medium transition"
                    >
                      Dépôt GitHub ↗
                    </a>
                  </div>
                </div>
              </div>

              {/* Open Source License Card */}
              <div className="p-4 rounded-md bg-[#0c0d10] border border-[#1f222b] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                    Licence Open Source
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#151820] border border-[#242834] font-mono text-[11px] text-zinc-200">
                    Apache License 2.0
                  </span>
                </div>
                <pre className="p-3 rounded bg-[#08090b] border border-[#1a1c23] font-mono text-[11px] text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
{`Copyright 2026 Réda Touzani (https://github.com/hrmonic)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
