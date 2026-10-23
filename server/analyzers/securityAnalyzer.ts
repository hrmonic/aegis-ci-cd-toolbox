import fs from 'node:fs';
import path from 'node:path';
import type { DiagnosticFinding, StackId } from '../../src/types/toolbox.ts';

interface SecretPattern {
  id: string;
  label: string;
  regex: RegExp;
  envName: string;
}

const SECRET_SIGNATURES: SecretPattern[] = [
  {
    id: 'openai-key',
    label: 'Clé API OpenAI / Compatible',
    regex: /\b(sk-(?:proj-)?[a-zA-Z0-9]{20,})\b/,
    envName: 'OPENAI_API_KEY',
  },
  {
    id: 'google-gemini-key',
    label: 'Clé API Google Cloud / Gemini',
    regex: /\b(AIza[0-9A-Za-z\-_]{35})\b/,
    envName: 'GEMINI_API_KEY',
  },
  {
    id: 'github-token',
    label: 'Jeton GitHub (PAT / OAuth / App)',
    regex: /\b((?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,})\b/,
    envName: 'GITHUB_TOKEN',
  },
  {
    id: 'aws-access-key',
    label: 'Identifiant AWS Access Key',
    regex: /\b(AKIA[0-9A-Z]{16})\b/,
    envName: 'AWS_ACCESS_KEY_ID',
  },
  {
    id: 'stripe-live-key',
    label: 'Clé Secrète Stripe Live',
    regex: /\b((?:sk|rk)_live_[0-9a-zA-Z]{24,})\b/,
    envName: 'STRIPE_SECRET_KEY',
  },
  {
    id: 'slack-token',
    label: 'Jeton Slack Bot/User',
    regex: /\b(xox[baprs]-[0-9a-zA-Z-]{10,48})\b/,
    envName: 'SLACK_TOKEN',
  },
  {
    id: 'private-key-pem',
    label: 'Clé Privée Cryptographique (PEM/SSH)',
    regex: /-----BEGIN (?:RSA |OPENSSH |EC |PGP )?PRIVATE KEY-----/,
    envName: 'PRIVATE_KEY_PEM',
  },
  {
    id: 'db-connection-uri',
    label: 'URI Base de Données avec identifiants en clair',
    regex: /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^/\s:@]+@[^/\s]+)/,
    envName: 'DATABASE_URL',
  },
];

export function analyzeSecurityAndSecrets(
  resolvedPath: string,
  allFiles: string[],
  detectedStacks: StackId[]
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const primaryStack = detectedStacks[0] || 'nodejs';

  // SEC-001 & SEC-002: .gitignore audit
  const gitignorePath = path.join(resolvedPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    findings.push({
      id: 'sec-missing-gitignore',
      ruleId: 'SEC-001',
      title: 'Fichier .gitignore manquant à la racine du projet',
      description:
        'L’absence de `.gitignore` expose le dépôt au commit accidentel de fichiers `.env`, de clés privées `.pem`, de `__pycache__/` ou de `node_modules/`.',
      impact: 'Risque critique de fuite de secrets d’API et pollution du dépôt Git.',
      category: 'security-secrets',
      severity: 'critical',
      stack: primaryStack,
      filePath: '.gitignore',
      line: 1,
      status: 'open',
      autoFix: {
        id: 'fix-create-gitignore',
        available: true,
        reliable: true,
        confidence: 100,
        engine: 'deterministic',
        summary: 'Créer un fichier `.gitignore` protégeant `.env*`, `*.pem`, `*.key`, `__pycache__/` et `node_modules/`.',
        filePath: '.gitignore',
        beforeSnippet: '# Fichier .gitignore absent',
        afterSnippet:
          'node_modules/\ndist/\nbuild/\n__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.env\n.env.*\n*.pem\n*.key\n*.log\ncoverage/\n',
        actionType: 'create-file',
      },
    });
  } else {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignoreContent.includes('.env')) {
      findings.push({
        id: 'sec-gitignore-missing-env',
        ruleId: 'SEC-002',
        title: 'Les fichiers .env ne sont pas exclus dans .gitignore',
        description:
          'Le fichier `.gitignore` ne mentionne pas `.env`. Les variables d’environnement locales et clés API risquent d’être poussées sur Git.',
        impact: 'Fuite potentielle d’identifiants et de clés secrètes dans l’historique Git.',
        category: 'security-secrets',
        severity: 'critical',
        stack: primaryStack,
        filePath: '.gitignore',
        line: 1,
        status: 'open',
        autoFix: {
          id: 'fix-append-gitignore-env',
          available: true,
          reliable: true,
          confidence: 100,
          engine: 'deterministic',
          summary: 'Ajouter `.env` et `.env.*` à la fin de `.gitignore`.',
          filePath: '.gitignore',
          beforeSnippet: gitignoreContent.trim().split('\n').slice(-2).join('\n'),
          afterSnippet:
            gitignoreContent.trim().split('\n').slice(-2).join('\n') + '\n.env\n.env.*\n',
          actionType: 'append-file',
        },
      });
    }
  }

  const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.php', '.go', '.rs', '.env']);

  for (const fullFile of allFiles) {
    const ext = path.extname(fullFile).toLowerCase();
    const relFile = path.relative(resolvedPath, fullFile).replace(/\\/g, '/');

    if (!codeExtensions.has(ext) && ! path.basename(fullFile).startsWith('.env')) continue;
    // Skip analyzer self-files and test fixture runner so regex signatures aren't flagged as self-secrets
    if (
      relFile.startsWith('server/analyzers/') ||
      relFile === 'server/scanner.ts' ||
      relFile === 'tests/toolbox.test.ts' ||
      relFile === 'src/services/aiEngine.ts' ||
      relFile === 'src/components/DocumentationPanel.tsx'
    ) {
      continue;
    }

    let content = '';
    try {
      content = fs.readFileSync(fullFile, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
        continue;
      }

      // SEC-003: Multi-Signature Secret Detection
      for (const sig of SECRET_SIGNATURES) {
        const match = line.match(sig.regex);
        if (match) {
          const replacementExpr =
            ext === '.py'
              ? `os.environ.get("${sig.envName}", "")`
              : ext === '.php'
                ? `$_ENV['${sig.envName}'] ?? ''`
                : `process.env.${sig.envName} || ""`;

          findings.push({
            id: `sec-secret-${sig.id}-${relFile}-${lineNum}`,
            ruleId: 'SEC-003',
            title: `${sig.label} exposé en dur dans ${relFile}:${lineNum}`,
            description: `Un secret correspondant à la signature "${sig.label}" a été détecté en clair dans le code source.`,
            impact: 'Compromission immédiate de la ressource externe en cas de publication du dépôt.',
            category: 'security-secrets',
            severity: 'critical',
            stack: ext === '.py' ? 'python' : ext === '.php' ? 'php-symfony' : 'nodejs',
            filePath: relFile,
            line: lineNum,
            status: 'open',
            autoFix: {
              id: `fix-secret-${sig.id}-${relFile}-${lineNum}`,
              available: true,
              reliable: true,
              confidence: 96,
              engine: 'hybrid-ai',
              summary: `Remplacer le secret en dur par la variable d'environnement \`${sig.envName}\`.`,
              filePath: relFile,
              beforeSnippet: trimmed,
              afterSnippet: trimmed.replace(
                new RegExp(`(["'\`]?)${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`),
                replacementExpr
              ),
              actionType: 'replace-snippet',
            },
          });
          break;
        }
      }

      // SEC-004: Dynamic Code Execution (eval / new Function)
      if (/\beval\s*\(/.test(line)) {
        findings.push({
          id: `sec-eval-${relFile}-${lineNum}`,
          ruleId: 'SEC-004',
          title: `Exécution dynamique dangereuse eval() dans ${relFile}:${lineNum}`,
          description:
            'L’appel à `eval()` exécute une chaîne arbitraire comme du code actif, ouvrant la voie aux injections de code (RCE / XSS).',
          impact: 'Exécution de code arbitraire si l’entrée évaluée provient d’une source externe.',
          category: 'security-secrets',
          severity: 'critical',
          stack: ext === '.py' ? 'python' : 'nodejs',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-eval-${relFile}-${lineNum}`,
            available: true,
            reliable: false,
            confidence: 84,
            engine: 'hybrid-ai',
            summary:
              ext === '.py'
                ? 'Remplacer `eval()` par `ast.literal_eval()` pour analyser les structures sans exécution arbitraire.'
                : 'Remplacer `eval()` par `JSON.parse()`.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet:
              ext === '.py'
                ? trimmed.replace(/\beval\s*\(/, 'ast.literal_eval(')
                : trimmed.replace(/\beval\s*\(/, 'JSON.parse('),
            actionType: 'replace-snippet',
          },
        });
      }

      // SEC-005: DOM XSS via dangerouslySetInnerHTML={{ or .innerHTML =
      if (
        (ext === '.tsx' || ext === '.jsx' || ext === '.ts' || ext === '.js') &&
        (/\bdangerouslySetInnerHTML\s*=/.test(line) || /\.innerHTML\s*=/.test(line))
      ) {
        findings.push({
          id: `sec-xss-dom-${relFile}-${lineNum}`,
          ruleId: 'SEC-005',
          title: `Risque XSS par injection HTML directe dans ${relFile}:${lineNum}`,
          description:
            'L’assignation directe de HTML brut (`innerHTML` ou `dangerouslySetInnerHTML`) sans assainissement DOMPurify expose l’application aux attaques Cross-Site Scripting (XSS).',
          impact: 'Vol de session ou exécution de scripts malveillants dans le navigateur client.',
          category: 'security-secrets',
          severity: 'high',
          stack: 'react-nextjs',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-xss-${relFile}-${lineNum}`,
            available: line.includes('.innerHTML'),
            reliable: true,
            confidence: 92,
            engine: 'deterministic',
            summary: 'Remplacer `.innerHTML =` par `.textContent =` pour échapper automatiquement les balises HTML.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: trimmed.replace(/\.innerHTML\s*=/, '.textContent ='),
            actionType: 'replace-snippet',
          },
        });
      }

      // SEC-006: Python subprocess with shell=True or os.system()
      if (ext === '.py' && (/subprocess\.(?:Popen|run|call|check_output)\s*\([^)]*shell\s*=\s*True/.test(line) || /\bos\.system\s*\(/.test(line))) {
        findings.push({
          id: `sec-py-shell-${relFile}-${lineNum}`,
          ruleId: 'SEC-006',
          title: `Exécution shell à risque (shell=True / os.system) dans ${relFile}:${lineNum}`,
          description:
            'L’exécution d’un sous-processus Python avec `shell=True` ou `os.system()` interprète les métacaractères shell (`;`, `&&`, `|`) et expose aux injections de commandes.',
          impact: 'Exécution de commandes système arbitraires si un chemin ou argument contient des caractères spéciaux.',
          category: 'security-secrets',
          severity: 'high',
          stack: 'python',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-py-shell-${relFile}-${lineNum}`,
            available: line.includes('shell=True'),
            reliable: true,
            confidence: 93,
            engine: 'deterministic',
            summary: 'Désactiver `shell=True` (`shell=False`) en passant une liste d’arguments à `subprocess`.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: trimmed.replace(/shell\s*=\s*True/, 'shell=False'),
            actionType: 'replace-snippet',
          },
        });
      }

      // SEC-007: Potential SQL Injection via string interpolation in SQL query
      if (
        /(?:SELECT\s+.+?\s+FROM\s+|INSERT\s+INTO\s+\w+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+\w+).+?(?:\$\{[^}]+\}|"\s*\+\s*[a-zA-Z0-9_]+|\{\s*[a-zA-Z0-9_]+\s*\})/i.test(
          line
        )
      ) {
        findings.push({
          id: `sec-sqli-${relFile}-${lineNum}`,
          ruleId: 'SEC-007',
          title: `Risque d'Injection SQL par concaténation/interpolation dans ${relFile}:${lineNum}`,
          description:
            'Une variable est interpolée directement dans une requête SQL brute au lieu d’utiliser une requête préparée à paramètres liés (`?` ou `$1`).',
          impact: 'Lecture, modification ou suppression non autorisée de la base de données.',
          category: 'security-secrets',
          severity: 'critical',
          stack: ext === '.py' ? 'python' : ext === '.php' ? 'php-symfony' : 'nodejs',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-sqli-${relFile}-${lineNum}`,
            available: true,
            reliable: false,
            confidence: 85,
            engine: 'hybrid-ai',
            summary: 'Remplacer l’interpolation de chaîne par un paramètre lié (`?`).',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: trimmed.replace(/\$\{[^}]+\}/g, '?'),
            actionType: 'replace-snippet',
          },
        });
      }

      // SEC-008: Disabled TLS Verification (verify=False in Python requests or NODE_TLS_REJECT_UNAUTHORIZED = '0')
      if (
        (ext === '.py' && /requests\.(?:get|post|put|delete|request)\s*\([^)]*verify\s*=\s*False/.test(line)) ||
        /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"]/.test(line)
      ) {
        findings.push({
          id: `sec-tls-disabled-${relFile}-${lineNum}`,
          ruleId: 'SEC-008',
          title: `Vérification des certificats TLS/SSL désactivée dans ${relFile}:${lineNum}`,
          description:
            'La validation du certificat TLS est explicitement désactivée (`verify=False` ou `NODE_TLS_REJECT_UNAUTHORIZED=0`), permettant les attaques Man-in-the-Middle (MitM).',
          impact: 'Interception en clair du trafic HTTPS et des jetons d’authentification.',
          category: 'security-secrets',
          severity: 'high',
          stack: ext === '.py' ? 'python' : 'nodejs',
          filePath: relFile,
          line: lineNum,
          status: 'open',
          autoFix: {
            id: `fix-tls-${relFile}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 97,
            engine: 'deterministic',
            summary: 'Réactiver la validation stricte des certificats TLS.',
            filePath: relFile,
            beforeSnippet: trimmed,
            afterSnippet: trimmed
              .replace(/verify\s*=\s*False/, 'verify=True')
              .replace(/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"]/, 'NODE_TLS_REJECT_UNAUTHORIZED = "1"'),
            actionType: 'replace-snippet',
          },
        });
      }
    }
  }

  return findings;
}
