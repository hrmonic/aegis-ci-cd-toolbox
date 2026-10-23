import fs from 'node:fs';
import path from 'node:path';
import type {
  DiagnosticFinding,
  CodebaseMetrics,
  LanguageStat,
  FileHotspot,
} from '../../src/types/toolbox.ts';

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.py': 'Python',
  '.php': 'PHP',
  '.go': 'Go',
  '.rs': 'Rust',
  '.css': 'CSS',
  '.html': 'HTML',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.json': 'JSON',
};

export function analyzeAiCodeQualityAndMetrics(
  resolvedPath: string,
  allFiles: string[]
): {
  findings: DiagnosticFinding[];
  metrics: CodebaseMetrics;
} {
  const findings: DiagnosticFinding[] = [];
  const langMap = new Map<string, LanguageStat>();
  const hotspots: FileHotspot[] = [];

  let totalLinesOfCode = 0;
  let totalCodeFiles = 0;
  let testFilesCount = 0;

  const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.php', '.go', '.rs']);

  for (const fullFile of allFiles) {
    const ext = path.extname(fullFile).toLowerCase();
    const relFile = path.relative(resolvedPath, fullFile).replace(/\\/g, '/');

    const isTestFile =
      relFile.includes('.test.') ||
      relFile.includes('.spec.') ||
      relFile.startsWith('tests/') ||
      relFile.startsWith('test_') ||
      relFile.endsWith('_test.py') ||
      relFile.startsWith('__tests__/');

    if (isTestFile) {
      testFilesCount++;
    }

    let content = '';
    try {
      content = fs.readFileSync(fullFile, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const lineCount = lines.length;

    if (EXT_TO_LANG[ext]) {
      totalLinesOfCode += lineCount;
      totalCodeFiles++;
      const langName = EXT_TO_LANG[ext];
      const existing = langMap.get(langName) || {
        language: langName,
        extension: ext,
        files: 0,
        lines: 0,
      };
      existing.files += 1;
      existing.lines += lineCount;
      langMap.set(langName, existing);
    }

    if (!codeExtensions.has(ext)) continue;
    if (
      relFile.startsWith('server/analyzers/') ||
      relFile === 'server/scanner.ts' ||
      relFile === 'tests/toolbox.test.ts' ||
      relFile === 'src/services/aiEngine.ts' ||
      relFile === 'src/components/DocumentationPanel.tsx'
    ) {
      continue;
    }

    let fileComplexity = 1;
    let fileIssues = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      // Count branching keywords for cyclomatic complexity estimation
      const branches = line.match(/\b(if|else\s+if|elif|for|while|case|catch|except)\b|&&|\|\|/g);
      if (branches) {
        fileComplexity += branches.length;
      }

      // 1. AI-QUAL-001: Empty catch block (TS/JS/PHP)
      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
        fileIssues++;
        findings.push({
          id: `ai-empty-catch-${relFile}-${lineNum}`,
          ruleId: 'AI-QUAL-001',
          title: `Bloc catch vide silencieux (Anti-Pattern IA) dans ${relFile}:${lineNum}`,
          description:
            'Un bloc `catch {}` vide masque les exceptions au runtime et laisse l’application dans un état incohérent sans trace.',
          impact: 'Pannes silencieuses très difficiles à diagnostiquer en production.',
          category: 'ai-code-quality',
          severity: 'medium',
          stack: 'typescript',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-empty-catch-${relFile}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 94,
            engine: 'hybrid-ai',
            summary: 'Journaliser explicitement l’erreur capturée dans le bloc catch.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: trimmed.replace(
              /catch\s*(\([^)]*\))?\s*\{\s*\}/,
              'catch (err) { console.error("[Caught Error]:", err); }'
            ),
            actionType: 'replace-snippet',
          },
        });
      }

      // 2. PY-003: Python bare `except:`
      if (ext === '.py' && /^\s*except\s*:\s*(#.*)?$/.test(line)) {
        fileIssues++;
        findings.push({
          id: `py-bare-except-${relFile}-${lineNum}`,
          ruleId: 'PY-003',
          title: `Clause "except:" nue (sans type d'exception) dans ${relFile}:${lineNum}`,
          description:
            'En Python, `except:` nu intercepte aussi `SystemExit` et `KeyboardInterrupt` et masque les erreurs de programmation (`NameError`, `TypeError`).',
          impact: 'Masquage des bugs critiques et blocage de l’interruption propre du processus.',
          category: 'ai-code-quality',
          severity: 'medium',
          stack: 'python',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-py-except-${relFile}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 97,
            engine: 'deterministic',
            summary: 'Remplacer `except:` par `except Exception as exc:`.',
            filePath: relFile,
            beforeSnippet: line,
            afterSnippet: line.replace(/except\s*:/, 'except Exception as exc:'),
            actionType: 'replace-snippet',
          },
        });
      }

      // 3. AI-QUAL-002: TypeScript `: any` or `@ts-ignore` / `@ts-nocheck`
      if ((ext === '.ts' || ext === '.tsx') && !isTestFile) {
        if (/\/\/\s*@ts-(?:ignore|nocheck)\b/.test(line)) {
          fileIssues++;
          findings.push({
            id: `ai-ts-ignore-${relFile}-${lineNum}`,
            ruleId: 'AI-QUAL-002',
            title: `Désactivation du compilateur TypeScript (@ts-ignore / @ts-nocheck) dans ${relFile}:${lineNum}`,
            description:
              'La directive `@ts-ignore` ou `@ts-nocheck` masque toutes les erreurs de typage sur la ligne ou le fichier.',
            impact: 'Risque élevé de crash `TypeError: Cannot read properties of undefined` au runtime.',
            category: 'ai-code-quality',
            severity: 'medium',
            stack: 'typescript',
            filePath: relFile,
            line: lineNum,
            status: 'open',
            autoFix: {
              id: `fix-ts-ignore-${relFile}-${lineNum}`,
              available: true,
              reliable: true,
              confidence: 91,
              engine: 'deterministic',
              summary: 'Remplacer `@ts-ignore` par `@ts-expect-error` afin que le compilateur signale dès que l’erreur sous-jacente est résolue.',
              filePath: relFile,
              beforeSnippet: trimmed,
              afterSnippet: trimmed.replace(/@ts-(?:ignore|nocheck)/, '@ts-expect-error'),
              actionType: 'replace-snippet',
            },
          });
        } else if (/:\s*any\b/.test(line) && !trimmed.startsWith('//')) {
          fileIssues++;
          findings.push({
            id: `ai-explicit-any-${relFile}-${lineNum}`,
            ruleId: 'AI-QUAL-002',
            title: `Typage "any" explicite désactivant la sûreté TypeScript dans ${relFile}:${lineNum}`,
            description:
              'L’annotation `: any` désactive toute vérification de type sur cette variable ou ce paramètre.',
            impact: 'Perte de la garantie Zéro-Bug à la compilation.',
            category: 'ai-code-quality',
            severity: 'low',
            stack: 'typescript',
            filePath: relFile,
            line: lineNum,
            status: 'open',
            autoFix: {
              id: `fix-explicit-any-${relFile}-${lineNum}`,
              available: true,
              reliable: true,
              confidence: 92,
              engine: 'deterministic',
              summary: 'Remplacer `: any` par le type sécurisé `: unknown`.',
              filePath: relFile,
              beforeSnippet: trimmed,
              afterSnippet: trimmed.replace(/:\s*any\b/, ': unknown'),
              actionType: 'replace-snippet',
            },
          });
        }
      }

      // 4. AI-QUAL-003: Unfinished AI Stubs (NotImplementedError / throw new Error("Not implemented"))
      if (
        !isTestFile &&
        (/throw\s+new\s+Error\s*\(\s*["']Not implemented/i.test(line) ||
          /\braise\s+NotImplementedError\b/.test(line))
      ) {
        fileIssues++;
        findings.push({
          id: `ai-unfinished-stub-${relFile}-${lineNum}`,
          ruleId: 'AI-QUAL-003',
          title: `Fonction non implémentée (Stub IA inachevé) dans ${relFile}:${lineNum}`,
          description:
            'Une exception `NotImplementedError` / `Error("Not implemented")` a été laissée dans le code de production.',
          impact: 'Crash immédiat dès que cette branche fonctionnelle est appelée.',
          category: 'ai-code-quality',
          severity: 'high',
          stack: ext === '.py' ? 'python' : 'typescript',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-stub-${relFile}-${lineNum}`,
            available: false,
            reliable: false,
            confidence: 78,
            engine: 'hybrid-ai',
            summary: 'Compléter l’implémentation métier de la fonction.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: '// Implémentation requise',
            actionType: 'replace-snippet',
          },
        });
      }

      // 5. AI-QUAL-004: Python mutable default arguments `def fn(a=[]):` or `def fn(a={}):`
      if (ext === '.py' && /^\s*def\s+[a-zA-Z0-9_]+\s*\([^)]*=\s*(?:\[\]|\{\})/.test(line)) {
        fileIssues++;
        findings.push({
          id: `py-mutable-default-${relFile}-${lineNum}`,
          ruleId: 'AI-QUAL-004',
          title: `Argument par défaut mutable ([] ou {}) en Python dans ${relFile}:${lineNum}`,
          description:
            'En Python, les valeurs par défaut `=[]` ou `={}` sont évaluées une seule fois à la définition de la fonction et partagées entre tous les appels successifs.',
          impact: 'Fuite d’état et corruption de données entre deux appels de fonction.',
          category: 'ai-code-quality',
          severity: 'high',
          stack: 'python',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-py-mutable-${relFile}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 95,
            engine: 'deterministic',
            summary: 'Remplacer la valeur par défaut mutable par `None`.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: trimmed.replace(/=\s*(?:\[\]|\{\})/g, '=None'),
            actionType: 'replace-snippet',
          },
        });
      }

      // 6. AI-QUAL-005: Leftover debugger / breakpoint statements in code
      if (
        !isTestFile &&
        (/^\s*debugger\s*;?\s*$/.test(line) ||
          (ext === '.py' && /\b(?:breakpoint|pdb\.set_trace)\s*\(\s*\)/.test(line)) ||
          (ext === '.php' && /\b(?:var_dump|dd)\s*\(/.test(line)))
      ) {
        fileIssues++;
        findings.push({
          id: `ai-leftover-debugger-${relFile}-${lineNum}`,
          ruleId: 'AI-QUAL-005',
          title: `Instruction d'arrêt de débogage oubliée dans ${relFile}:${lineNum}`,
          description:
            'Une instruction `debugger`, `breakpoint()`, `pdb.set_trace()` ou `dd()` est présente dans le code et bloquera l’exécution en production ou en CI.',
          impact: 'Gel du processus ou fuite de structures mémoire en production.',
          category: 'ai-code-quality',
          severity: 'high',
          stack: ext === '.py' ? 'python' : ext === '.php' ? 'php-symfony' : 'typescript',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-debugger-${relFile}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 99,
            engine: 'deterministic',
            summary: 'Supprimer l’instruction de débogage.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: '',
            actionType: 'replace-snippet',
          },
        });
      }

      // 7. AI-QUAL-006: Rust `.unwrap()` in production code
      if (ext === '.rs' && !isTestFile && /\.unwrap\s*\(\s*\)/.test(line) && !trimmed.startsWith('//')) {
        fileIssues++;
        findings.push({
          id: `rust-unwrap-${relFile}-${lineNum}`,
          ruleId: 'AI-QUAL-006',
          title: `Appel ".unwrap()" susceptible de paniquer en production (${relFile}:${lineNum})`,
          description:
            'En Rust, `.unwrap()` provoque un crash immédiat du thread (`panic!`) si la valeur est `None` ou `Err`.',
          impact: 'Arrêt brutal du service Rust en cas d’entrée inattendue.',
          category: 'ai-code-quality',
          severity: 'medium',
          stack: 'rust',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-rust-unwrap-${relFile}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 90,
            engine: 'hybrid-ai',
            summary: 'Remplacer `.unwrap()` par `.expect("Valeur requise")` ou l’opérateur `?`.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: trimmed.replace(/\.unwrap\s*\(\s*\)/, '.expect("Unexpected None/Err")'),
            actionType: 'replace-snippet',
          },
        });
      }
    }

    hotspots.push({
      filePath: relFile,
      lines: lineCount,
      complexity: fileComplexity,
      issues: fileIssues,
    });
  }

  // Sort hotspots by complexity descending
  hotspots.sort((a, b) => b.complexity - a.complexity || b.lines - a.lines);

  const languages = Array.from(langMap.values()).sort((a, b) => b.lines - a.lines);

  return {
    findings,
    metrics: {
      totalLinesOfCode,
      totalCodeFiles,
      testFilesCount,
      rulesEvaluated: 35,
      languages,
      hotspots: hotspots.slice(0, 8),
    },
  };
}
