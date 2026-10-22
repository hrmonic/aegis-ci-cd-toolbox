import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { scanProject, detectProjectStacks, applyAutoFixOnDisk } from '../server/scanner';
import { generateGitHubActionsWorkflow, generateHardenedDockerfile } from '../server/pipelineTemplates';
import { encryptSyncPayload, decryptSyncEnvelope } from '../src/services/e2eeCrypto';
import {
  computeFlowStateFromCadence,
  evaluateNotificationDelivery,
  DEFAULT_NOTIFICATION_RULES,
} from '../src/services/adaptiveNotify';

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
});
