import React, { useState } from 'react';
import { Search, Terminal, Shield, Cpu, Lock, BookOpen, ExternalLink, CheckCircle2 } from 'lucide-react';

interface RuleDocItem {
  ruleId: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  stack: string;
  engine: 'Deterministic AST' | 'Hybrid AI';
  title: string;
  remediation: string;
}

const RULE_CATALOG: RuleDocItem[] = [
  // 1. Pipelines CI/CD (CICD-001 to CICD-007)
  {
    ruleId: 'CICD-001',
    category: 'Pipelines CI/CD',
    severity: 'critical',
    stack: 'github-actions',
    engine: 'Deterministic AST',
    title: 'Missing GitHub Actions CI/CD workflow (.github/workflows/)',
    remediation: 'Generates a multi-stack hardened workflow (least-privilege permissions, cache, lint, test, build).',
  },
  {
    ruleId: 'CICD-002',
    category: 'Pipelines CI/CD',
    severity: 'high',
    stack: 'github-actions',
    engine: 'Deterministic AST',
    title: 'Unrestricted GITHUB_TOKEN permissions in workflow',
    remediation: 'Injects `permissions: contents: read` at the top of the workflow.',
  },
  {
    ruleId: 'CICD-003',
    category: 'Pipelines CI/CD',
    severity: 'medium',
    stack: 'github-actions',
    engine: 'Deterministic AST',
    title: 'Missing job execution timeout (timeout-minutes)',
    remediation: 'Adds `timeout-minutes: 15` after `runs-on` to prevent hung runner billing.',
  },
  {
    ruleId: 'CICD-004',
    category: 'Pipelines CI/CD',
    severity: 'low',
    stack: 'github-actions',
    engine: 'Deterministic AST',
    title: 'Missing concurrency group with cancel-in-progress',
    remediation: 'Injects `concurrency` block keyed on workflow and git ref.',
  },
  {
    ruleId: 'CICD-005',
    category: 'Pipelines CI/CD',
    severity: 'medium',
    stack: 'github-actions',
    engine: 'Deterministic AST',
    title: 'Deprecated (@v1/@v2/@v3) or unpinned (@master/@latest) GitHub Action',
    remediation: 'Upgrades action tag to `@v4` (Node 20 runtime).',
  },
  {
    ruleId: 'CICD-006',
    category: 'Pipelines CI/CD',
    severity: 'critical',
    stack: 'github-actions',
    engine: 'Hybrid AI',
    title: 'Untrusted ${{ github.event... }} interpolation inside `run:` shell block',
    remediation: 'Extracts untrusted event payload into an intermediate step `env:` variable.',
  },
  {
    ruleId: 'CICD-007',
    category: 'Pipelines CI/CD',
    severity: 'medium',
    stack: 'github-actions',
    engine: 'Deterministic AST',
    title: 'Non-deterministic `npm install` used in CI pipeline instead of `npm ci`',
    remediation: 'Replaces `npm install` with `npm ci` to enforce strict lockfile integrity.',
  },

  // 2. Security & Secrets (SEC-001 to SEC-008)
  {
    ruleId: 'SEC-001',
    category: 'Security & Secrets',
    severity: 'critical',
    stack: 'multi-stack',
    engine: 'Deterministic AST',
    title: 'Missing root .gitignore file',
    remediation: 'Creates hardened `.gitignore` protecting `.env*`, `node_modules/`, `__pycache__/`, `dist/`.',
  },
  {
    ruleId: 'SEC-002',
    category: 'Security & Secrets',
    severity: 'critical',
    stack: 'multi-stack',
    engine: 'Deterministic AST',
    title: '.env files not excluded in .gitignore',
    remediation: 'Appends `.env` and `.env.*` exclusion rules to `.gitignore`.',
  },
  {
    ruleId: 'SEC-003',
    category: 'Security & Secrets',
    severity: 'critical',
    stack: 'multi-stack',
    engine: 'Hybrid AI',
    title: 'Hardcoded API Key / Token / PEM Key / DB URI (8 secret families)',
    remediation: 'Replaces hardcoded credential with `process.env.SECRET_API_KEY` or `os.environ.get()`.',
  },
  {
    ruleId: 'SEC-004',
    category: 'Security & Secrets',
    severity: 'critical',
    stack: 'nodejs / python',
    engine: 'Hybrid AI',
    title: 'Arbitrary code execution via dynamic `eval()`',
    remediation: 'Replaces `eval()` with `JSON.parse()` (JS/TS) or `ast.literal_eval()` (Python).',
  },
  {
    ruleId: 'SEC-005',
    category: 'Security & Secrets',
    severity: 'high',
    stack: 'react-nextjs',
    engine: 'Deterministic AST',
    title: 'DOM XSS vector via `.innerHTML =` or `dangerouslySetInnerHTML=`',
    remediation: 'Replaces `.innerHTML =` with `.textContent =` or enforces DOMPurify sanitization.',
  },
  {
    ruleId: 'SEC-006',
    category: 'Security & Secrets',
    severity: 'high',
    stack: 'python',
    engine: 'Deterministic AST',
    title: 'Shell command injection risk via `subprocess(..., shell=True)` or `os.system()`',
    remediation: 'Switches `shell=True` to `shell=False` with argument array.',
  },
  {
    ruleId: 'SEC-007',
    category: 'Security & Secrets',
    severity: 'critical',
    stack: 'multi-stack',
    engine: 'Hybrid AI',
    title: 'SQL Injection via string concatenation / f-string interpolation',
    remediation: 'Converts raw interpolated SQL string into parameterized query (`?` or `$1`).',
  },
  {
    ruleId: 'SEC-008',
    category: 'Security & Secrets',
    severity: 'high',
    stack: 'nodejs / python',
    engine: 'Deterministic AST',
    title: 'Disabled TLS/SSL certificate verification (`verify=False` / `NODE_TLS_REJECT_UNAUTHORIZED=0`)',
    remediation: 'Restores strict TLS verification (`verify=True` / `NODE_TLS_REJECT_UNAUTHORIZED=1`).',
  },

  // 3. AI Code Quality & Robustness (AI-QUAL-001 to AI-QUAL-006 + PY-003)
  {
    ruleId: 'AI-QUAL-001',
    category: 'AI Code Quality',
    severity: 'medium',
    stack: 'typescript / nodejs',
    engine: 'Hybrid AI',
    title: 'Silent empty `catch {}` block swallowing runtime exceptions',
    remediation: 'Injects structured error logging inside the catch block.',
  },
  {
    ruleId: 'AI-QUAL-002',
    category: 'AI Code Quality',
    severity: 'low',
    stack: 'typescript',
    engine: 'Hybrid AI',
    title: 'TypeScript type-checker bypass (`: any`, `as any`, `@ts-ignore`, `@ts-nocheck`)',
    remediation: 'Replaces `: any` with `: unknown` and `@ts-ignore` with `@ts-expect-error`.',
  },
  {
    ruleId: 'AI-QUAL-003',
    category: 'AI Code Quality',
    severity: 'high',
    stack: 'multi-stack',
    engine: 'Hybrid AI',
    title: 'Unfinished AI stub (`raise NotImplementedError` / `throw new Error("Not implemented")`)',
    remediation: 'Flags incomplete AI-generated method bodies before production merge.',
  },
  {
    ruleId: 'AI-QUAL-004',
    category: 'AI Code Quality',
    severity: 'high',
    stack: 'python',
    engine: 'Deterministic AST',
    title: 'Mutable default argument in Python function (`def fn(items=[]):` or `data={}`)',
    remediation: 'Replaces mutable default with `None` to prevent cross-call state leakage.',
  },
  {
    ruleId: 'AI-QUAL-005',
    category: 'AI Code Quality',
    severity: 'medium',
    stack: 'multi-stack',
    engine: 'Deterministic AST',
    title: 'Leftover interactive debug break (`debugger;`, `breakpoint()`, `pdb.set_trace()`, `var_dump()`)',
    remediation: 'Comments out or strips interactive debugger statements.',
  },
  {
    ruleId: 'AI-QUAL-006',
    category: 'AI Code Quality',
    severity: 'medium',
    stack: 'rust',
    engine: 'Hybrid AI',
    title: 'Unchecked `.unwrap()` call in production Rust source',
    remediation: 'Replaces `.unwrap()` with descriptive `.expect()` or `?` propagation.',
  },
  {
    ruleId: 'PY-003',
    category: 'AI Code Quality',
    severity: 'medium',
    stack: 'python',
    engine: 'Deterministic AST',
    title: 'Bare `except:` clause intercepting `SystemExit` and `KeyboardInterrupt`',
    remediation: 'Replaces bare `except:` with `except Exception as exc:`.',
  },

  // 4. Containers & Infra (DOCKER-001 to DOCKER-005)
  {
    ruleId: 'DOCKER-001',
    category: 'Docker & Infra',
    severity: 'medium',
    stack: 'docker',
    engine: 'Deterministic AST',
    title: 'Missing Multi-Stage Hardened Dockerfile',
    remediation: 'Generates multi-stage `Dockerfile` with non-root user and `HEALTHCHECK`.',
  },
  {
    ruleId: 'DOCKER-002',
    category: 'Docker & Infra',
    severity: 'high',
    stack: 'docker',
    engine: 'Deterministic AST',
    title: 'Container running as `root` (missing `USER` directive)',
    remediation: 'Appends `USER node` / `USER appuser` before `CMD`.',
  },
  {
    ruleId: 'DOCKER-003',
    category: 'Docker & Infra',
    severity: 'medium',
    stack: 'docker',
    engine: 'Deterministic AST',
    title: 'Unpinned `:latest` base image tag in Dockerfile',
    remediation: 'Pins base image tag to `:lts-alpine` for deterministic builds.',
  },
  {
    ruleId: 'DOCKER-004',
    category: 'Docker & Infra',
    severity: 'low',
    stack: 'docker',
    engine: 'Deterministic AST',
    title: 'Missing `HEALTHCHECK` instruction in Dockerfile',
    remediation: 'Appends container readiness `HEALTHCHECK` probe.',
  },
  {
    ruleId: 'DOCKER-005',
    category: 'Docker & Infra',
    severity: 'medium',
    stack: 'docker',
    engine: 'Deterministic AST',
    title: 'Missing `.dockerignore` file alongside Dockerfile',
    remediation: 'Creates `.dockerignore` excluding `.git`, `node_modules`, `.env*`, and `dist`.',
  },

  // 5. Build, Dependencies & Tests (DEPS-001..004, PY-001..002, PHP-001, TEST-001..003)
  {
    ruleId: 'DEPS-001',
    category: 'Dependencies & Build',
    severity: 'low',
    stack: 'nodejs',
    engine: 'Deterministic AST',
    title: 'Unspecified Node.js runtime version (`engines.node`) in package.json',
    remediation: 'Patches `package.json` with `"engines": { "node": ">=20.0.0" }`.',
  },
  {
    ruleId: 'DEPS-002',
    category: 'Dependencies & Build',
    severity: 'high',
    stack: 'nodejs',
    engine: 'Deterministic AST',
    title: 'Missing dependency lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`)',
    remediation: 'Advises lockfile generation (`npm install --package-lock-only`).',
  },
  {
    ruleId: 'DEPS-003',
    category: 'Dependencies & Build',
    severity: 'high',
    stack: 'nodejs',
    engine: 'Deterministic AST',
    title: 'Wildcard `*` or `latest` dependency range in package.json',
    remediation: 'Pins dependency version to semantic caret range `^1.0.0`.',
  },
  {
    ruleId: 'DEPS-004',
    category: 'Dependencies & Build',
    severity: 'medium',
    stack: 'typescript',
    engine: 'Deterministic AST',
    title: 'TypeScript `"strict": true` disabled in tsconfig.json',
    remediation: 'Enables `"strict": true` inside `compilerOptions`.',
  },
  {
    ruleId: 'PY-001',
    category: 'Dependencies & Build',
    severity: 'medium',
    stack: 'python',
    engine: 'Deterministic AST',
    title: 'Missing `pyproject.toml` configuration for Ruff & Pytest',
    remediation: 'Generates standardized `pyproject.toml` with Ruff lint rules and Pytest paths.',
  },
  {
    ruleId: 'PY-002',
    category: 'Dependencies & Build',
    severity: 'medium',
    stack: 'python',
    engine: 'Hybrid AI',
    title: 'Unpinned Python packages in `requirements.txt`',
    remediation: 'Pins package versions with minimum compatible constraints.',
  },
  {
    ruleId: 'PHP-001',
    category: 'AI Code Quality',
    severity: 'medium',
    stack: 'php-symfony',
    engine: 'Deterministic AST',
    title: 'Missing PHPStan static analysis config (`phpstan.neon`)',
    remediation: 'Generates `phpstan.neon` configured at level 6.',
  },
  {
    ruleId: 'TEST-001',
    category: 'Test Robustness',
    severity: 'high',
    stack: 'nodejs',
    engine: 'Deterministic AST',
    title: 'Missing or placeholder `"test"` script in package.json',
    remediation: 'Configures `"test": "vitest run"` in `package.json`.',
  },
  {
    ruleId: 'TEST-002',
    category: 'Test Robustness',
    severity: 'high',
    stack: 'multi-stack',
    engine: 'Deterministic AST',
    title: 'Zero automated unit or integration test files found in repository',
    remediation: 'Generates initial Vitest (`tests/smoke.test.ts`) or Pytest (`tests/test_smoke.py`) suite.',
  },
  {
    ruleId: 'TEST-003',
    category: 'Test Robustness',
    severity: 'low',
    stack: 'typescript',
    engine: 'Deterministic AST',
    title: 'Skipped automated tests (`.skip` / `xit` / `xdescribe`) in test suite',
    remediation: 'Removes `.skip` to restore full regression coverage.',
  },
];

export const DocumentationPanel: React.FC = () => {
  const [ruleSearch, setRuleSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('ALL');

  const categories = [
    'ALL',
    'Pipelines CI/CD',
    'Security & Secrets',
    'AI Code Quality',
    'Docker & Infra',
    'Dependencies & Build',
    'Test Robustness',
  ];

  const filteredRules = RULE_CATALOG.filter((r) => {
    if (catFilter !== 'ALL' && r.category !== catFilter) return false;
    if (
      ruleSearch.trim() &&
      !`${r.ruleId} ${r.title} ${r.stack} ${r.remediation}`
        .toLowerCase()
        .includes(ruleSearch.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const getSeverityBadge = (sev: RuleDocItem['severity']) => {
    if (sev === 'critical') return 'text-red-400 border-red-500/30 bg-red-500/10';
    if (sev === 'high') return 'text-amber-300 border-amber-500/30 bg-amber-500/10';
    if (sev === 'medium') return 'text-zinc-200 border-zinc-700 bg-zinc-800/70';
    return 'text-zinc-400 border-zinc-800 bg-zinc-900';
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-lg bg-[#101115] border border-[#22242c] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Aegis CI/CD Toolbox — Technical Documentation & 35-Rule Reference
            </h2>
          </div>
          <p className="text-xs text-zinc-400 max-w-3xl">
            Zero-footprint external diagnostic & auto-remediation engine for multi-stack software engineering and AI-assisted development.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="px-2.5 py-1 rounded bg-[#0c0d10] border border-[#22242c] text-teal-400">
            35 Active Rules
          </span>
          <span className="px-2.5 py-1 rounded bg-[#0c0d10] border border-[#22242c] text-zinc-300">
            Apache License 2.0
          </span>
        </div>
      </div>

      {/* 4 Core Architecture Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg bg-[#101115] border border-[#22242c] p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Terminal className="w-3.5 h-3.5 text-teal-400" />
            <span>Zero-Footprint External Audit</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Audit any repository on your machine without installing packages inside the target project. Backups and rollback history are isolated inside <code className="text-zinc-200">.ci-cd-toolbox-backups/</code>.
          </p>
        </div>

        <div className="rounded-lg bg-[#101115] border border-[#22242c] p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Shield className="w-3.5 h-3.5 text-teal-400" />
            <span>Surgical 1-Click Auto-Fix & Undo</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Every finding includes a unified diff preview, confidence score, and line-preserving patch engine with instant 1-click Rollback (`Revert`).
          </p>
        </div>

        <div className="rounded-lg bg-[#101115] border border-[#22242c] p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Cpu className="w-3.5 h-3.5 text-teal-400" />
            <span>Hybrid AI & 100% Local Ollama</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Connect Google Gemini, OpenAI, Free APIs (OpenRouter/Groq), or enforce 100% Air-Gapped mode with local Ollama (<code className="text-zinc-200">localhost:11434</code>) and deterministic AST.
          </p>
        </div>

        <div className="rounded-lg bg-[#101115] border border-[#22242c] p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Lock className="w-3.5 h-3.5 text-teal-400" />
            <span>Zero-Knowledge E2EE Sync</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Synchronize studio configurations across devices with client-side Web Crypto <code className="text-zinc-200">AES-256-GCM</code> and <code className="text-zinc-200">PBKDF2-SHA256</code> (250,000 iterations).
          </p>
        </div>
      </div>

      {/* CLI & Integration Reference */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
          <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">
              CLI Commands & CI/CD Integration Guide
            </span>
            <span className="text-[11px] font-mono text-zinc-500">bin/ci-cd-toolbox.js</span>
          </div>
          <div className="p-4 space-y-3 text-xs font-mono">
            <div className="p-3 rounded bg-[#090a0c] border border-[#1d2028] space-y-1">
              <div className="text-zinc-500"># 1. Launch the interactive DevOps Studio UI + Local API Server</div>
              <div className="text-zinc-200">npm run dev</div>
            </div>
            <div className="p-3 rounded bg-[#090a0c] border border-[#1d2028] space-y-1">
              <div className="text-zinc-500"># 2. Scan any external project directory from the terminal</div>
              <div className="text-zinc-200">npm run scan -- "C:/path/to/target-project" --strict</div>
            </div>
            <div className="p-3 rounded bg-[#090a0c] border border-[#1d2028] space-y-1">
              <div className="text-zinc-500"># 3. Automatically apply all high-confidence (&gt;=90%) fixes in CLI</div>
              <div className="text-zinc-200">node bin/ci-cd-toolbox.js fix "C:/path/to/target-project"</div>
            </div>
            <div className="p-3 rounded bg-[#090a0c] border border-[#1d2028] space-y-1">
              <div className="text-zinc-500"># 4. Export a standalone offline-installable tarball (.tgz)</div>
              <div className="text-zinc-200">npm run pack:toolbox</div>
            </div>
          </div>
        </div>

        {/* Creator, Open Source License & QR Code Support Card */}
        <div className="lg:col-span-5 rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden flex flex-col justify-between">
          <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">
              Creator, License & Project Support
            </span>
            <span className="text-[11px] font-mono text-teal-400">Apache-2.0</span>
          </div>

          <div className="p-4 flex flex-col sm:flex-row items-center gap-4">
            <div className="shrink-0 p-2 rounded-lg bg-white border border-zinc-700 shadow-md">
              <img
                src="/donate-qr.png"
                alt="Support QR Code"
                className="w-28 h-28 object-contain"
              />
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  Created & Maintained By
                </div>
                <div className="text-sm font-semibold text-zinc-100">Réda Touzani</div>
                <a
                  href="https://github.com/hrmonic"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-teal-400 hover:text-teal-300 mt-0.5"
                >
                  <span>github.com/hrmonic</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Distributed under the <strong className="text-zinc-200">Apache License 2.0</strong>. Scan the QR code to support ongoing open-source development.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href="https://github.com/hrmonic/aegis-ci-cd-toolbox"
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded bg-[#161820] hover:bg-[#1f222d] border border-[#272a36] text-zinc-200 text-[11px] font-medium transition"
                >
                  GitHub Repository ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Complete 35-Rule Diagnostic Matrix */}
      <div className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
        <div className="p-4 bg-[#0c0d10] border-b border-[#22242c] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-zinc-100">
              Complete Diagnostic Rule Matrix ({filteredRules.length} / {RULE_CATALOG.length} rules)
            </h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Every rule listed below is evaluated locally during each workspace scan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
              <input
                type="text"
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
                placeholder="Filter by Rule ID, stack, keyword..."
                className="pl-8 pr-3 py-1 rounded bg-[#12141a] border border-[#24262e] text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 w-56"
              />
            </div>

            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="px-2.5 py-1 rounded bg-[#12141a] border border-[#24262e] text-xs text-zinc-200"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'ALL' ? 'All 6 Verification Layers' : cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="divide-y divide-[#1a1c23] max-h-[540px] overflow-y-auto">
          {filteredRules.map((rule) => (
            <div
              key={rule.ruleId}
              className="px-4 py-3 hover:bg-[#14161c] transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-1 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-teal-400 w-24 shrink-0">
                    {rule.ruleId}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase ${getSeverityBadge(
                      rule.severity
                    )}`}
                  >
                    {rule.severity}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#161820] border border-[#252834] font-mono text-[10px] text-zinc-300">
                    {rule.stack}
                  </span>
                  <span className="text-zinc-200 font-medium">{rule.title}</span>
                </div>
                <div className="text-[11px] text-zinc-400 sm:pl-24 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>{rule.remediation}</span>
                </div>
              </div>

              <div className="shrink-0 font-mono text-[10px] text-zinc-400 px-2 py-1 rounded bg-[#0c0d10] border border-[#1f222b] self-start sm:self-center">
                {rule.engine}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
