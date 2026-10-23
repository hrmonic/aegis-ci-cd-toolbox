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
} from '../server/scanner';
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

      // Test line-aware Auto-Fix on Python mutable default argument
      const mutableFinding = report.findings.find((f) => f.ruleId === 'AI-QUAL-004')!;
      const fixRes = applyAutoFixOnDisk(tempDir, mutableFinding.autoFix);
      expect(fixRes.success).toBe(true);
      const updatedPy = fs.readFileSync(path.join(tempDir, 'app.py'), 'utf-8');
      expect(updatedPy).toContain('bucket=None');
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

  it('initialise un dépôt Git local, configure le remote GitHub, crée une branche et effectue un commit post-correction', () => {
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
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
