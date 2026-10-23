import fs from 'node:fs';
import path from 'node:path';
import type { AutoFixProposal, Severity } from '../src/types/toolbox.ts';
import { githubApiRequest, resolveGitHubToken } from './githubService.ts';

export interface GitHubWorkflowRunItem {
  id: number;
  name: string;
  workflowName: string;
  runNumber: number;
  headBranch: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  event: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface CiDoctorDiagnosisItem {
  id: string;
  ruleId: string;
  title: string;
  category: 'typescript-compile' | 'dependencies-lock' | 'github-permissions' | 'python-runtime' | 'unit-tests' | 'docker-build' | 'node-engine' | 'generic-ci';
  severity: Severity;
  rootCause: string;
  failedStepName?: string;
  filePath?: string;
  line?: number;
  logExcerpt: string;
  recommendedCommand?: string;
  autoFix?: AutoFixProposal;
}

export interface CiDoctorReport {
  analyzedAt: string;
  source: 'github-actions-api' | 'manual-log';
  runId?: number;
  runName?: string;
  runUrl?: string;
  branch?: string;
  conclusion?: string;
  failedJobsCount: number;
  diagnoses: CiDoctorDiagnosisItem[];
}

/**
 * Récupère les 12 derniers Workflow Runs GitHub Actions du dépôt ciblé.
 */
export async function listGitHubWorkflowRuns(
  owner: string,
  repo: string,
  customToken?: string
): Promise<{
  runs: GitHubWorkflowRunItem[];
  failedCount: number;
}> {
  interface RawRunsResponse {
    workflow_runs?: Array<{
      id: number;
      name?: string;
      display_title?: string;
      run_number: number;
      head_branch: string;
      head_sha: string;
      status: string;
      conclusion: string | null;
      event: string;
      created_at: string;
      updated_at: string;
      html_url: string;
    }>;
  }

  const { token } = resolveGitHubToken(customToken);
  if (!token) {
    throw new Error('Authentification GitHub requise pour lister les exécutions GitHub Actions.');
  }

  const data = await githubApiRequest<RawRunsResponse>(
    `/repos/${owner}/${repo}/actions/runs?per_page=12`,
    token
  );

  const runs: GitHubWorkflowRunItem[] = (data.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.display_title || r.name || `Run #${r.run_number}`,
    workflowName: r.name || 'CI Workflow',
    runNumber: r.run_number,
    headBranch: r.head_branch,
    headSha: (r.head_sha || '').slice(0, 7),
    status: r.status,
    conclusion: r.conclusion,
    event: r.event,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
  }));

  const failedCount = runs.filter(
    (r) => r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'startup_failure'
  ).length;

  return { runs, failedCount };
}

function findPrimaryWorkflowFile(projectPath: string): string | null {
  const wfDir = path.join(projectPath, '.github', 'workflows');
  if (!fs.existsSync(wfDir)) return null;
  try {
    const files = fs
      .readdirSync(wfDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    if (files.length === 0) return null;
    return `.github/workflows/${files[0]}`;
  } catch {
    return null;
  }
}

/**
 * Analyse intelligente d'un journal d'erreur CI/CD (GitHub Actions, GitLab CI, terminal local)
 * et génération des correctifs locaux applicables en 1 clic sur le projet.
 */
export function diagnoseCiFailureLog(
  projectPath: string,
  rawLog: string,
  meta?: {
    source?: 'github-actions-api' | 'manual-log';
    runId?: number;
    runName?: string;
    runUrl?: string;
    branch?: string;
    conclusion?: string;
    failedJobsCount?: number;
    failedStepNames?: string[];
  }
): CiDoctorReport {
  const resolvedProject = path.resolve(projectPath);
  const diagnoses: CiDoctorDiagnosisItem[] = [];
  const primaryWf = findPrimaryWorkflowFile(resolvedProject);

  // 1. Détection d'erreurs de compilation TypeScript (ex: src/App.tsx(42,15): error TS2322: ...)
  const tsRegex = /([a-zA-Z0-9_./\\-]+\.tsx?)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*[:-]?\s*error\s+(TS\d+):\s*([^\r\n]+)/g;
  let tsMatch: RegExpExecArray | null;
  const seenTsErrors = new Set<string>();
  while ((tsMatch = tsRegex.exec(rawLog)) !== null) {
    const relFile = tsMatch[1].replace(/\\/g, '/').replace(/^\.\//, '');
    const lineNum = Number.parseInt(tsMatch[2] || tsMatch[4] || '1', 10);
    const tsCode = tsMatch[6];
    const errMsg = tsMatch[7].trim();
    const key = `${relFile}:${lineNum}:${tsCode}`;
    if (seenTsErrors.has(key)) continue;
    seenTsErrors.add(key);

    let autoFix: AutoFixProposal | undefined;
    const absTarget = path.resolve(resolvedProject, relFile);
    if (fs.existsSync(absTarget)) {
      try {
        const fileLines = fs.readFileSync(absTarget, 'utf-8').split(/\r?\n/);
        const offendingLine = fileLines[lineNum - 1]?.trim();
        if (offendingLine) {
          // Si TS6133 (variable déclarée mais jamais lue)
          const unusedMatch = errMsg.match(/'([^']+)' is declared but its value is never read/);
          if (tsCode === 'TS6133' && unusedMatch) {
            const varName = unusedMatch[1];
            autoFix = {
              id: `fix-cidoc-ts6133-${relFile}-${lineNum}`,
              available: true,
              reliable: true,
              confidence: 94,
              engine: 'deterministic',
              summary: `Préfixer la variable inutilisée '${varName}' par '_${varName}' (${relFile}:${lineNum})`,
              filePath: relFile,
              beforeSnippet: offendingLine,
              afterSnippet: offendingLine.replace(new RegExp(`\\b${varName}\\b`), `_${varName}`),
              actionType: 'replace-snippet',
            };
          } else {
            autoFix = {
              id: `fix-cidoc-ts-${relFile}-${lineNum}`,
              available: true,
              reliable: false,
              confidence: 84,
              engine: 'hybrid-ai',
              summary: `Annoter ou corriger l'erreur TypeScript ${tsCode} dans ${relFile}:${lineNum}`,
              filePath: relFile,
              beforeSnippet: offendingLine,
              afterSnippet: `// @ts-expect-error Aegis-CI-Doctor(${tsCode}): ${errMsg.slice(0, 70)}\n${offendingLine}`,
              actionType: 'replace-snippet',
            };
          }
        }
      } catch {
        // Ignore read error
      }
    }

    diagnoses.push({
      id: `cidoc-ts-${diagnoses.length + 1}`,
      ruleId: 'CI-DOC-TS-001',
      title: `Erreur de compilation TypeScript ${tsCode} dans ${relFile}:${lineNum}`,
      category: 'typescript-compile',
      severity: 'critical',
      rootCause: `Le compilateur TypeScript a échoué sur ${relFile} (ligne ${lineNum}) : ${errMsg}`,
      filePath: relFile,
      line: lineNum,
      logExcerpt: tsMatch[0],
      recommendedCommand: 'npm run lint',
      autoFix,
    });
  }

  // 2. Détection d'échec npm ci (package-lock.json désynchronisé ou manquant)
  if (
    /npm (?:ERR!|error) code EUSAGE/i.test(rawLog) ||
    /can only install packages when your package\.json and package-lock\.json/i.test(rawLog) ||
    /Missing: .+ from lock file/i.test(rawLog)
  ) {
    let wfAutoFix: AutoFixProposal | undefined;
    if (primaryWf) {
      const absWf = path.join(resolvedProject, primaryWf);
      if (fs.existsSync(absWf)) {
        const wfContent = fs.readFileSync(absWf, 'utf-8');
        if (wfContent.includes('npm ci')) {
          wfAutoFix = {
            id: 'fix-cidoc-npm-ci-fallback',
            available: true,
            reliable: true,
            confidence: 95,
            engine: 'deterministic',
            summary: `Remplacer 'npm ci' par 'npm ci || npm install' dans ${primaryWf} et régénérer le lockfile`,
            filePath: primaryWf,
            beforeSnippet: 'run: npm ci',
            afterSnippet: 'run: npm ci || npm install',
            actionType: 'replace-snippet',
          };
        }
      }
    }

    diagnoses.push({
      id: `cidoc-npmlock-${diagnoses.length + 1}`,
      ruleId: 'CI-DOC-DEPS-002',
      title: 'Désynchronisation entre package.json et package-lock.json (npm ci EUSAGE)',
      category: 'dependencies-lock',
      severity: 'high',
      rootCause:
        'La commande `npm ci` a échoué dans le runner CI car `package-lock.json` ne correspond pas exactement aux dépendances déclarées dans `package.json`.',
      filePath: primaryWf || 'package.json',
      logExcerpt:
        rawLog
          .split(/\r?\n/)
          .find((l) => /EUSAGE|package-lock\.json|from lock file/i.test(l))
          ?.trim() || 'npm error code EUSAGE: package.json and package-lock.json are out of sync',
      recommendedCommand: 'npm install --package-lock-only',
      autoFix: wfAutoFix,
    });
  }

  // 3. Détection d'erreur de permissions GitHub Token (403 Resource not accessible by integration)
  if (
    /Resource not accessible by integration/i.test(rawLog) ||
    /Permission to .+ denied to github-actions\[bot\]/i.test(rawLog) ||
    /403 Forbidden.*actions/i.test(rawLog)
  ) {
    let permFix: AutoFixProposal | undefined;
    if (primaryWf) {
      const absWf = path.join(resolvedProject, primaryWf);
      if (fs.existsSync(absWf)) {
        const firstLine = fs.readFileSync(absWf, 'utf-8').split(/\r?\n/)[0] || 'name: CI';
        permFix = {
          id: 'fix-cidoc-gh-permissions',
          available: true,
          reliable: true,
          confidence: 96,
          engine: 'deterministic',
          summary: `Ajouter le bloc permissions explicite (contents/pull-requests/checks) dans ${primaryWf}`,
          filePath: primaryWf,
          beforeSnippet: firstLine,
          afterSnippet: `${firstLine}\n\npermissions:\n  contents: write\n  pull-requests: write\n  checks: write`,
          actionType: 'replace-snippet',
        };
      }
    }

    diagnoses.push({
      id: `cidoc-perm-${diagnoses.length + 1}`,
      ruleId: 'CI-DOC-PERM-003',
      title: 'Jeton GITHUB_TOKEN bloqué (403 Resource not accessible by integration)',
      category: 'github-permissions',
      severity: 'high',
      rootCause:
        'Le workflow GitHub Actions tente d écrire sur le dépôt (PR, release, check-run ou push) avec un GITHUB_TOKEN restreint en lecture seule.',
      filePath: primaryWf || '.github/workflows/ci.yml',
      logExcerpt: 'HttpError: Resource not accessible by integration (403)',
      autoFix: permFix,
    });
  }

  // 4. Détection de module Python manquant (ModuleNotFoundError: No module named 'xxx')
  const pyModMatch = rawLog.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/);
  if (pyModMatch) {
    const missingPkg = pyModMatch[1].split('.')[0];
    const reqPath = path.join(resolvedProject, 'requirements.txt');
    let pyFix: AutoFixProposal | undefined;
    if (fs.existsSync(reqPath)) {
      const reqLines = fs.readFileSync(reqPath, 'utf-8').trim().split(/\r?\n/);
      const lastLine = reqLines[reqLines.length - 1] || '';
      pyFix = {
        id: `fix-cidoc-py-${missingPkg}`,
        available: Boolean(lastLine),
        reliable: true,
        confidence: 94,
        engine: 'deterministic',
        summary: `Ajouter le paquet manquant '${missingPkg}' dans requirements.txt`,
        filePath: 'requirements.txt',
        beforeSnippet: lastLine,
        afterSnippet: `${lastLine}\n${missingPkg}>=0.1.0`,
        actionType: 'replace-snippet',
      };
    } else {
      pyFix = {
        id: `fix-cidoc-py-create-${missingPkg}`,
        available: true,
        reliable: true,
        confidence: 95,
        engine: 'deterministic',
        summary: `Créer requirements.txt avec la dépendance '${missingPkg}'`,
        filePath: 'requirements.txt',
        beforeSnippet: '',
        afterSnippet: `${missingPkg}>=0.1.0\n`,
        actionType: 'create-file',
      };
    }

    diagnoses.push({
      id: `cidoc-py-${diagnoses.length + 1}`,
      ruleId: 'CI-DOC-PY-004',
      title: `Dépendance Python manquante en CI : '${missingPkg}' (ModuleNotFoundError)`,
      category: 'python-runtime',
      severity: 'critical',
      rootCause: `L'environnement Python du runner CI ne trouve pas le paquet '${missingPkg}' car il est absent de requirements.txt.`,
      filePath: 'requirements.txt',
      logExcerpt: pyModMatch[0],
      recommendedCommand: `pip install ${missingPkg}`,
      autoFix: pyFix,
    });
  }

  // 5. Détection d'échec de tests unitaires (Vitest / Jest / Pytest)
  const testFailMatch = rawLog.match(/(?:FAIL|❯|×)\s+([a-zA-Z0-9_./\\-]+\.(?:test|spec)\.[a-z]+)/i);
  if (testFailMatch || /AssertionError:/i.test(rawLog)) {
    const testFile = testFailMatch ? testFailMatch[1].replace(/\\/g, '/') : 'tests/';
    const assertionLine =
      rawLog
        .split(/\r?\n/)
        .find((l) => /AssertionError|Expected .* to |received/i.test(l))
        ?.trim() || testFailMatch?.[0] || 'Test suite failed in CI';

    diagnoses.push({
      id: `cidoc-test-${diagnoses.length + 1}`,
      ruleId: 'CI-DOC-TEST-005',
      title: `Échec de suite de tests automatisés dans ${testFile}`,
      category: 'unit-tests',
      severity: 'high',
      rootCause: `Un ou plusieurs tests unitaires ont échoué durant le pipeline CI (${assertionLine}).`,
      filePath: testFile,
      logExcerpt: assertionLine,
      recommendedCommand: 'npm test',
    });
  }

  // 6. Détection d'incompatibilité de version Node.js (EBADENGINE)
  if (/EBADENGINE|Unsupported engine|requires node version/i.test(rawLog)) {
    let nodeFix: AutoFixProposal | undefined;
    if (primaryWf) {
      const absWf = path.join(resolvedProject, primaryWf);
      if (fs.existsSync(absWf)) {
        const wfContent = fs.readFileSync(absWf, 'utf-8');
        const nodeVerMatch = wfContent.match(/node-version:\s*['"]?(14|16|18)['"]?/);
        if (nodeVerMatch) {
          nodeFix = {
            id: 'fix-cidoc-node-version',
            available: true,
            reliable: true,
            confidence: 97,
            engine: 'deterministic',
            summary: `Mettre à jour node-version vers '20' LTS dans ${primaryWf}`,
            filePath: primaryWf,
            beforeSnippet: nodeVerMatch[0],
            afterSnippet: "node-version: '20'",
            actionType: 'replace-snippet',
          };
        }
      }
    }

    diagnoses.push({
      id: `cidoc-node-${diagnoses.length + 1}`,
      ruleId: 'CI-DOC-NODE-006',
      title: 'Incompatibilité de version du moteur Node.js en CI (EBADENGINE)',
      category: 'node-engine',
      severity: 'high',
      rootCause:
        'Une dépendance requiert une version plus récente de Node.js (>= 20 LTS) que celle configurée dans le workflow GitHub Actions.',
      filePath: primaryWf || 'package.json',
      logExcerpt:
        rawLog
          .split(/\r?\n/)
          .find((l) => /EBADENGINE|Unsupported engine|node/i.test(l))
          ?.trim() || 'npm WARN EBADENGINE Unsupported engine',
      autoFix: nodeFix,
    });
  }

  // 7. Si aucune signature connue n'a matché mais que nous avons des étapes en échec issues de GitHub Actions
  if (diagnoses.length === 0 && rawLog.trim().length > 0) {
    const failedSteps = meta?.failedStepNames || [];
    const excerptLines = rawLog
      .split(/\r?\n/)
      .filter((l) => /error|fail|exception|fatal|exit code/i.test(l))
      .slice(-5)
      .join('\n');

    diagnoses.push({
      id: 'cidoc-generic-1',
      ruleId: 'CI-DOC-GEN-001',
      title:
        failedSteps.length > 0
          ? `Échec détecté à l'étape CI : "${failedSteps.join(', ')}"`
          : 'Erreur d exécution détectée dans le journal CI/CD',
      category: 'generic-ci',
      severity: 'medium',
      rootCause:
        failedSteps.length > 0
          ? `Le job GitHub Actions s'est arrêté à l'étape "${failedSteps[0]}". Exécutez localement la vérification complète pour reproduire et corriger.`
          : 'Le pipeline s est terminé avec un code de sortie non nul.',
      failedStepName: failedSteps[0],
      logExcerpt: excerptLines || rawLog.trim().slice(-350),
      recommendedCommand: 'npm run lint; npm test',
    });
  }

  return {
    analyzedAt: new Date().toISOString(),
    source: meta?.source || 'manual-log',
    runId: meta?.runId,
    runName: meta?.runName,
    runUrl: meta?.runUrl,
    branch: meta?.branch,
    conclusion: meta?.conclusion || 'failure',
    failedJobsCount: meta?.failedJobsCount ?? (diagnoses.length > 0 ? 1 : 0),
    diagnoses,
  };
}

/**
 * Inspecte un Run GitHub Actions spécifique (ses jobs, étapes en échec, annotations et journaux)
 * et génère un rapport complet CI Failure Doctor avec correctifs locaux.
 */
export async function inspectAndDiagnoseGitHubRun(
  projectPath: string,
  owner: string,
  repo: string,
  runId: number,
  customToken?: string
): Promise<CiDoctorReport> {
  interface RawRunDetail {
    id: number;
    name?: string;
    display_title?: string;
    head_branch?: string;
    conclusion?: string | null;
    html_url?: string;
  }

  interface RawJobsResponse {
    jobs?: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      html_url: string;
      steps?: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        number: number;
      }>;
    }>;
  }

  interface RawAnnotation {
    path?: string;
    start_line?: number;
    annotation_level?: string;
    message?: string;
    title?: string;
    raw_details?: string;
  }

  const { token } = resolveGitHubToken(customToken);
  if (!token) {
    throw new Error('Authentification GitHub requise pour inspecter ce workflow.');
  }

  const [runDetail, jobsData] = await Promise.all([
    githubApiRequest<RawRunDetail>(`/repos/${owner}/${repo}/actions/runs/${runId}`, token),
    githubApiRequest<RawJobsResponse>(
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
      token
    ),
  ]);

  const jobs = jobsData.jobs || [];
  const failedJobs = jobs.filter(
    (j) => j.conclusion === 'failure' || j.conclusion === 'timed_out' || j.conclusion === 'cancelled'
  );

  const collectedLogParts: string[] = [];
  const failedStepNames: string[] = [];

  for (const job of failedJobs.length > 0 ? failedJobs : jobs.slice(0, 2)) {
    for (const step of job.steps || []) {
      if (step.conclusion === 'failure') {
        failedStepNames.push(`${job.name} › ${step.name}`);
        collectedLogParts.push(`[Step Failed] Job "${job.name}" -> Step #${step.number} "${step.name}"`);
      }
    }

    // 1. Récupérer les annotations Check-Run (contiennent souvent le fichier/ligne exact TS/ESLint/Test)
    try {
      const annotations = await githubApiRequest<RawAnnotation[]>(
        `/repos/${owner}/${repo}/check-runs/${job.id}/annotations`,
        token
      );
      for (const ann of annotations || []) {
        if (ann.path && ann.start_line) {
          collectedLogParts.push(
            `${ann.path}(${ann.start_line},1): error ${ann.title || 'CI'}: ${ann.message || ''}`
          );
        } else if (ann.message) {
          collectedLogParts.push(`[Annotation] ${ann.title || ''}: ${ann.message}`);
        }
        if (ann.raw_details) {
          collectedLogParts.push(ann.raw_details);
        }
      }
    } catch {
      // Annotations optional
    }

    // 2. Tenter de récupérer les dernières lignes du log texte du job
    if (token) {
      try {
        const logRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
          {
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${token}`,
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'Aegis-CI-CD-Toolbox/1.0',
            },
          }
        );
        if (logRes.ok) {
          const textLog = await logRes.text();
          collectedLogParts.push(textLog.slice(-12000));
        }
      } catch {
        // Ignore raw log download error
      }
    }
  }

  const combinedLog =
    collectedLogParts.join('\n') ||
    `Workflow "${runDetail.display_title || runDetail.name}" terminé avec statut: ${
      runDetail.conclusion || 'unknown'
    }`;

  return diagnoseCiFailureLog(projectPath, combinedLog, {
    source: 'github-actions-api',
    runId: runDetail.id,
    runName: runDetail.display_title || runDetail.name || `Run #${runId}`,
    runUrl: runDetail.html_url,
    branch: runDetail.head_branch,
    conclusion: runDetail.conclusion || 'failure',
    failedJobsCount: failedJobs.length,
    failedStepNames,
  });
}
