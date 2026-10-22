import fs from 'node:fs';
import path from 'node:path';
import type { DiagnosticFinding, StackId } from '../../src/types/toolbox.ts';
import { generateGitHubActionsWorkflow } from '../pipelineTemplates.ts';

export function analyzePipelines(
  resolvedPath: string,
  selectedStacks: StackId[]
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const workflowsDir = path.join(resolvedPath, '.github', 'workflows');
  const workflowFiles = fs.existsSync(workflowsDir)
    ? fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    : [];

  const hasGitLabCi = fs.existsSync(path.join(resolvedPath, '.gitlab-ci.yml'));

  // CICD-001: Missing CI/CD Workflow
  if (workflowFiles.length === 0 && !hasGitLabCi && selectedStacks.includes('github-actions')) {
    const generatedYml = generateGitHubActionsWorkflow(selectedStacks);
    findings.push({
      id: 'cicd-missing-github-workflow',
      ruleId: 'CICD-001',
      title: 'Aucun pipeline GitHub Actions CI/CD détecté',
      description:
        "Le projet ne possède aucun workflow d'intégration continue dans `.github/workflows/`. Sans vérification automatisée à chaque push/PR, le code généré par IA ou modifié manuellement peut introduire des régressions silencieuses.",
      impact: 'Risque élevé de fusionner du code non testé, mal typé ou cassant le build de production.',
      category: 'pipeline-cicd',
      severity: 'critical',
      stack: 'github-actions',
      filePath: '.github/workflows/ci-cd-aegis.yml',
      line: 1,
      status: 'open',
      autoFix: {
        id: 'fix-create-gh-workflow',
        available: true,
        reliable: true,
        confidence: 99,
        engine: 'deterministic',
        summary:
          'Générer un pipeline GitHub Actions durci (Least-Privilege, Concurrency, Cache, Lint, Test & Build) adapté aux stacks du projet.',
        filePath: '.github/workflows/ci-cd-aegis.yml',
        beforeSnippet: '# Fichier absent (.github/workflows/ci-cd-aegis.yml)',
        afterSnippet: generatedYml,
        actionType: 'create-file',
      },
    });
    return findings;
  }

  for (const wf of workflowFiles) {
    const wfRel = path.join('.github/workflows', wf).replace(/\\/g, '/');
    const wfFull = path.join(workflowsDir, wf);
    let content = '';
    try {
      content = fs.readFileSync(wfFull, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');

    // CICD-002: Missing least-privilege GITHUB_TOKEN permissions
    if (!content.includes('permissions:')) {
      findings.push({
        id: `cicd-missing-permissions-${wf}`,
        ruleId: 'CICD-002',
        title: `Permissions GITHUB_TOKEN non restreintes dans ${wf}`,
        description:
          'Le workflow ne déclare pas de bloc `permissions:`. Par défaut, le jeton GITHUB_TOKEN peut disposer de droits d’écriture trop larges en cas de compromission d’une action tierce.',
        impact: 'Surface d’attaque Supply-Chain accrue sur le dépôt GitHub.',
        category: 'pipeline-cicd',
        severity: 'high',
        stack: 'github-actions',
        filePath: wfRel,
        line: 1,
        status: 'open',
        autoFix: {
          id: `fix-wf-perms-${wf}`,
          available: true,
          reliable: true,
          confidence: 97,
          engine: 'deterministic',
          summary: 'Injecter `permissions: contents: read` en tête du workflow GitHub Actions.',
          filePath: wfRel,
          beforeSnippet: lines.slice(0, 5).join('\n'),
          afterSnippet: `permissions:\n  contents: read\n\n` + lines.slice(0, 5).join('\n'),
          actionType: 'replace-snippet',
        },
      });
    }

    // CICD-003: Missing timeout-minutes on jobs
    if (!content.includes('timeout-minutes:')) {
      findings.push({
        id: `cicd-missing-timeout-${wf}`,
        ruleId: 'CICD-003',
        title: `Absence de garde-fou timeout-minutes dans ${wf}`,
        description:
          'Un job CI bloqué (serveur de test qui ne rend pas la main ou prompt interactif) peut tourner pendant 360 minutes par défaut.',
        impact: 'Épuisement des quotas de minutes CI/CD et blocage des files de runners.',
        category: 'pipeline-cicd',
        severity: 'medium',
        stack: 'github-actions',
        filePath: wfRel,
        line: Math.max(1, lines.findIndex((l) => l.includes('runs-on:')) + 1),
        status: 'open',
        autoFix: {
          id: `fix-wf-timeout-${wf}`,
          available: true,
          reliable: true,
          confidence: 95,
          engine: 'deterministic',
          summary: 'Injecter `timeout-minutes: 15` après `runs-on:`.',
          filePath: wfRel,
          beforeSnippet: 'runs-on: ubuntu-latest',
          afterSnippet: 'runs-on: ubuntu-latest\n    timeout-minutes: 15',
          actionType: 'replace-snippet',
        },
      });
    }

    // CICD-004: Missing concurrency cancellation group
    if (!content.includes('concurrency:')) {
      findings.push({
        id: `cicd-missing-concurrency-${wf}`,
        ruleId: 'CICD-004',
        title: `Absence de groupe de concurrence (cancel-in-progress) dans ${wf}`,
        description:
          'Lorsque plusieurs commits sont poussés rapidement sur une même branche/PR, les anciens runs obsolètes continuent de consommer des ressources CI inutilement.',
        impact: 'Latence accrue des retours CI/CD et gaspillage de runners.',
        category: 'pipeline-cicd',
        severity: 'low',
        stack: 'github-actions',
        filePath: wfRel,
        line: 1,
        status: 'open',
        autoFix: {
          id: `fix-wf-concurrency-${wf}`,
          available: true,
          reliable: true,
          confidence: 96,
          engine: 'deterministic',
          summary: 'Ajouter un bloc `concurrency:` annulant automatiquement les runs redondants.',
          filePath: wfRel,
          beforeSnippet: 'jobs:',
          afterSnippet:
            'concurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\n\njobs:',
          actionType: 'replace-snippet',
        },
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // CICD-005: Deprecated or unpinned GitHub Actions (@v1, @v2, @v3, @master, @main)
      const outdatedActionMatch = line.match(
        /uses:\s*(actions\/(?:checkout|setup-node|setup-python|setup-go|cache))@(v[123]|master|main|latest)\b/
      );
      if (outdatedActionMatch) {
        const actionName = outdatedActionMatch[1];
        const oldRef = outdatedActionMatch[2];
        const targetRef = actionName === 'actions/setup-python' || actionName === 'actions/setup-go' ? 'v5' : 'v4';
        findings.push({
          id: `cicd-outdated-action-${wf}-${lineNum}`,
          ruleId: 'CICD-005',
          title: `Action GitHub obsolète ou flottante (${actionName}@${oldRef}) dans ${wf}:${lineNum}`,
          description: `L'action \`${actionName}@${oldRef}\` utilise un runtime Node obsolète ou une branche flottante non reproductible.`,
          impact: 'Dépréciation par les runners GitHub ou instabilité du pipeline.',
          category: 'pipeline-cicd',
          severity: 'medium',
          stack: 'github-actions',
          filePath: wfRel,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-wf-action-${wf}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 98,
            engine: 'deterministic',
            summary: `Mettre à jour vers \`${actionName}@${targetRef}\`.`,
            filePath: wfRel,
            beforeSnippet: line.trim(),
            afterSnippet: line.trim().replace(`@${oldRef}`, `@${targetRef}`),
            actionType: 'replace-snippet',
          },
        });
      }

      // CICD-006: Shell injection via untrusted GitHub context inside run:
      if (
        /\$\{\{\s*github\.event\.(issue\.title|issue\.body|pull_request\.title|pull_request\.body|comment\.body|commits\[.*?\]\.message|head_ref)\s*\}\}/.test(
          line
        )
      ) {
        findings.push({
          id: `cicd-script-injection-${wf}-${lineNum}`,
          ruleId: 'CICD-006',
          title: `Vulnérabilité d'injection de commande CI/CD dans ${wf}:${lineNum}`,
          description:
            'Une expression issue d’une entrée utilisateur externe (`github.event.pull_request.title`, `head_ref`, etc.) est interpolée directement dans un script shell CI.',
          impact: 'Exécution de code arbitraire sur le runner CI et vol de secrets.',
          category: 'security-secrets',
          severity: 'critical',
          stack: 'github-actions',
          filePath: wfRel,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-wf-injection-${wf}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 91,
            engine: 'hybrid-ai',
            summary: 'Passer la valeur via une variable d’environnement `env:` plutôt qu’en interpolation directe.',
            filePath: wfRel,
            beforeSnippet: line.trim(),
            afterSnippet: '# Sécurisé via variable env $PR_TITLE\n        echo "$SAFE_EVENT_INPUT"',
            actionType: 'replace-snippet',
          },
        });
      }

      // CICD-007: Using `npm install` instead of deterministic `npm ci` in CI workflow
      if (/^\s*(?:-\s*)?run:\s*npm\s+install\s*$/.test(line)) {
        findings.push({
          id: `cicd-npm-install-${wf}-${lineNum}`,
          ruleId: 'CICD-007',
          title: `Utilisation de "npm install" au lieu de "npm ci" en CI (${wf}:${lineNum})`,
          description:
            'Dans un pipeline CI/CD, `npm install` peut mettre à jour les versions mineures et ignorer les incohérences de `package-lock.json`, contrairement à `npm ci`.',
          impact: 'Builds non déterministes entre le poste local et le runner CI.',
          category: 'pipeline-cicd',
          severity: 'medium',
          stack: 'github-actions',
          filePath: wfRel,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-wf-npm-ci-${wf}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 99,
            engine: 'deterministic',
            summary: 'Remplacer `npm install` par `npm ci` pour garantir une installation reproductible.',
            filePath: wfRel,
            beforeSnippet: line.trim(),
            afterSnippet: line.trim().replace(/npm\s+install/, 'npm ci'),
            actionType: 'replace-snippet',
          },
        });
      }
    }
  }

  return findings;
}
