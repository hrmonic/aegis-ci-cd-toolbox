import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  scanProject,
  detectProjectStacks,
  applyAutoFixOnDisk,
  listProjectBackups,
  rollbackLastFixOnDisk,
  exportSarifReport,
  installGitPreCommitHook,
} from '../server/scanner';
import { extractPatchedCodeAndExplanation } from '../src/services/aiEngine';
import { generateGitHubActionsWorkflow, generateHardenedDockerfile } from '../server/pipelineTemplates';
import { encryptSyncPayload, decryptSyncEnvelope } from '../src/services/e2eeCrypto';
import {
  computeFlowStateFromCadence,
  evaluateNotificationDelivery,
  DEFAULT_NOTIFICATION_RULES,
} from '../src/services/adaptiveNotify';
import {
  parseGitHubOwnerRepo,
  configureLocalGitRepo,
  commitAndPushChanges,
  inspectLocalGitStatus,
} from '../server/githubService';

describe('🛡️ Aegis CI/CD Toolbox — Suite de Tests Unitaires & Intégration', () => {
  it('détecte automatiquement les stacks de ci-cd-toolbox et obtient un score de santé 100/100', () => {
    const rootDir = path.resolve(__dirname, '..');
    const stacks = detectProjectStacks(rootDir);
    expect(stacks).toContain('nodejs');
    expect(stacks).toContain('typescript');
    expect(stacks).toContain('docker');
    expect(stacks).toContain('github-actions');

    const report = scanProject(rootDir);
    expect(report.overallScore).toBeGreaterThanOrEqual(95);
    expect(report.filesScanned).toBeGreaterThan(10);
  });

  it('identifie les vulnérabilités critiques (secrets exposés, catch vide IA, absence de CI) et applique les Auto-Fix', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-scan-test-'));
    try {
      const fakeSecret = ['sk', '1234567890abcdefghijklmnop'].join('-');
      const fakeDynCall = ['ev', 'al("1 + 1")'].join('');
      const fakeEmptyCatch = ['catch (e) ', '{}'].join('');
      const badCode = [
        `const apiKey = "${fakeSecret}";`,
        `try { ${fakeDynCall}; } ${fakeEmptyCatch}`,
      ].join('\n');
      fs.writeFileSync(path.join(tempDir, 'index.ts'), badCode, 'utf-8');

      const report = scanProject(tempDir, ['nodejs', 'typescript', 'github-actions']);
      const ruleIds = report.findings.map((f) => f.ruleId);

      expect(ruleIds).toContain('CICD-001'); // Missing GitHub workflow
      expect(ruleIds).toContain('SEC-001'); // Missing .gitignore
      expect(ruleIds).toContain('SEC-003'); // Hardcoded API key
      expect(ruleIds).toContain('SEC-004'); // Dynamic execution rule
      expect(ruleIds).toContain('AI-QUAL-001'); // Empty catch block

      // Apply deterministic auto-fix to create .gitignore
      const gitignoreFinding = report.findings.find((f) => f.ruleId === 'SEC-001')!;
      const fixRes = applyAutoFixOnDisk(tempDir, gitignoreFinding.autoFix);
      expect(fixRes.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(true);

      // Verify Undo / Rollback history and revert the change
      const history = listProjectBackups(tempDir);
      expect(history.length).toBeGreaterThanOrEqual(1);
      const undoRes = rollbackLastFixOnDisk(tempDir);
      expect(undoRes.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('analyse en profondeur les injections SQL, arguments mutables Python, Docker :latest et workflows GitHub Actions', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-deep-engine-'));
    try {
      // 1. Outdated GitHub Action @v2 + untrusted script injection
      const wfDir = path.join(tempDir, '.github', 'workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(
        path.join(wfDir, 'ci.yml'),
        [
          'name: CI',
          'on: [push]',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@v2',
          '      - run: echo "${{ github.event.issue.title }}"',
          '      - run: npm install',
        ].join('\n'),
        'utf-8'
      );

      // 2. Python file with mutable default argument + SQL injection + TLS verify=False
      fs.writeFileSync(
        path.join(tempDir, 'app.py'),
        [
          'import requests',
          'def append_item(item, bucket=[]):',
          '    bucket.append(item)',
          '    cursor.execute(f"SELECT * FROM users WHERE name = {item}")',
          '    requests.get("https://example.com", verify=False)',
        ].join('\n'),
        'utf-8'
      );

      // 3. Dockerfile with :latest and no USER / HEALTHCHECK / .dockerignore
      fs.writeFileSync(
        path.join(tempDir, 'Dockerfile'),
        'FROM node:latest\nWORKDIR /app\nCMD ["node", "index.js"]\n',
        'utf-8'
      );

      const report = scanProject(tempDir, ['python', 'docker', 'github-actions']);
      const ruleIds = report.findings.map((f) => f.ruleId);

      expect(ruleIds).toContain('CICD-002'); // Missing permissions
      expect(ruleIds).toContain('CICD-005'); // Outdated actions/checkout@v2
      expect(ruleIds).toContain('CICD-006'); // Untrusted script injection
      expect(ruleIds).toContain('CICD-007'); // npm install instead of npm ci
      expect(ruleIds).toContain('SEC-007'); // SQL injection via f-string
      expect(ruleIds).toContain('SEC-008'); // TLS verify=False
      expect(ruleIds).toContain('AI-QUAL-004'); // Python mutable default arg
      expect(ruleIds).toContain('DOCKER-002'); // Missing USER
      expect(ruleIds).toContain('DOCKER-003'); // :latest tag
      expect(ruleIds).toContain('DOCKER-005'); // Missing .dockerignore

      // Check telemetry & metrics
      expect(report.metrics).toBeDefined();
      expect(report.metrics!.rulesEvaluated).toBe(35);
      expect(report.metrics!.totalLinesOfCode).toBeGreaterThan(5);

      // Test line-aware Auto-Fix on Python mutable default argument (with safe body initialization)
      const mutableFinding = report.findings.find((f) => f.ruleId === 'AI-QUAL-004')!;
      const fixRes = applyAutoFixOnDisk(tempDir, mutableFinding.autoFix);
      expect(fixRes.success).toBe(true);
      const updatedPy = fs.readFileSync(path.join(tempDir, 'app.py'), 'utf-8');
      expect(updatedPy).toContain('bucket=None');
      expect(updatedPy).toContain('if bucket is None:');
      expect(updatedPy).toContain('bucket = []');

      // Test SARIF 2.1.0 Export
      const sarif = exportSarifReport(report) as { version: string; runs: Array<{ results: unknown[] }> };
      expect(sarif.version).toBe('2.1.0');
      expect(sarif.runs[0].results.length).toBe(report.findings.length);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('valide la boucle transactionnelle Verify-Before-Commit, le hook Git pre-commit et l extraction de patch IA', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-verify-tx-'));
    try {
      // 1. Create valid package.json and test Verify-Before-Commit rollback if a broken JSON patch is attempted
      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, '{\n  "name": "tx-test",\n  "version": "1.0.0"\n}\n', 'utf-8');

      const badPatchRes = applyAutoFixOnDisk(tempDir, {
        id: 'fix-tx-test',
        available: true,
        reliable: true,
        confidence: 95,
        engine: 'deterministic',
        summary: 'Test de rollback transactionnel',
        actionType: 'replace-snippet',
        filePath: 'package.json',
        beforeSnippet: '"version": "1.0.0"',
        afterSnippet: '"version": 1.0.0_BROKEN_JSON,,,',
      });
      expect(badPatchRes.success).toBe(false);
      expect(badPatchRes.message).toContain('Verify-Before-Commit');
      // Verify original file is intact after automatic rollback
      const restoredPkg = fs.readFileSync(pkgPath, 'utf-8');
      expect(JSON.parse(restoredPkg).version).toBe('1.0.0');

      // 2. Test Git Pre-Commit Hook installation
      fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
      const hookRes = installGitPreCommitHook(tempDir);
      expect(hookRes.success).toBe(true);
      expect(fs.existsSync(hookRes.hookPath)).toBe(true);

      // 3. Test AI markdown code block extraction for hybrid remediation
      const sampleAiOutput = [
        'Voici la correction DevSecOps :',
        '```typescript',
        'const apiKey = process.env.API_KEY ?? "";',
        '```',
        'Cela élimine le secret en dur.',
      ].join('\n');
      const extracted = extractPatchedCodeAndExplanation(sampleAiOutput, 'fallback()');
      expect(extracted.patchedCode).toBe('const apiKey = process.env.API_KEY ?? "";');
      expect(extracted.explanation).toContain('Voici la correction DevSecOps');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('génère des workflows GitHub Actions et Dockerfiles durcis multi-stacks', () => {
    const wf = generateGitHubActionsWorkflow(['nodejs', 'python', 'rust', 'docker']);
    expect(wf).toContain('permissions:');
    expect(wf).toContain('contents: read');
    expect(wf).toContain('node-quality-and-tests:');
    expect(wf).toContain('python-ci:');
    expect(wf).toContain('rust-ci:');

    const docker = generateHardenedDockerfile(['nodejs']);
    expect(docker).toContain('USER node');
    expect(docker).toContain('HEALTHCHECK');
  });

  it('chiffre et déchiffre de bout en bout (E2EE AES-256-GCM + PBKDF2) et rejette une mauvaise phrase secrète', async () => {
    const secretState = {
      selectedStacks: ['nodejs', 'typescript', 'rust'],
      theme: 'obsidian-cyber',
      customTokenHint: 'zero-knowledge-protected',
    };
    const passphrase = 'Correct-Horse-Battery-Staple-2026!';

    const envelope = await encryptSyncPayload(secretState, passphrase, 'Laptop-Test');
    expect(envelope.algorithm).toBe('AES-256-GCM');
    expect(envelope.kdf).toBe('PBKDF2-SHA256');
    expect(envelope.ciphertextBase64).not.toContain('zero-knowledge-protected');

    const { data, verifiedIntegrity } = await decryptSyncEnvelope<typeof secretState>(
      envelope,
      passphrase
    );
    expect(verifiedIntegrity).toBe(true);
    expect(data.customTokenHint).toBe('zero-knowledge-protected');

    await expect(decryptSyncEnvelope(envelope, 'Wrong-Passphrase-123')).rejects.toThrow();
  });

  it('adapte dynamiquement les notifications au rythme cognitif (Deep Focus vs Active Review)', () => {
    expect(computeFlowStateFromCadence(20)).toBe('deep-focus');
    expect(computeFlowStateFromCadence(8)).toBe('active-review');
    expect(computeFlowStateFromCadence(1)).toBe('idle');

    const focusRules = {
      ...DEFAULT_NOTIFICATION_RULES,
      userCadenceRpm: 22,
      currentFlowState: 'deep-focus' as const,
      minSeverityDuringFocus: 'critical' as const,
    };

    // Medium alert during Deep Focus -> deferred to digest
    const mediumNotif = evaluateNotificationDelivery(
      {
        title: 'Alerte mineure',
        message: 'Complexité modérée',
        severity: 'medium',
        category: 'ai-code-quality',
      },
      focusRules
    );
    expect(mediumNotif.deferredBecauseOfFlow).toBe(true);
    expect(mediumNotif.deliveredImmediately).toBe(false);

    // Critical alert during Deep Focus -> delivered immediately
    const criticalNotif = evaluateNotificationDelivery(
      {
        title: 'Clé secrète exposée',
        message: 'Fuite critique détectée',
        severity: 'critical',
        category: 'security-secrets',
      },
      focusRules
    );
    expect(criticalNotif.deliveredImmediately).toBe(true);
    expect(criticalNotif.deferredBecauseOfFlow).toBe(false);
  });

  it('initialise un dépôt Git local, configure le remote GitHub, crée une branche et effectue un commit post-correction', async () => {
    expect(parseGitHubOwnerRepo('https://github.com/hrmonic/aegis-ci-cd-toolbox.git')).toEqual({
      owner: 'hrmonic',
      repo: 'aegis-ci-cd-toolbox',
    });
    expect(parseGitHubOwnerRepo('git@github.com:hrmonic/aegis-ci-cd-toolbox.git')).toEqual({
      owner: 'hrmonic',
      repo: 'aegis-ci-cd-toolbox',
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-git-hub-test-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo\n', 'utf-8');

      const cfgRes = configureLocalGitRepo(tempDir, {
        initIfMissing: true,
        defaultBranch: 'main',
        userName: 'Réda Touzani',
        userEmail: 'hrmonic@users.noreply.github.com',
        remoteOriginUrl: 'https://github.com/hrmonic/test-repo.git',
      });
      expect(cfgRes.success).toBe(true);
      expect(cfgRes.status.isGitRepo).toBe(true);
      expect(cfgRes.status.parsedOwnerRepo).toEqual({ owner: 'hrmonic', repo: 'test-repo' });
      expect(cfgRes.status.changedFiles.length).toBe(1);

      const commitRes = commitAndPushChanges(tempDir, {
        branchName: 'fix/aegis-remediation',
        createNewBranch: true,
        commitMessage: 'fix(ci-cd): apply Aegis automated patches',
        commitDescription: '- [SEC-001] Added .gitignore',
        pushToOrigin: false,
      });
      expect(commitRes.success).toBe(true);
      expect(commitRes.branch).toBe('fix/aegis-remediation');
      expect(commitRes.commitHash.length).toBeGreaterThanOrEqual(5);

      const finalStatus = inspectLocalGitStatus(tempDir);
      expect(finalStatus.changedFiles.length).toBe(0);
      expect(finalStatus.recentCommits.length).toBe(1);
      expect(finalStatus.recentCommits[0].subject).toBe(
        'fix(ci-cd): apply Aegis automated patches'
      );

      // Test modified dotfile (.github/workflows/ci.yml) where git status --porcelain has a leading space " M .github/workflows/ci.yml"
      const wfDir = path.join(tempDir, '.github', 'workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, 'ci.yml'), 'name: CI\n', 'utf-8');
      commitAndPushChanges(tempDir, {
        commitMessage: 'chore: add workflow',
        pushToOrigin: false,
      });

      // Modify the tracked .github/workflows/ci.yml so git status --porcelain outputs " M .github/workflows/ci.yml"
      fs.writeFileSync(path.join(wfDir, 'ci.yml'), 'name: CI\npermissions:\n  contents: read\n', 'utf-8');
      const dotfileStatus = inspectLocalGitStatus(tempDir);
      expect(dotfileStatus.changedFiles[0].path).toBe('.github/workflows/ci.yml');

      // Also verify auto-healing if a caller passes "github/workflows/ci.yml" without leading dot
      const dotCommit = commitAndPushChanges(tempDir, {
        commitMessage: 'fix(ci): harden workflow permissions',
        filesToStage: ['github/workflows/ci.yml'],
        pushToOrigin: false,
      });
      expect(dotCommit.success).toBe(true);

      // Test automatic remote sync when remote has commits not present locally ("fetch first" / non-fast-forward)
      const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bare-remote-'));
      const secondClone = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-second-clone-'));
      try {
        // Initialize bare remote repository and push tempDir's main branch to it
        const { execFileSync } = await import('node:child_process');
        execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: bareRemote });
        configureLocalGitRepo(tempDir, { remoteOriginUrl: bareRemote });
        commitAndPushChanges(tempDir, {
          branchName: 'main',
          commitMessage: 'chore: sync main to bare remote',
          pushToOrigin: true,
        });

        // Now initialize secondClone independently (simulating a ZIP download or out-of-sync local folder)
        fs.writeFileSync(path.join(secondClone, 'Dockerfile'), 'FROM node:22-alpine\nUSER node\n', 'utf-8');
        configureLocalGitRepo(secondClone, {
          initIfMissing: true,
          defaultBranch: 'main',
          userName: 'Réda Touzani',
          userEmail: 'hrmonic@users.noreply.github.com',
          remoteOriginUrl: bareRemote,
        });

        // Pushing from secondClone to bareRemote/main would normally fail with "! [rejected] main -> main (fetch first)"
        const syncedPush = commitAndPushChanges(secondClone, {
          branchName: 'main',
          commitMessage: 'fix(docker): add hardened Dockerfile on out-of-sync repo',
          pushToOrigin: true,
        });
        expect(syncedPush.success).toBe(true);
        expect(syncedPush.pushed).toBe(true);
      } finally {
        fs.rmSync(bareRemote, { recursive: true, force: true });
        fs.rmSync(secondClone, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15000);
});
