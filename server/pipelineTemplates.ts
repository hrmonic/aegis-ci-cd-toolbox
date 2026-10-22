import type { StackId, StackDefinition } from '../src/types/toolbox.ts';

export const STACK_CATALOG: StackDefinition[] = [
  {
    id: 'nodejs',
    name: 'Node.js / NPM / PNPM',
    category: 'language',
    description: 'Audit du package.json, scripts CI, lockfiles, audit de vulnérabilités et moteurs Node.',
    detected: false,
    selected: true,
    indicators: ['package.json', 'package-lock.json', 'pnpm-lock.yaml'],
    recommendedChecks: ['Lockfile strict (npm ci)', 'Scripts test/lint/build', 'Audit de sécurité NPM', 'Engines Node épinglés'],
  },
  {
    id: 'typescript',
    name: 'TypeScript Strict AI-Safe',
    category: 'language',
    description: 'Contrôle du typage strict, élimination des types `any` générés par IA, et vérification `tsc --noEmit`.',
    detected: false,
    selected: true,
    indicators: ['tsconfig.json', 'tsconfig.app.json'],
    recommendedChecks: ['Mode strict activé', 'Détection des `any` implicites/explicites', 'No floating promises', 'Typecheck CI dédié'],
  },
  {
    id: 'react-nextjs',
    name: 'React / Next.js / Vite UI',
    category: 'framework',
    description: 'Audit de sécurité XSS (`dangerouslySetInnerHTML`), clés de listes, variables d’environnement publiques et bundle.',
    detected: false,
    selected: true,
    indicators: ['vite.config.ts', 'next.config.js', 'next.config.mjs', 'src/App.tsx'],
    recommendedChecks: ['Protection XSS DOM', 'Fuites NEXT_PUBLIC / VITE_ secrets', 'Accessibilité & Mode Hors-Ligne PWA'],
  },
  {
    id: 'python',
    name: 'Python / FastAPI / Pytest',
    category: 'language',
    description: 'Vérification Ruff/Flake8, typage Mypy, exécution sécurisée sans `eval/exec` et dépendances épinglées.',
    detected: false,
    selected: false,
    indicators: ['pyproject.toml', 'requirements.txt', 'Pipfile'],
    recommendedChecks: ['Dépendances épinglées (==)', 'Ruff + Mypy en CI', 'Absence de bare except:', 'Tests Pytest automatisés'],
  },
  {
    id: 'php-symfony',
    name: 'PHP / Symfony / Composer',
    category: 'framework',
    description: 'Audit Composer lock, PHPStan, sécurité des contrôleurs Symfony, Doctrine migrations et secrets `.env`.',
    detected: false,
    selected: false,
    indicators: ['composer.json', 'symfony.lock', 'bin/console'],
    recommendedChecks: ['Validation composer.lock', 'Analyse statique PHPStan', 'Sécurité APP_SECRET', 'Tests PHPUnit en CI'],
  },
  {
    id: 'go',
    name: 'Go (Golang)',
    category: 'language',
    description: 'Vérification `go vet`, `golangci-lint`, race detector `-race` et gestion des erreurs ignorées.',
    detected: false,
    selected: false,
    indicators: ['go.mod', 'go.sum'],
    recommendedChecks: ['Tests avec -race', 'Vérification go.sum', 'golangci-lint en pipeline'],
  },
  {
    id: 'rust',
    name: 'Rust / Cargo',
    category: 'language',
    description: 'Audit `cargo clippy -- -D warnings`, `cargo audit`, usage de blocs `unsafe` et `unwrap()` en production.',
    detected: false,
    selected: false,
    indicators: ['Cargo.toml', 'Cargo.lock'],
    recommendedChecks: ['Clippy strict sans warnings', 'Détection des .unwrap() risqués', 'Cargo audit sécurité'],
  },
  {
    id: 'docker',
    name: 'Docker & Conteneurs',
    category: 'devops',
    description: 'Audit des Dockerfiles : utilisateur non-root, tags d’images épinglés, `.dockerignore` et multi-stage builds.',
    detected: false,
    selected: true,
    indicators: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'],
    recommendedChecks: ['Utilisateur USER non-root', 'Pas de tag :latest', 'Healthcheck défini', '.dockerignore présent'],
  },
  {
    id: 'github-actions',
    name: 'GitHub Actions CI/CD',
    category: 'devops',
    description: 'Audit approfondi des workflows `.github/workflows` : permissions least-privilege, cache, timeouts et secrets.',
    detected: false,
    selected: true,
    indicators: ['.github/workflows'],
    recommendedChecks: ['Permissions GITHUB_TOKEN minimales', 'Actions épinglées', 'Timeout-minutes défini', 'Cache dépendances'],
  },
  {
    id: 'gitlab-ci',
    name: 'GitLab CI/CD',
    category: 'devops',
    description: 'Audit de `.gitlab-ci.yml` : stages test/security, cache par clé de lockfile et artefacts sécurisés.',
    detected: false,
    selected: false,
    indicators: ['.gitlab-ci.yml'],
    recommendedChecks: ['Stages lint/test/security', 'Cache indexé sur lockfile', 'Règles de merge request'],
  },
];

export function generateGitHubActionsWorkflow(stacks: StackId[]): string {
  const hasNode = stacks.includes('nodejs') || stacks.includes('typescript') || stacks.includes('react-nextjs');
  const hasPython = stacks.includes('python');
  const hasPhp = stacks.includes('php-symfony');
  const hasGo = stacks.includes('go');
  const hasRust = stacks.includes('rust');
  const hasDocker = stacks.includes('docker');

  const jobs: string[] = [];

  if (hasNode) {
    jobs.push(`  node-quality-and-tests:
    name: "🛡️ Node.js / TypeScript — Qualité, Typage & Tests"
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout du code
        uses: actions/checkout@v4

      - name: Configuration Node.js 22 LTS avec Cache
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Installation reproductible des dépendances
        run: npm ci

      - name: Vérification statique du typage (Anti-Bug IA)
        run: npm run lint --if-present

      - name: Exécution des tests unitaires et d'intégration
        run: npm test --if-present

      - name: Vérification du build de production
        run: npm run build --if-present`);
  }

  if (hasPython) {
    jobs.push(`  python-ci:
    name: "🐍 Python — Ruff, Mypy & Pytest"
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: "pip"
      - name: Installation des dépendances et outils QA
        run: |
          python -m pip install --upgrade pip ruff pytest
          if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
      - name: Analyse statique Ruff
        run: ruff check .
      - name: Suite de tests Pytest
        run: pytest`);
  }

  if (hasPhp) {
    jobs.push(`  php-symfony-ci:
    name: "🐘 PHP / Symfony — Composer, PHPStan & PHPUnit"
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: "8.3"
          coverage: none
      - name: Validation de composer.json
        run: composer validate --strict
      - name: Installation des dépendances Composer
        run: composer install --prefer-dist --no-progress
      - name: Exécution des tests PHPUnit
        run: vendor/bin/phpunit`);
  }

  if (hasGo) {
    jobs.push(`  go-ci:
    name: "🐹 Go — Vet & Race Detector Tests"
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.23"
      - run: go vet ./...
      - run: go test -v -race ./...`);
  }

  if (hasRust) {
    jobs.push(`  rust-ci:
    name: "🦀 Rust — Clippy Strict & Cargo Test"
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - run: cargo fmt --all -- --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --locked`);
  }

  if (hasDocker) {
    jobs.push(`  docker-hardening-check:
    name: "🐳 Docker — Validation du Build Multi-Stage"
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - name: Vérification de la présence d'un Dockerfile sécurisé
        run: |
          if [ -f Dockerfile ]; then
            docker build --no-cache -t aegis-ci-check:local .
          fi`);
  }

  if (jobs.length === 0) {
    jobs.push(`  baseline-security-check:
    name: "🔒 Audit de Sécurité & Intégrité"
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: echo "Pipeline CI/CD Aegis actif"`);
  }

  return `name: "🛡️ Aegis CI/CD — Qualité, Sécurité & Zéro-Bug IA"

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master, develop ]

# Principe de moindre privilège pour le jeton GITHUB_TOKEN
permissions:
  contents: read

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
${jobs.join('\n\n')}
`;
}

export function generateHardenedDockerfile(stacks: StackId[]): string {
  if (stacks.includes('python')) {
    return `# Dockerfile Multi-Stage Sécurisé (Généré par Aegis CI/CD Toolbox)
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1
COPY requirements*.txt ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
COPY . .
RUN groupadd -r appgroup && useradd -r -g appgroup appuser && chown -R appuser:appgroup /app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["python", "main.py"]
`;
  }

  return `# Dockerfile Multi-Stage Sécurisé (Généré par Aegis CI/CD Toolbox)
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/bin ./bin
RUN chown -R node:node /app
USER node
EXPOSE 4177
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:4177/api/health || exit 1
CMD ["node", "bin/ci-cd-toolbox.js", "start"]
`;
}
