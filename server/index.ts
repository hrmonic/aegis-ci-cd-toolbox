import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import {
  scanProject,
  applyAutoFixOnDisk,
  detectProjectStacks,
  STACK_CATALOG,
} from './scanner.ts';
import {
  generateGitHubActionsWorkflow,
  generateHardenedDockerfile,
} from './pipelineTemplates.ts';
import type { StackId, E2EESyncEnvelope } from '../src/types/toolbox.ts';

const app = express();
const PORT = Number(process.env.PORT || 4177);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Determine default target directory
const targetArgIdx = process.argv.indexOf('--target');
const DEFAULT_TARGET_DIR =
  targetArgIdx !== -1 && process.argv[targetArgIdx + 1]
    ? path.resolve(process.argv[targetArgIdx + 1])
    : process.cwd();

// Local Encrypted Vault Store (stores only zero-knowledge AES-256-GCM ciphertext envelopes)
const VAULT_FILE = path.join(DEFAULT_TARGET_DIR, '.ci-cd-toolbox-cache', 'e2ee-sync-vault.json');

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Aegis CI/CD Toolbox Engine',
    defaultTargetDir: DEFAULT_TARGET_DIR,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/stacks', (_req, res) => {
  res.json({ stacks: STACK_CATALOG });
});

// Inspect any external project path on the machine (Zero-Footprint External Targeting)
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
          entry.name !== 'node_modules' &&
          entry.name !== 'dist' &&
          entry.name !== 'build' &&
          entry.name !== 'vendor'
        ) {
          subFolders.push({
            name: entry.name,
            path: path.join(resolved, entry.name).replace(/\\/g, '/'),
          });
        }
      }
    } catch {
      // Ignore permission errors on sub-directories
    }

    res.json({
      exists: true,
      projectPath: resolved.replace(/\\/g, '/'),
      projectName: path.basename(resolved),
      detectedStacks,
      subFolders: subFolders.slice(0, 12),
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

// Probe Local Ollama instance (http://localhost:11434) for 100% Local AI mode
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

app.listen(PORT, () => {
  console.log(`🛡️  [Aegis CI/CD Server] Actif sur http://localhost:${PORT} (Cible: ${DEFAULT_TARGET_DIR})`);
});
