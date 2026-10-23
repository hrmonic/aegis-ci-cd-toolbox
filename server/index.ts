import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, exec } from 'node:child_process';
import {
  scanProject,
  applyAutoFixOnDisk,
  listProjectBackups,
  rollbackLastFixOnDisk,
  detectProjectStacks,
  exportSarifReport,
  installGitPreCommitHook,
  STACK_CATALOG,
} from './scanner.ts';
import {
  generateGitHubActionsWorkflow,
  generateHardenedDockerfile,
} from './pipelineTemplates.ts';
import {
  resolveGitHubToken,
  inspectLocalGitStatus,
  configureLocalGitRepo,
  commitAndPushChanges,
  githubApiRequest,
  type GitHubRepoItem,
  type GitHubUserProfile,
} from './githubService.ts';
import type { StackId, E2EESyncEnvelope } from '../src/types/toolbox.ts';

const app = express();
const PORT = Number(process.env.PORT || 4177);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error('Origine non autorisée par la politique de sécurité locale Aegis.'));
      }
    },
  })
);
app.use(express.json({ limit: '5mb' }));

const targetArgIdx = process.argv.indexOf('--target');
const DEFAULT_TARGET_DIR =
  targetArgIdx !== -1 && process.argv[targetArgIdx + 1]
    ? path.resolve(process.argv[targetArgIdx + 1])
    : process.cwd();

const VAULT_FILE = path.join(DEFAULT_TARGET_DIR, '.ci-cd-toolbox-cache', 'e2ee-sync-vault.json');

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Aegis CI/CD Toolbox Engine',
    defaultTargetDir: DEFAULT_TARGET_DIR.replace(/\\/g, '/'),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/stacks', (_req, res) => {
  res.json({ stacks: STACK_CATALOG });
});

// ============================================================================
// 1. NATIVE OS FOLDER PICKER DIALOG (WINDOWS EXPLORER DIALOG)
// ============================================================================
app.post('/api/fs/pick-native', (req, res) => {
  const initialDir = req.body?.initialDir
    ? path.resolve(req.body.initialDir)
    : DEFAULT_TARGET_DIR;

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.Width = 0
$owner.Height = 0
$owner.FormBorderStyle = 'None'
$owner.StartPosition = 'CenterScreen'
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
$owner.Activate()

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Sélectionnez le dossier du projet à auditer avec Aegis CI/CD Studio"
$dialog.ShowNewFolderButton = $false
if (Test-Path -LiteralPath "${initialDir.replace(/"/g, '')}") {
  $dialog.SelectedPath = "${initialDir.replace(/"/g, '')}"
}
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;

  execFile(
    'powershell.exe',
    ['-NoProfile', '-STA', '-Command', psScript],
    { timeout: 120000 },
    (err, stdout) => {
      if (err) {
        res.json({ cancelled: true, error: err.message });
        return;
      }
      const picked = stdout.trim();
      if (!picked) {
        res.json({ cancelled: true });
        return;
      }
      const normalized = picked.replace(/\\/g, '/');
      const detectedStacks = detectProjectStacks(picked);
      res.json({
        cancelled: false,
        projectPath: normalized,
        projectName: path.basename(picked),
        detectedStacks,
      });
    }
  );
});

// ============================================================================
// 2. VISUAL FILE SYSTEM EXPLORER API (DRIVES & DIRECTORIES)
// ============================================================================
app.get('/api/fs/drives', (_req, res) => {
  const drives: { name: string; path: string }[] = [];
  for (const letter of ['C', 'D', 'E', 'F', 'G', 'H']) {
    const drivePath = `${letter}:/`;
    try {
      if (fs.existsSync(drivePath)) {
        drives.push({ name: `Disque Local (${letter}:)`, path: drivePath });
      }
    } catch {
      // Ignore inaccessible drives
    }
  }
  res.json({ drives });
});

app.post('/api/fs/browse', (req, res) => {
  try {
    const rawPath: string = req.body?.dirPath || DEFAULT_TARGET_DIR;
    const resolved = path.resolve(rawPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      res.status(404).json({ error: `Dossier introuvable : ${resolved}` });
      return;
    }

    const parentDir = path.dirname(resolved);
    const hasParent = parentDir !== resolved;

    const directories: {
      name: string;
      path: string;
      isGitRepo: boolean;
      projectMarkers: string[];
    }[] = [];

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('$') || entry.name === 'System Volume Information') continue;
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '__pycache__' ||
        entry.name === '.venv'
      ) {
        continue;
      }

      const fullChild = path.join(resolved, entry.name);
      const markers: string[] = [];
      let isGitRepo = false;
      try {
        if (fs.existsSync(path.join(fullChild, '.git'))) {
          isGitRepo = true;
          markers.push('Git');
        }
        if (fs.existsSync(path.join(fullChild, 'package.json'))) markers.push('Node/TS');
        if (fs.existsSync(path.join(fullChild, 'composer.json'))) markers.push('PHP/Symfony');
        if (
          fs.existsSync(path.join(fullChild, 'pyproject.toml')) ||
          fs.existsSync(path.join(fullChild, 'requirements.txt'))
        ) {
          markers.push('Python');
        }
        if (fs.existsSync(path.join(fullChild, 'Cargo.toml'))) markers.push('Rust');
        if (fs.existsSync(path.join(fullChild, 'go.mod'))) markers.push('Go');
        if (fs.existsSync(path.join(fullChild, 'Dockerfile'))) markers.push('Docker');
      } catch {
        // Ignore permission errors on system folders
      }

      directories.push({
        name: entry.name,
        path: fullChild.replace(/\\/g, '/'),
        isGitRepo,
        projectMarkers: markers,
      });
    }

    // Sort project folders (with markers or Git) first, then alphabetically
    directories.sort((a, b) => {
      const aScore = (a.isGitRepo ? 2 : 0) + a.projectMarkers.length;
      const bScore = (b.isGitRepo ? 2 : 0) + b.projectMarkers.length;
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });

    res.json({
      currentPath: resolved.replace(/\\/g, '/'),
      currentName: path.basename(resolved) || resolved.replace(/\\/g, '/'),
      parentPath: hasParent ? parentDir.replace(/\\/g, '/') : null,
      detectedStacks: detectProjectStacks(resolved),
      directories: directories.slice(0, 80),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur lecture dossier',
    });
  }
});

// Inspect any external project path on the machine
app.post('/api/projects/inspect', (req, res) => {
  try {
    const rawPath: string = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const resolved = path.resolve(rawPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      res.status(404).json({
        exists: false,
        projectPath: resolved,
        error: `Le dossier "${resolved}" est introuvable.`,
      });
      return;
    }

    const detectedStacks = detectProjectStacks(resolved);
    const subFolders: { name: string; path: string }[] = [];
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !entry.name.startsWith('__') &&
          entry.name !== 'node_modules' &&
          entry.name !== 'dist' &&
          entry.name !== 'build' &&
          entry.name !== 'vendor' &&
          entry.name !== 'venv' &&
          entry.name !== 'coverage' &&
          entry.name !== 'target'
        ) {
          subFolders.push({
            name: entry.name,
            path: path.join(resolved, entry.name).replace(/\\/g, '/'),
          });
        }
      }
    } catch {
      // Ignore permission errors
    }

    res.json({
      exists: true,
      projectPath: resolved.replace(/\\/g, '/'),
      projectName: path.basename(resolved),
      detectedStacks,
      subFolders: subFolders.slice(0, 14),
    });
  } catch (err) {
    res.status(500).json({
      exists: false,
      error: err instanceof Error ? err.message : 'Erreur inspection dossier cible',
    });
  }
});

app.post('/api/scan', (req, res) => {
  try {
    const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const selectedStacks: StackId[] | undefined = req.body?.selectedStacks;
    const report = scanProject(projectPath, selectedStacks);
    res.json(report);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur lors du scan CI/CD',
    });
  }
});

app.post('/api/fix', (req, res) => {
  try {
    const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const fix = req.body?.fix;
    if (!fix) {
      res.status(400).json({ error: 'Objet autoFix manquant.' });
      return;
    }
    const result = applyAutoFixOnDisk(projectPath, fix);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Erreur lors de la correction',
    });
  }
});

// ============================================================================
// 3. BACKUP HISTORY & 1-CLICK UNDO / ROLLBACK API
// ============================================================================
app.post('/api/backups', (req, res) => {
  const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
  res.json({ history: listProjectBackups(projectPath) });
});

app.post('/api/rollback', (req, res) => {
  const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
  const entryId = req.body?.entryId;
  const result = rollbackLastFixOnDisk(projectPath, entryId);
  res.json(result);
});

// ============================================================================
// 4. LIVE CI/CD TASK RUNNER & IDE INTEGRATION (VS CODE / EXPLORER)
// ============================================================================
app.post('/api/runner/scripts', (req, res) => {
  const projectPath = path.resolve(req.body?.projectPath || DEFAULT_TARGET_DIR);
  const actions: { id: string; label: string; command: string; category: string }[] = [];

  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      for (const [name, cmd] of Object.entries(scripts)) {
        if (name === 'dev' || name === 'start' || name.includes('watch')) continue;
        actions.push({
          id: `npm-${name}`,
          label: `npm run ${name}`,
          command: `npm run ${name}`,
          category: String(cmd).slice(0, 48),
        });
      }
    } catch {
      // Ignore
    }
  }

  if (
    fs.existsSync(path.join(projectPath, 'requirements.txt')) ||
    fs.existsSync(path.join(projectPath, 'pyproject.toml')) ||
    detectProjectStacks(projectPath).includes('python')
  ) {
    actions.push(
      { id: 'py-version', label: 'python --version', command: 'python --version', category: 'Python Runtime' },
      { id: 'py-pytest', label: 'pytest', command: 'python -m pytest', category: 'Python Test Suite' },
      { id: 'py-compile', label: 'py_compile syntax check', command: 'python -m compileall -q .', category: 'Bytecode Syntax Check' }
    );
  }

  if (fs.existsSync(path.join(projectPath, '.git'))) {
    actions.push(
      { id: 'git-status', label: 'git status -s', command: 'git status -s', category: 'Git Working Tree' },
      { id: 'git-diff', label: 'git diff --stat', command: 'git diff --stat', category: 'Git Diff Summary' },
      { id: 'git-log', label: 'git log -n 5 --oneline', command: 'git log -n 5 --oneline', category: 'Recent Commits' }
    );
  }

  res.json({ actions });
});

app.post('/api/runner/exec', (req, res) => {
  const projectPath = path.resolve(req.body?.projectPath || DEFAULT_TARGET_DIR);
  const command: string = req.body?.command || '';

  const ALLOWED_PREFIXES = [
    'npm run ',
    'npm test',
    'npx tsc',
    'python --version',
    'python -m pytest',
    'python -m compileall',
    'git status',
    'git diff',
    'git log',
    'composer validate',
  ];

  if (
    !ALLOWED_PREFIXES.some((prefix) => command.startsWith(prefix)) ||
    /[;&|`$<>]/.test(command)
  ) {
    res.status(400).json({ error: 'Commande non autorisée par la politique de sécurité du runner.' });
    return;
  }

  const start = Date.now();
  exec(
    command,
    { cwd: projectPath, timeout: 45000, maxBuffer: 1024 * 1024 * 2 },
    (err, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const exitCode = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
      res.json({
        command,
        exitCode,
        durationMs,
        stdout: stdout || '',
        stderr: stderr || '',
      });
    }
  );
});

app.post('/api/fs/open-editor', (req, res) => {
  const projectPath = path.resolve(req.body?.projectPath || DEFAULT_TARGET_DIR);
  const filePath = req.body?.filePath ? path.resolve(projectPath, req.body.filePath) : projectPath;
  const line = Math.max(1, Number(req.body?.line || 1));

  const rel = path.relative(projectPath, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.status(400).json({ error: 'Chemin invalide.' });
    return;
  }

  execFile('code', ['-g', `${filePath}:${line}`], { cwd: projectPath, shell: true }, (err) => {
    res.json({ opened: !err });
  });
});

app.post('/api/fs/reveal-explorer', (req, res) => {
  const projectPath = path.resolve(req.body?.projectPath || DEFAULT_TARGET_DIR);
  const filePath = req.body?.filePath ? path.resolve(projectPath, req.body.filePath) : projectPath;

  const rel = path.relative(projectPath, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.status(400).json({ error: 'Chemin invalide.' });
    return;
  }

  const target = fs.existsSync(filePath) ? filePath : projectPath;
  execFile('explorer.exe', [`/select,${target.replace(/\//g, '\\')}`], () => {
    res.json({ revealed: true });
  });
});

app.post('/api/export/sarif', (req, res) => {
  try {
    const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const selectedStacks: StackId[] | undefined = req.body?.selectedStacks;
    const report = scanProject(projectPath, selectedStacks);
    res.json(exportSarifReport(report));
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur export SARIF 2.1.0',
    });
  }
});

app.post('/api/git/install-hook', (req, res) => {
  try {
    const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const result = installGitPreCommitHook(projectPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erreur installation hook pre-commit',
    });
  }
});

app.post('/api/generate-pipeline', (req, res) => {
  try {
    const stacks: StackId[] = req.body?.stacks || ['nodejs', 'typescript', 'github-actions'];
    const writeToDisk: boolean = Boolean(req.body?.writeToDisk);
    const projectPath: string = req.body?.projectPath || DEFAULT_TARGET_DIR;

    const githubWorkflow = generateGitHubActionsWorkflow(stacks);
    const dockerfile = generateHardenedDockerfile(stacks);

    if (writeToDisk) {
      const wfDir = path.join(projectPath, '.github', 'workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, 'ci-cd-aegis.yml'), githubWorkflow, 'utf-8');
    }

    res.json({
      githubWorkflow,
      dockerfile,
      written: writeToDisk,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur génération pipeline',
    });
  }
});

// Probe Local Ollama instance (http://localhost:11434)
app.get('/api/ollama/models', async (req, res) => {
  const endpoint = (req.query.endpoint as string) || 'http://localhost:11434';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      res.json({ connected: false, models: [] });
      return;
    }
    const data = (await response.json()) as { models?: { name: string }[] };
    const models = (data.models || []).map((m) => m.name);
    res.json({
      connected: true,
      models: models.length > 0 ? models : ['qwen2.5-coder:7b', 'deepseek-coder:6.7b', 'llama3.2:latest'],
    });
  } catch {
    res.json({
      connected: false,
      models: ['qwen2.5-coder:7b', 'deepseek-coder:6.7b', 'llama3.2:latest', 'codellama:7b'],
    });
  }
});

// E2EE Zero-Knowledge Encrypted Sync Relay Endpoint
app.get('/api/sync/vault', (_req, res) => {
  try {
    if (!fs.existsSync(VAULT_FILE)) {
      res.json({ envelope: null });
      return;
    }
    const envelope = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8')) as E2EESyncEnvelope;
    res.json({ envelope });
  } catch {
    res.json({ envelope: null });
  }
});

app.post('/api/sync/vault', (req, res) => {
  try {
    const envelope = req.body?.envelope as E2EESyncEnvelope;
    if (!envelope || !envelope.ciphertextBase64 || !envelope.ivBase64) {
      res.status(400).json({ error: 'Enveloppe E2EE invalide.' });
      return;
    }
    fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true });
    fs.writeFileSync(VAULT_FILE, JSON.stringify(envelope, null, 2), 'utf-8');
    res.json({
      stored: true,
      syncedAt: envelope.syncedAt,
      cleartextHashSha256: envelope.cleartextHashSha256,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur stockage coffre E2EE',
    });
  }
});

// ============================================================================
// 5. GITHUB AUTHENTICATION, REPOSITORY MANAGER, COMMIT, PUSH & PULL REQUESTS
// ============================================================================

app.post('/api/git/status', (req, res) => {
  try {
    const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const status = inspectLocalGitStatus(projectPath);
    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur lecture statut Git local',
    });
  }
});

app.post('/api/git/config', (req, res) => {
  try {
    const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const result = configureLocalGitRepo(projectPath, {
      initIfMissing: Boolean(req.body?.initIfMissing),
      defaultBranch: req.body?.defaultBranch,
      userName: req.body?.userName,
      userEmail: req.body?.userEmail,
      remoteOriginUrl: req.body?.remoteOriginUrl,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erreur configuration Git',
    });
  }
});

app.post('/api/git/commit-push', (req, res) => {
  try {
    const projectPath = req.body?.projectPath || DEFAULT_TARGET_DIR;
    const result = commitAndPushChanges(projectPath, {
      branchName: req.body?.branchName,
      createNewBranch: Boolean(req.body?.createNewBranch),
      commitMessage: req.body?.commitMessage || 'fix(ci-cd): apply Aegis patches',
      commitDescription: req.body?.commitDescription,
      filesToStage: req.body?.filesToStage,
      pushToOrigin: Boolean(req.body?.pushToOrigin),
      githubToken: req.body?.githubToken,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Erreur lors du commit / push Git',
    });
  }
});

app.post('/api/github/auth', async (req, res) => {
  try {
    const { token, source } = resolveGitHubToken(req.body?.token);
    if (!token || !source) {
      res.json({
        authenticated: false,
        error: 'Aucun jeton GitHub fourni et GitHub CLI (`gh auth login`) non détecté.',
      });
      return;
    }

    const user = await githubApiRequest<Omit<GitHubUserProfile, 'authSource'>>('/user', token);
    res.json({
      authenticated: true,
      source,
      user: {
        ...user,
        authSource: source,
      },
    });
  } catch (err) {
    res.status(401).json({
      authenticated: false,
      error: err instanceof Error ? err.message : 'Échec authentification GitHub',
    });
  }
});

app.post('/api/github/repos/list', async (req, res) => {
  try {
    const { token } = resolveGitHubToken(req.body?.token);
    if (!token) {
      res.status(401).json({ error: 'Authentification GitHub requise.' });
      return;
    }
    const repos = await githubApiRequest<GitHubRepoItem[]>(
      '/user/repos?sort=updated&direction=desc&per_page=60&affiliation=owner,collaborator,organization_member',
      token
    );
    res.json({ repos });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur récupération des dépôts GitHub',
    });
  }
});

app.post('/api/github/repos/create', async (req, res) => {
  try {
    const { token } = resolveGitHubToken(req.body?.token);
    if (!token) {
      res.status(401).json({ error: 'Authentification GitHub requise.' });
      return;
    }

    const {
      name,
      description,
      isPrivate,
      homepage,
      autoInit,
      gitignoreTemplate,
      licenseTemplate,
      hasIssues,
      hasWiki,
      hasProjects,
      topics,
      linkToProjectPath,
      pushInitialCode,
    } = req.body || {};

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Le nom du dépôt est obligatoire.' });
      return;
    }

    const created = await githubApiRequest<GitHubRepoItem>('/user/repos', token, {
      method: 'POST',
      body: JSON.stringify({
        name: String(name).trim(),
        description: description ? String(description).trim() : '',
        private: Boolean(isPrivate),
        homepage: homepage ? String(homepage).trim() : undefined,
        auto_init: Boolean(autoInit),
        gitignore_template: gitignoreTemplate || undefined,
        license_template: licenseTemplate || undefined,
        has_issues: hasIssues !== undefined ? Boolean(hasIssues) : true,
        has_wiki: hasWiki !== undefined ? Boolean(hasWiki) : true,
        has_projects: hasProjects !== undefined ? Boolean(hasProjects) : true,
      }),
    });

    if (Array.isArray(topics) && topics.length > 0) {
      const cleanTopics = topics
        .map((t: string) => String(t).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-'))
        .filter(Boolean);
      if (cleanTopics.length > 0) {
        try {
          await githubApiRequest(`/repos/${created.full_name}/topics`, token, {
            method: 'PUT',
            body: JSON.stringify({ names: cleanTopics }),
          });
        } catch {
          // Non-blocking if topics update fails
        }
      }
    }

    let linkedStatus = null;
    if (linkToProjectPath) {
      const cfg = configureLocalGitRepo(linkToProjectPath, {
        initIfMissing: true,
        defaultBranch: created.default_branch || 'main',
        remoteOriginUrl: created.clone_url,
      });
      linkedStatus = cfg.status;

      if (pushInitialCode) {
        const pushRes = commitAndPushChanges(linkToProjectPath, {
          branchName: created.default_branch || 'main',
          commitMessage: 'chore: initial commit via Aegis CI/CD Toolbox',
          pushToOrigin: true,
          githubToken: token,
        });
        linkedStatus = pushRes.status;
      }
    }

    res.json({
      created: true,
      repo: created,
      gitStatus: linkedStatus,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur création du dépôt GitHub',
    });
  }
});

app.post('/api/github/repos/update', async (req, res) => {
  try {
    const { token } = resolveGitHubToken(req.body?.token);
    if (!token) {
      res.status(401).json({ error: 'Authentification GitHub requise.' });
      return;
    }

    const { owner, repo, description, isPrivate, defaultBranch, homepage, hasIssues, hasWiki, hasProjects, topics } =
      req.body || {};

    if (!owner || !repo) {
      res.status(400).json({ error: 'Paramètres owner et repo requis.' });
      return;
    }

    const updated = await githubApiRequest<GitHubRepoItem>(`/repos/${owner}/${repo}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        description: description !== undefined ? String(description) : undefined,
        private: isPrivate !== undefined ? Boolean(isPrivate) : undefined,
        default_branch: defaultBranch || undefined,
        homepage: homepage !== undefined ? String(homepage) : undefined,
        has_issues: hasIssues !== undefined ? Boolean(hasIssues) : undefined,
        has_wiki: hasWiki !== undefined ? Boolean(hasWiki) : undefined,
        has_projects: hasProjects !== undefined ? Boolean(hasProjects) : undefined,
      }),
    });

    if (Array.isArray(topics)) {
      const cleanTopics = topics
        .map((t: string) => String(t).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-'))
        .filter(Boolean);
      await githubApiRequest(`/repos/${owner}/${repo}/topics`, token, {
        method: 'PUT',
        body: JSON.stringify({ names: cleanTopics }),
      });
      updated.topics = cleanTopics;
    }

    res.json({ updated: true, repo: updated });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur mise à jour des paramètres du dépôt',
    });
  }
});

app.post('/api/github/pulls/list', async (req, res) => {
  try {
    const { token } = resolveGitHubToken(req.body?.token);
    if (!token) {
      res.status(401).json({ error: 'Authentification GitHub requise.' });
      return;
    }
    const { owner, repo } = req.body || {};
    if (!owner || !repo) {
      res.status(400).json({ error: 'Paramètres owner et repo requis.' });
      return;
    }
    const pulls = await githubApiRequest<
      {
        id: number;
        number: number;
        title: string;
        html_url: string;
        state: string;
        draft: boolean;
        created_at: string;
        head: { ref: string };
        base: { ref: string };
        user: { login: string };
      }[]
    >(`/repos/${owner}/${repo}/pulls?state=open&per_page=20`, token);
    res.json({ pulls });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur lecture des Pull Requests',
    });
  }
});

app.post('/api/github/pulls/create', async (req, res) => {
  try {
    const { token } = resolveGitHubToken(req.body?.token);
    if (!token) {
      res.status(401).json({ error: 'Authentification GitHub requise.' });
      return;
    }
    const { owner, repo, title, body, head, base, draft } = req.body || {};
    if (!owner || !repo || !title || !head || !base) {
      res.status(400).json({ error: 'Paramètres owner, repo, title, head et base requis.' });
      return;
    }

    const pr = await githubApiRequest<{
      id: number;
      number: number;
      title: string;
      html_url: string;
      state: string;
    }>(`/repos/${owner}/${repo}/pulls`, token, {
      method: 'POST',
      body: JSON.stringify({
        title: String(title).trim(),
        body: body ? String(body) : '',
        head: String(head).trim(),
        base: String(base).trim(),
        draft: Boolean(draft),
      }),
    });

    res.json({ created: true, pullRequest: pr });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erreur création de la Pull Request GitHub',
    });
  }
});

// Serve compiled frontend Studio UI in production (`npm start` / Docker)
const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.listen(PORT, () => {
  console.log(`🛡️  [Aegis CI/CD Server] Actif sur http://localhost:${PORT} (Cible: ${DEFAULT_TARGET_DIR})`);
});
