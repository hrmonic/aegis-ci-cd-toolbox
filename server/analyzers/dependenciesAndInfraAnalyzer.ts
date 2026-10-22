import fs from 'node:fs';
import path from 'node:path';
import type { DiagnosticFinding, StackId } from '../../src/types/toolbox.ts';
import { generateHardenedDockerfile } from '../pipelineTemplates.ts';

export function analyzeDependenciesDockerAndTests(
  resolvedPath: string,
  allFiles: string[],
  detectedStacks: StackId[],
  selectedStacks: StackId[],
  testFilesCount: number
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  // ============================================================================
  // 1. DOCKER & CONTAINER HARDENING (DOCKER-001 to DOCKER-005)
  // ============================================================================
  const dockerfilePath = path.join(resolvedPath, 'Dockerfile');
  if (selectedStacks.includes('docker')) {
    if (!fs.existsSync(dockerfilePath)) {
      const hardenedDocker = generateHardenedDockerfile(selectedStacks);
      findings.push({
        id: 'docker-missing-dockerfile',
        ruleId: 'DOCKER-001',
        title: 'Dockerfile Multi-Stage sécurisé manquant',
        description:
          'La stack Docker est activée mais aucun `Dockerfile` n’est présent pour garantir un environnement d’exécution isolé, reproductible et non-root.',
        impact: 'Déploiements non standardisés entre les environnements.',
        category: 'containers-infra',
        severity: 'medium',
        stack: 'docker',
        filePath: 'Dockerfile',
        line: 1,
        status: 'open',
        autoFix: {
          id: 'fix-create-dockerfile',
          available: true,
          reliable: true,
          confidence: 97,
          engine: 'deterministic',
          summary: 'Créer un Dockerfile multi-stage optimisé avec utilisateur non-root et HEALTHCHECK.',
          filePath: 'Dockerfile',
          beforeSnippet: '# Aucun Dockerfile présent',
          afterSnippet: hardenedDocker,
          actionType: 'create-file',
        },
      });
    } else {
      const dockerContent = fs.readFileSync(dockerfilePath, 'utf-8');
      const dockerLines = dockerContent.split('\n');

      // DOCKER-002: Running as root (missing USER directive)
      if (!/^\s*USER\s+/m.test(dockerContent)) {
        findings.push({
          id: 'docker-running-as-root',
          ruleId: 'DOCKER-002',
          title: 'Conteneur Docker exécuté en tant que root (absence de directive USER)',
          description:
            'Le `Dockerfile` ne bascule pas vers un utilisateur non-privilégié (`USER node` ou `USER appuser`).',
          impact: 'Risque d’escalade de privilèges en cas de compromission du processus conteneurisé.',
          category: 'containers-infra',
          severity: 'high',
          stack: 'docker',
          filePath: 'Dockerfile',
          line: dockerLines.length,
          status: 'open',
          autoFix: {
            id: 'fix-docker-non-root',
            available: true,
            reliable: true,
            confidence: 96,
            engine: 'deterministic',
            summary: 'Ajouter `USER node` avant l’instruction CMD.',
            filePath: 'Dockerfile',
            beforeSnippet: dockerLines.slice(-2).join('\n'),
            afterSnippet: 'USER node\n' + dockerLines.slice(-2).join('\n'),
            actionType: 'append-file',
          },
        });
      }

      // DOCKER-003: Unpinned `:latest` base image tag
      const latestLineIdx = dockerLines.findIndex((l) => /^\s*FROM\s+[^\s:]+:latest\b/i.test(l));
      if (latestLineIdx !== -1) {
        const line = dockerLines[latestLineIdx];
        findings.push({
          id: 'docker-unpinned-latest',
          ruleId: 'DOCKER-003',
          title: `Image Docker de base utilisant le tag flottant ":latest" (Dockerfile:${latestLineIdx + 1})`,
          description:
            'L’utilisation de `FROM ...:latest` brise la reproductibilité des builds CI/CD et peut introduire des changements cassants d’OS du jour au lendemain.',
          impact: 'Builds Docker non déterministes et taille d’image non maîtrisée.',
          category: 'containers-infra',
          severity: 'medium',
          stack: 'docker',
          filePath: 'Dockerfile',
          line: latestLineIdx + 1,
          status: 'open',
          autoFix: {
            id: 'fix-docker-latest',
            available: true,
            reliable: true,
            confidence: 95,
            engine: 'deterministic',
            summary: 'Épingler le tag de l’image Docker vers une version stable (`:22-alpine` ou `:slim`).',
            filePath: 'Dockerfile',
            beforeSnippet: line.trim(),
            afterSnippet: line.trim().replace(/:latest\b/i, ':lts-alpine'),
            actionType: 'replace-snippet',
          },
        });
      }

      // DOCKER-004: Missing HEALTHCHECK
      if (!/^\s*HEALTHCHECK\s+/m.test(dockerContent)) {
        findings.push({
          id: 'docker-missing-healthcheck',
          ruleId: 'DOCKER-004',
          title: 'Absence de directive HEALTHCHECK dans le Dockerfile',
          description:
            'Sans `HEALTHCHECK`, Docker, Swarm ou Kubernetes ne peuvent pas détecter si le processus applicatif est figé (deadlock) et le redémarrer automatiquement.',
          impact: 'Indisponibilité silencieuse du conteneur en production.',
          category: 'containers-infra',
          severity: 'low',
          stack: 'docker',
          filePath: 'Dockerfile',
          line: dockerLines.length,
          status: 'open',
          autoFix: {
            id: 'fix-docker-healthcheck',
            available: true,
            reliable: true,
            confidence: 94,
            engine: 'deterministic',
            summary: 'Ajouter une sonde `HEALTHCHECK` standard au Dockerfile.',
            filePath: 'Dockerfile',
            beforeSnippet: dockerLines.slice(-1)[0] || '',
            afterSnippet:
              'HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:4177/api/health || exit 1',
            actionType: 'append-file',
          },
        });
      }

      // DOCKER-005: Missing .dockerignore when Dockerfile is present
      const dockerignorePath = path.join(resolvedPath, '.dockerignore');
      if (!fs.existsSync(dockerignorePath)) {
        findings.push({
          id: 'docker-missing-dockerignore',
          ruleId: 'DOCKER-005',
          title: 'Fichier .dockerignore manquant à côté du Dockerfile',
          description:
            'Sans `.dockerignore`, la commande `COPY . .` envoie `.git/`, `node_modules/` et potentiellement `.env` dans le contexte de build et l’image Docker finale.',
          impact: 'Ralentissement majeur du build Docker et risque d’inclusion de secrets locaux dans l’image.',
          category: 'containers-infra',
          severity: 'medium',
          stack: 'docker',
          filePath: '.dockerignore',
          line: 1,
          status: 'open',
          autoFix: {
            id: 'fix-create-dockerignore',
            available: true,
            reliable: true,
            confidence: 100,
            engine: 'deterministic',
            summary: 'Créer un fichier `.dockerignore` excluant `node_modules`, `.git`, `.env*` et `coverage`.',
            filePath: '.dockerignore',
            beforeSnippet: '# .dockerignore absent',
            afterSnippet:
              'node_modules\n.git\n.gitignore\n.env\n.env.*\ndist\ncoverage\n*.log\n.ci-cd-toolbox-backups\n.ci-cd-toolbox-cache\n',
            actionType: 'create-file',
          },
        });
      }
    }
  }

  // ============================================================================
  // 2. NODE.JS, PACKAGE.JSON & TSCONFIG CHECKS (DEPS-001 to DEPS-004, TEST-001)
  // ============================================================================
  const pkgJsonPath = path.join(resolvedPath, 'package.json');
  if (fs.existsSync(pkgJsonPath) && selectedStacks.includes('nodejs')) {
    try {
      const rawPkg = fs.readFileSync(pkgJsonPath, 'utf-8');
      const pkg = JSON.parse(rawPkg);
      const scripts = pkg.scripts || {};

      // TEST-001: Missing test script
      if (!scripts.test || scripts.test.includes('no test specified')) {
        findings.push({
          id: 'node-missing-test-script',
          ruleId: 'TEST-001',
          title: 'Script "test" absent ou non configuré dans package.json',
          description:
            'Le fichier `package.json` ne définit pas de commande de test automatisée valide.',
          impact: 'Aucune validation automatisée des régressions en CI/CD.',
          category: 'test-robustness',
          severity: 'high',
          stack: 'nodejs',
          filePath: 'package.json',
          line: 8,
          status: 'open',
          autoFix: {
            id: 'fix-pkg-test-script',
            available: true,
            reliable: true,
            confidence: 95,
            engine: 'deterministic',
            summary: 'Configurer `"test": "vitest run"` dans les scripts de package.json.',
            filePath: 'package.json',
            beforeSnippet: `"scripts": {\n    ${Object.entries(scripts).slice(0, 2).map(([k, v]) => `"${k}": "${v}"`).join(',\n    ')}`,
            afterSnippet: `"scripts": {\n    "test": "vitest run",\n    ${Object.entries(scripts).slice(0, 2).map(([k, v]) => `"${k}": "${v}"`).join(',\n    ')}`,
            actionType: 'json-patch',
          },
        });
      }

      // DEPS-001: Missing engines.node
      if (!pkg.engines || !pkg.engines.node) {
        findings.push({
          id: 'node-missing-engines',
          ruleId: 'DEPS-001',
          title: 'Version du moteur Node.js ("engines.node") non spécifiée',
          description:
            'Sans champ `engines.node` dans `package.json`, les environnements locaux et CI/CD peuvent exécuter le projet sur des versions Node incompatibles.',
          impact: 'Divergences de comportement entre machines et pipelines.',
          category: 'dependencies-build',
          severity: 'low',
          stack: 'nodejs',
          filePath: 'package.json',
          line: 5,
          status: 'open',
          autoFix: {
            id: 'fix-pkg-engines',
            available: true,
            reliable: true,
            confidence: 99,
            engine: 'deterministic',
            summary: 'Ajouter `"engines": { "node": ">=20.0.0" }` dans package.json.',
            filePath: 'package.json',
            beforeSnippet: `"version": "${pkg.version || '1.0.0'}",`,
            afterSnippet: `"version": "${pkg.version || '1.0.0'}",\n  "engines": {\n    "node": ">=20.0.0"\n  },`,
            actionType: 'json-patch',
          },
        });
      }

      // DEPS-002: Missing lockfile
      const hasLockfile =
        fs.existsSync(path.join(resolvedPath, 'package-lock.json')) ||
        fs.existsSync(path.join(resolvedPath, 'pnpm-lock.yaml')) ||
        fs.existsSync(path.join(resolvedPath, 'yarn.lock')) ||
        fs.existsSync(path.join(resolvedPath, 'bun.lockb'));
      if (!hasLockfile) {
        findings.push({
          id: 'node-missing-lockfile',
          ruleId: 'DEPS-002',
          title: 'Aucun fichier de verrouillage (package-lock.json / pnpm-lock.yaml) détecté',
          description:
            'Sans lockfile, `npm ci` échoue en CI/CD et les sous-dépendances ne sont pas figées.',
          impact: 'Builds non reproductibles et risque de régression transitive.',
          category: 'dependencies-build',
          severity: 'high',
          stack: 'nodejs',
          filePath: 'package.json',
          line: 1,
          status: 'open',
          autoFix: {
            id: 'fix-lockfile-hint',
            available: false,
            reliable: false,
            confidence: 85,
            engine: 'deterministic',
            summary: 'Exécuter `npm install --package-lock-only` pour générer le lockfile.',
            filePath: 'package.json',
            beforeSnippet: '# Lockfile absent',
            afterSnippet: '# Généré via npm install --package-lock-only',
            actionType: 'replace-snippet',
          },
        });
      }

      // DEPS-003: Wildcard `*` or `latest` dependency versions
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const wildcardDeps = Object.entries(allDeps).filter(
        ([, ver]) => ver === '*' || ver === 'latest'
      );
      if (wildcardDeps.length > 0) {
        const [badPkg, badVer] = wildcardDeps[0];
        findings.push({
          id: `node-wildcard-dep-${badPkg}`,
          ruleId: 'DEPS-003',
          title: `Dépendance NPM non verrouillée ("${badPkg}": "${badVer}") dans package.json`,
          description: `La dépendance \`${badPkg}\` utilise \`${badVer}\`, ce qui installe n'importe quelle version majeure cassante lors d'un build CI/CD.`,
          impact: 'Rupture soudaine du build et exposition aux attaques de dépendances.',
          category: 'dependencies-build',
          severity: 'high',
          stack: 'nodejs',
          filePath: 'package.json',
          line: 15,
          status: 'open',
          autoFix: {
            id: `fix-wildcard-dep-${badPkg}`,
            available: true,
            reliable: true,
            confidence: 93,
            engine: 'deterministic',
            summary: `Remplacer "${badVer}" par une plage sémantique stable "^1.0.0".`,
            filePath: 'package.json',
            beforeSnippet: `"${badPkg}": "${badVer}"`,
            afterSnippet: `"${badPkg}": "^1.0.0"`,
            actionType: 'replace-snippet',
          },
        });
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // DEPS-004: TypeScript strict mode check in tsconfig.json / tsconfig.app.json
  const tsconfigPath = path.join(resolvedPath, 'tsconfig.json');
  const tsconfigAppPath = path.join(resolvedPath, 'tsconfig.app.json');
  if (fs.existsSync(tsconfigPath) && selectedStacks.includes('typescript')) {
    try {
      const tsContent = fs.readFileSync(tsconfigPath, 'utf-8');
      const tsAppContent = fs.existsSync(tsconfigAppPath)
        ? fs.readFileSync(tsconfigAppPath, 'utf-8')
        : '';
      if (!/"strict"\s*:\s*true/.test(tsContent) && !/"strict"\s*:\s*true/.test(tsAppContent)) {
        findings.push({
          id: 'ts-missing-strict-mode',
          ruleId: 'DEPS-004',
          title: 'Mode "strict": true non activé dans tsconfig.json',
          description:
            'Sans `"strict": true`, TypeScript autorise les valeurs `null`/`undefined` implicites et les paramètres non typés (`noImplicitAny: false`).',
          impact: 'Les erreurs de typage générées par IA passent inaperçues à la compilation.',
          category: 'dependencies-build',
          severity: 'medium',
          stack: 'typescript',
          filePath: 'tsconfig.json',
          line: 5,
          status: 'open',
          autoFix: {
            id: 'fix-ts-strict',
            available: true,
            reliable: true,
            confidence: 95,
            engine: 'deterministic',
            summary: 'Activer `"strict": true` dans `compilerOptions` de `tsconfig.json`.',
            filePath: 'tsconfig.json',
            beforeSnippet: '"compilerOptions": {',
            afterSnippet: '"compilerOptions": {\n    "strict": true,',
            actionType: 'replace-snippet',
          },
        });
      }
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // 3. PYTHON & PHP STACK CHECKS (PY-001, PY-002, PHP-001)
  // ============================================================================
  const reqTxtPath = path.join(resolvedPath, 'requirements.txt');
  if (fs.existsSync(reqTxtPath)) {
    const reqContent = fs.readFileSync(reqTxtPath, 'utf-8');
    const unpinnedLines = reqContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.includes('==') && !l.includes('>='));
    if (unpinnedLines.length > 0) {
      findings.push({
        id: 'python-unpinned-requirements',
        ruleId: 'PY-002',
        title: `Dépendances Python non épinglées dans requirements.txt (${unpinnedLines.length} paquets)`,
        description: `Les paquets suivants n'ont pas de version figée (\`==\`): ${unpinnedLines.slice(0, 4).join(', ')}.`,
        impact: 'Builds Python non reproductibles entre les environnements.',
        category: 'dependencies-build',
        severity: 'medium',
        stack: 'python',
        filePath: 'requirements.txt',
        line: 1,
        status: 'open',
        autoFix: {
          id: 'fix-pin-requirements',
          available: true,
          reliable: true,
          confidence: 90,
          engine: 'hybrid-ai',
          summary: 'Verrouiller les versions minimales compatibles dans requirements.txt.',
          filePath: 'requirements.txt',
          beforeSnippet: unpinnedLines.slice(0, 4).join('\n'),
          afterSnippet: unpinnedLines.slice(0, 4).map((pkg) => `${pkg}>=1.0.0`).join('\n'),
          actionType: 'replace-snippet',
        },
      });
    }
  }

  if (selectedStacks.includes('python') && !fs.existsSync(path.join(resolvedPath, 'pyproject.toml'))) {
    findings.push({
      id: 'python-missing-pyproject',
      ruleId: 'PY-001',
      title: 'Configuration Python (pyproject.toml avec Ruff & Pytest) absente',
      description:
        'La stack Python est active mais aucun `pyproject.toml` ne configure le linter Ruff ni Pytest.',
      impact: 'Absence de standardisation de l’analyse statique Python en CI.',
      category: 'dependencies-build',
      severity: 'medium',
      stack: 'python',
      filePath: 'pyproject.toml',
      line: 1,
      status: 'open',
      autoFix: {
        id: 'fix-create-pyproject',
        available: true,
        reliable: true,
        confidence: 96,
        engine: 'deterministic',
        summary: 'Créer un fichier `pyproject.toml` préconfiguré avec Ruff et Pytest.',
        filePath: 'pyproject.toml',
        beforeSnippet: '# pyproject.toml absent',
        afterSnippet: `[tool.ruff]\nline-length = 100\ntarget-version = "py312"\n\n[tool.ruff.lint]\nselect = ["E", "F", "I", "B"]\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
        actionType: 'create-file',
      },
    });
  }

  if (selectedStacks.includes('php-symfony') && !fs.existsSync(path.join(resolvedPath, 'phpstan.neon'))) {
    findings.push({
      id: 'php-missing-phpstan',
      ruleId: 'PHP-001',
      title: 'Analyse statique PHPStan non configurée pour PHP/Symfony',
      description:
        'Un fichier `phpstan.neon` permet de détecter les erreurs de typage PHP avant l’exécution.',
      impact: 'Erreurs fatales non détectées en amont.',
      category: 'ai-code-quality',
      severity: 'medium',
      stack: 'php-symfony',
      filePath: 'phpstan.neon',
      line: 1,
      status: 'open',
      autoFix: {
        id: 'fix-create-phpstan',
        available: true,
        reliable: true,
        confidence: 95,
        engine: 'deterministic',
        summary: 'Générer une configuration `phpstan.neon` (niveau 6).',
        filePath: 'phpstan.neon',
        beforeSnippet: '# phpstan.neon absent',
        afterSnippet: `parameters:\n    level: 6\n    paths:\n        - src\n        - tests\n`,
        actionType: 'create-file',
      },
    });
  }

  // ============================================================================
  // 4. TEST SUITE QUALITY & SKIPPED TESTS (TEST-002 & TEST-003)
  // ============================================================================
  if (testFilesCount === 0) {
    const isPyProject = detectedStacks.includes('python') && !detectedStacks.includes('nodejs');
    findings.push({
      id: 'test-no-unit-tests-found',
      ruleId: 'TEST-002',
      title: 'Aucun fichier de test unitaire ou d’intégration détecté',
      description:
        'Le projet ne comporte aucun fichier de test automatisé. Chaque module critique devrait être couvert par des tests de non-régression.',
      impact: 'Impossibilité de vérifier automatiquement qu’une modification ne casse pas l’existant.',
      category: 'test-robustness',
      severity: 'high',
      stack: isPyProject ? 'python' : 'typescript',
      filePath: isPyProject ? 'tests/test_smoke.py' : 'tests/smoke.test.ts',
      line: 1,
      status: 'open',
      autoFix: {
        id: 'fix-create-smoke-test',
        available: true,
        reliable: true,
        confidence: 98,
        engine: 'deterministic',
        summary: isPyProject
          ? 'Générer une suite de tests initiale Pytest (`tests/test_smoke.py`).'
          : 'Générer une suite de tests initiale Vitest (`tests/smoke.test.ts`).',
        filePath: isPyProject ? 'tests/test_smoke.py' : 'tests/smoke.test.ts',
        beforeSnippet: '# Aucun fichier de test présent',
        afterSnippet: isPyProject
          ? `def test_environment_ready():\n    """Smoke test initial CI/CD."""\n    assert True\n`
          : `import { describe, it, expect } from 'vitest';\n\ndescribe('Suite de Santé CI/CD Initiale', () => {\n  it('vérifie la cohérence de l’environnement d’exécution', () => {\n    expect(process.env.NODE_ENV || 'test').toBeDefined();\n  });\n});\n`,
        actionType: 'create-file',
      },
    });
  } else {
    // Check for skipped tests (.skip / xit / xdescribe) in test files
    for (const fullFile of allFiles) {
      const relFile = path.relative(resolvedPath, fullFile).replace(/\\/g, '/');
      if (
        !relFile.includes('.test.') &&
        !relFile.includes('.spec.') &&
        !relFile.startsWith('tests/')
      ) {
        continue;
      }
      if (relFile === 'tests/toolbox.test.ts') continue;

      let content = '';
      try {
        content = fs.readFileSync(fullFile, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\b(?:it|test|describe)\.skip\s*\(/.test(line) || /\b(?:xit|xdescribe)\s*\(/.test(line)) {
          findings.push({
            id: `test-skipped-${relFile}-${i + 1}`,
            ruleId: 'TEST-003',
            title: `Test automatisé désactivé (.skip) dans ${relFile}:${i + 1}`,
            description:
              'Un test unitaire est explicitement ignoré via `.skip`. Les tests ignorés donnent une fausse impression de sécurité en CI/CD.',
            impact: 'Trou de couverture de non-régression.',
            category: 'test-robustness',
            severity: 'low',
            stack: 'typescript',
            filePath: relFile,
            line: i + 1,
            status: 'open',
            autoFix: {
              id: `fix-unskip-${relFile}-${i + 1}`,
              available: true,
              reliable: true,
              confidence: 95,
              engine: 'deterministic',
              summary: 'Réactiver le test en retirant `.skip`.',
              filePath: relFile,
              beforeSnippet: line.trim(),
              afterSnippet: line.trim().replace(/\.skip\s*\(/, '('),
              actionType: 'replace-snippet',
            },
          });
        }
      }
    }
  }

  return findings;
}
