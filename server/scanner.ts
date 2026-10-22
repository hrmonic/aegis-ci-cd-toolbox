import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  StackId,
  DiagnosticFinding,
  ScanReport,
  CategoryScore,
  DiagnosticCategory,
  AutoFixProposal,
} from '../src/types/toolbox.ts';
import { STACK_CATALOG } from './pipelineTemplates.ts';
import { analyzePipelines } from './analyzers/pipelineAnalyzer.ts';
import { analyzeSecurityAndSecrets } from './analyzers/securityAnalyzer.ts';
import { analyzeAiCodeQualityAndMetrics } from './analyzers/aiCodeQualityAnalyzer.ts';
import { analyzeDependenciesDockerAndTests } from './analyzers/dependenciesAndInfraAnalyzer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AEGIS_ROOT_DIR = path.resolve(__dirname, '..');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'vendor',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.ci-cd-toolbox-backups',
  '.ci-cd-toolbox-cache',
]);

function walkFiles(dir: string, maxFiles = 500): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  function traverse(current: string) {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  traverse(dir);
  return results;
}

export function detectProjectStacks(projectPath: string): StackId[] {
  const detected = new Set<StackId>();
  const hasFile = (rel: string) => fs.existsSync(path.join(projectPath, rel));

  if (hasFile('package.json')) detected.add('nodejs');
  if (hasFile('tsconfig.json') || hasFile('tsconfig.app.json')) detected.add('typescript');
  if (
    hasFile('vite.config.ts') ||
    hasFile('vite.config.js') ||
    hasFile('next.config.js') ||
    hasFile('next.config.mjs') ||
    hasFile('src/App.tsx')
  ) {
    detected.add('react-nextjs');
  }
  if (hasFile('pyproject.toml') || hasFile('requirements.txt') || hasFile('Pipfile')) {
    detected.add('python');
  }
  if (hasFile('composer.json') || hasFile('symfony.lock')) {
    detected.add('php-symfony');
  }
  if (hasFile('go.mod')) detected.add('go');
  if (hasFile('Cargo.toml')) detected.add('rust');
  if (hasFile('Dockerfile') || hasFile('docker-compose.yml') || hasFile('compose.yaml')) {
    detected.add('docker');
  }
  if (hasFile('.github/workflows')) {
    detected.add('github-actions');
  }
  if (hasFile('.gitlab-ci.yml')) {
    detected.add('gitlab-ci');
  }

  // Also inspect file extensions if no root manifest was found (e.g. standalone Python/PHP/TS tools)
  if (detected.size === 0) {
    const sampleFiles = walkFiles(projectPath, 80);
    for (const f of sampleFiles) {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.py') detected.add('python');
      if (ext === '.ts' || ext === '.tsx') {
        detected.add('nodejs');
        detected.add('typescript');
      }
      if (ext === '.js' || ext === '.jsx') detected.add('nodejs');
      if (ext === '.php') detected.add('php-symfony');
      if (ext === '.go') detected.add('go');
      if (ext === '.rs') detected.add('rust');
    }
  }

  if (detected.size === 0) {
    detected.add('nodejs');
    detected.add('github-actions');
  }

  return Array.from(detected);
}

function getGitInfo(projectPath: string) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    let remoteUrl = '';
    try {
      remoteUrl = execSync('git remote get-url origin', {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch {
      remoteUrl = 'local-only';
    }
    const status = execSync('git status --porcelain', {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return {
      branch,
      remoteUrl,
      hasUncommitted: status.length > 0,
    };
  } catch {
    return undefined;
  }
}

export function scanProject(projectPath: string, customStacks?: StackId[]): ScanReport {
  const startTime = Date.now();
  const resolvedPath = path.resolve(projectPath);
  const detectedStacks = detectProjectStacks(resolvedPath);
  const selectedStacks: StackId[] =
    customStacks && customStacks.length > 0
      ? customStacks
      : Array.from(new Set([...detectedStacks, 'github-actions', 'docker']));

  const allFiles = walkFiles(resolvedPath);

  // Execute the 4 specialized deep diagnostic analyzers (35 rules total)
  const pipelineFindings = analyzePipelines(resolvedPath, selectedStacks);
  const securityFindings = analyzeSecurityAndSecrets(resolvedPath, allFiles, detectedStacks);
  const { findings: aiQualFindings, metrics } = analyzeAiCodeQualityAndMetrics(
    resolvedPath,
    allFiles
  );
  const infraAndDepsFindings = analyzeDependenciesDockerAndTests(
    resolvedPath,
    allFiles,
    detectedStacks,
    selectedStacks,
    metrics.testFilesCount
  );

  const findings: DiagnosticFinding[] = [
    ...pipelineFindings,
    ...securityFindings,
    ...aiQualFindings,
    ...infraAndDepsFindings,
  ];

  // Compute Category Scores
  const categories: { id: DiagnosticCategory; label: string }[] = [
    { id: 'pipeline-cicd', label: 'Pipelines CI/CD' },
    { id: 'security-secrets', label: 'Sécurité & Secrets' },
    { id: 'ai-code-quality', label: 'Robustesse Code IA' },
    { id: 'test-robustness', label: 'Couverture & Tests' },
    { id: 'dependencies-build', label: 'Build & Dépendances' },
    { id: 'containers-infra', label: 'Docker & Infra' },
  ];

  const severityPenalty: Record<string, number> = {
    critical: 24,
    high: 14,
    medium: 8,
    low: 4,
    info: 1,
  };

  const categoryScores: CategoryScore[] = categories.map((cat) => {
    const catFindings = findings.filter((f) => f.category === cat.id && f.status === 'open');
    const penalty = catFindings.reduce((acc, f) => acc + (severityPenalty[f.severity] || 5), 0);
    const score = Math.max(15, 100 - penalty);
    return {
      category: cat.id,
      label: cat.label,
      score,
      issuesCount: catFindings.length,
      criticalCount: catFindings.filter((f) => f.severity === 'critical').length,
    };
  });

  const overallScore = Math.round(
    categoryScores.reduce((acc, c) => acc + c.score, 0) / categoryScores.length
  );

  const aiReadinessScore = Math.round(
    categoryScores.find((c) => c.category === 'ai-code-quality')!.score * 0.35 +
      categoryScores.find((c) => c.category === 'test-robustness')!.score * 0.35 +
      categoryScores.find((c) => c.category === 'pipeline-cicd')!.score * 0.3
  );

  return {
    id: `scan-${Date.now()}`,
    projectPath: resolvedPath,
    projectName: path.basename(resolvedPath),
    scannedAt: new Date().toISOString(),
    durationMs: Math.max(8, Date.now() - startTime),
    overallScore,
    aiReadinessScore,
    filesScanned: allFiles.length,
    detectedStacks,
    selectedStacks,
    categoryScores,
    findings,
    metrics,
    gitInfo: getGitInfo(resolvedPath),
  };
}

export interface BackupEntry {
  id: string;
  filePath: string;
  backupFile: string;
  createdAt: string;
  wasCreatedNew: boolean;
  summary?: string;
}

function getBackupMetaFile(projectPath: string): string {
  const resolvedProject = path.resolve(projectPath);
  const projectSlug = path.basename(resolvedProject).replace(/[^a-zA-Z0-9_-]/g, '_');
  const backupDir = path.join(AEGIS_ROOT_DIR, '.ci-cd-toolbox-backups', projectSlug);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return path.join(backupDir, 'history.json');
}

export function listProjectBackups(projectPath: string): BackupEntry[] {
  try {
    const metaFile = getBackupMetaFile(projectPath);
    if (!fs.existsSync(metaFile)) return [];
    return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  } catch {
    return [];
  }
}

export function applyAutoFixOnDisk(
  projectPath: string,
  fix: AutoFixProposal
): { success: boolean; message: string; backupFile?: string } {
  const resolvedProject = path.resolve(projectPath);
  const targetFile = path.resolve(resolvedProject, fix.filePath);

  if (!targetFile.startsWith(resolvedProject)) {
    return { success: false, message: 'Chemin de fichier hors du périmètre du projet.' };
  }

  const projectSlug = path.basename(resolvedProject).replace(/[^a-zA-Z0-9_-]/g, '_');
  const backupDir = path.join(AEGIS_ROOT_DIR, '.ci-cd-toolbox-backups', projectSlug);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const existedBefore = fs.existsSync(targetFile);
  let backupFile = '';
  if (existedBefore) {
    const safeName = `${Date.now()}_${fix.filePath.replace(/[\\/]/g, '__')}`;
    backupFile = path.join(backupDir, `${safeName}.bak`);
    fs.copyFileSync(targetFile, backupFile);
  }

  try {
    const parentDir = path.dirname(targetFile);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (fix.actionType === 'create-file') {
      fs.writeFileSync(targetFile, fix.afterSnippet, 'utf-8');
    } else if (fix.actionType === 'append-file') {
      const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf-8') : '';
      // Avoid duplicate append if afterSnippet is already at the end
      if (!current.includes(fix.afterSnippet.trim())) {
        fs.writeFileSync(targetFile, current.trimEnd() + '\n' + fix.afterSnippet + '\n', 'utf-8');
      }
    } else if (fix.actionType === 'json-patch' && fix.filePath.endsWith('package.json')) {
      const pkg = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      if (fix.id === 'fix-pkg-test-script') {
        pkg.scripts = pkg.scripts || {};
        pkg.scripts.test = 'vitest run';
      } else if (fix.id === 'fix-pkg-engines') {
        pkg.engines = { ...(pkg.engines || {}), node: '>=20.0.0' };
      }
      fs.writeFileSync(targetFile, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    } else if (fs.existsSync(targetFile)) {
      const current = fs.readFileSync(targetFile, 'utf-8');
      if (current.includes(fix.beforeSnippet)) {
        const updated = current.replace(fix.beforeSnippet, fix.afterSnippet);
        fs.writeFileSync(targetFile, updated, 'utf-8');
      } else {
        // Fallback: line-by-line trimmed match preserving indentation
        const lines = current.split('\n');
        const targetTrimmed = fix.beforeSnippet.trim();
        let replaced = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === targetTrimmed && targetTrimmed.length > 0) {
            const leadingSpace = lines[i].match(/^\s*/)?.[0] || '';
            lines[i] = leadingSpace + fix.afterSnippet.trim();
            replaced = true;
            break;
          }
        }
        if (replaced) {
          fs.writeFileSync(targetFile, lines.join('\n'), 'utf-8');
        } else {
          return {
            success: false,
            message: `Le fragment cible n'a pas été trouvé dans ${fix.filePath}.`,
          };
        }
      }
    }

    // Record in history.json for 1-click Undo
    const history = listProjectBackups(resolvedProject);
    history.unshift({
      id: `undo-${Date.now()}`,
      filePath: fix.filePath,
      backupFile,
      createdAt: new Date().toISOString(),
      wasCreatedNew: !existedBefore,
      summary: fix.summary,
    });
    fs.writeFileSync(
      getBackupMetaFile(resolvedProject),
      JSON.stringify(history.slice(0, 30), null, 2),
      'utf-8'
    );

    return {
      success: true,
      message: `Patch appliqué sur ${fix.filePath}.`,
      backupFile,
    };
  } catch (err) {
    return {
      success: false,
      message: `Erreur: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function rollbackLastFixOnDisk(projectPath: string, entryId?: string): {
  success: boolean;
  message: string;
  restoredFile?: string;
} {
  const resolvedProject = path.resolve(projectPath);
  const history = listProjectBackups(resolvedProject);
  if (history.length === 0) {
    return { success: false, message: 'Aucun historique de patch à annuler.' };
  }

  const idx = entryId ? history.findIndex((h) => h.id === entryId) : 0;
  if (idx === -1) {
    return { success: false, message: 'Entrée d’historique introuvable.' };
  }

  const targetEntry = history[idx];
  const targetFile = path.resolve(resolvedProject, targetEntry.filePath);

  try {
    if (targetEntry.wasCreatedNew) {
      if (fs.existsSync(targetFile)) {
        fs.unlinkSync(targetFile);
      }
    } else if (targetEntry.backupFile && fs.existsSync(targetEntry.backupFile)) {
      fs.copyFileSync(targetEntry.backupFile, targetFile);
      fs.unlinkSync(targetEntry.backupFile);
    }

    history.splice(idx, 1);
    fs.writeFileSync(getBackupMetaFile(resolvedProject), JSON.stringify(history, null, 2), 'utf-8');

    return {
      success: true,
      message: `Modification annulée sur ${targetEntry.filePath}.`,
      restoredFile: targetEntry.filePath,
    };
  } catch (err) {
    return {
      success: false,
      message: `Échec de restauration: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export { STACK_CATALOG };
