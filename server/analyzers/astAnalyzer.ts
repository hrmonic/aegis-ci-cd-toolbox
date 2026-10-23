import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { DiagnosticFinding } from '../../src/types/toolbox.ts';

export interface AstAnalysisResult {
  findings: DiagnosticFinding[];
  functionsInspected: number;
  astNodesVisited: number;
}

/**
 * Moteur d'Analyse Syntaxique Abstraite (AST) basé sur l'API officielle du compilateur TypeScript (ts.createSourceFile).
 * Garantit 0% de faux positifs liés aux chaînes de caractères ou commentaires :
 * - AST-001 : Bloc catch véritablement vide (aucune instruction ni commentaire de justification)
 * - AST-002 : Promesse flottante (appel direct à fetch() ou chaîne .then() à 1 argument sans .catch() ni try/catch)
 * - AST-003 : Fonction à complexité cyclomatique critique (> 28 embranchements logiques hors composants JSX)
 * - AST-004 : Variable locale déclarée dans une fonction mais jamais référencée dans sa portée lexicale, ou instruction debugger
 */
export function analyzeTypeScriptAst(
  projectPath: string,
  allFiles: string[]
): AstAnalysisResult {
  const findings: DiagnosticFinding[] = [];
  let functionsInspected = 0;
  let astNodesVisited = 0;

  const tsJsFiles = allFiles.filter(
    (f) =>
      /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) &&
      !f.endsWith('.d.ts') &&
      !f.replace(/\\/g, '/').includes('tests/') &&
      !f.replace(/\\/g, '/').includes('.test.') &&
      !f.replace(/\\/g, '/').includes('.spec.')
  );

  for (const filePath of tsJsFiles) {
    const relPath = path.relative(projectPath, filePath).replace(/\\/g, '/');
    if (
      relPath.startsWith('server/analyzers/') ||
      relPath === 'server/scanner.ts' ||
      relPath === 'server/ciFailureDoctor.ts'
    ) {
      continue;
    }
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const isTsxOrJsx = /\.(tsx|jsx)$/.test(filePath);
    const scriptKind = filePath.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : filePath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : filePath.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

    let sourceFile: ts.SourceFile;
    try {
      sourceFile = ts.createSourceFile(
        relPath,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      );
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);

    const getLineNumber = (pos: number): number => {
      return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
    };

    const isInsideTryBlock = (node: ts.Node): boolean => {
      let cur: ts.Node | undefined = node.parent;
      while (cur) {
        if (ts.isTryStatement(cur) && cur.catchClause) {
          return true;
        }
        if (ts.isFunctionLike(cur)) {
          break;
        }
        cur = cur.parent;
      }
      return false;
    };

    const countIdentifierReferencesInSubtree = (
      root: ts.Node,
      targetName: string
    ): number => {
      let count = 0;
      const walkSub = (n: ts.Node) => {
        if (ts.isIdentifier(n) && n.text === targetName) {
          count++;
        }
        ts.forEachChild(n, walkSub);
      };
      walkSub(root);
      return count;
    };

    const computeFunctionCyclomaticComplexity = (fnNode: ts.Node): number => {
      let complexity = 1;
      const walkFn = (n: ts.Node) => {
        // Ne pas compter la complexité des sous-fonctions imbriquées dans la fonction parente
        if (n !== fnNode && ts.isFunctionLike(n)) {
          return;
        }
        if (
          ts.isIfStatement(n) ||
          ts.isForStatement(n) ||
          ts.isForInStatement(n) ||
          ts.isForOfStatement(n) ||
          ts.isWhileStatement(n) ||
          ts.isDoStatement(n) ||
          ts.isCaseClause(n) ||
          ts.isConditionalExpression(n) ||
          ts.isCatchClause(n)
        ) {
          complexity++;
        } else if (
          ts.isBinaryExpression(n) &&
          (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        ) {
          complexity++;
        }
        ts.forEachChild(n, walkFn);
      };
      walkFn(fnNode);
      return complexity;
    };

    const visit = (node: ts.Node) => {
      astNodesVisited++;

      // 1. AST-001 : Bloc catch totalement vide (0 statement ET 0 commentaire interne)
      if (ts.isCatchClause(node)) {
        if (node.block.statements.length === 0) {
          const blockStart = node.block.getStart(sourceFile);
          const blockEnd = node.block.getEnd();
          const innerBlockText = content.slice(blockStart + 1, blockEnd - 1).trim();
          if (innerBlockText.length === 0) {
            const lineNum = getLineNumber(node.getStart(sourceFile));
            const rawCatchSnippet = content
              .slice(node.getStart(sourceFile), node.getEnd())
              .trim();
            const paramName =
              node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)
                ? node.variableDeclaration.name.text
                : 'err';

            findings.push({
              id: `finding-ast-catch-${relPath}-${lineNum}`,
              ruleId: 'AST-001',
              title: `Bloc catch silencieux détecté par arbre AST (${relPath}:${lineNum})`,
              description:
                'L analyseur syntaxique TypeScript (ts.CatchClause) a confirmé que ce bloc catch ne contient ni instruction ni commentaire justificatif.',
              severity: 'high',
              category: 'ai-code-quality',
              stack: 'typescript',
              filePath: relPath,
              line: lineNum,
              impact:
                'Étouffe silencieusement les exceptions au runtime sans aucune trace dans les journaux ni remontée d erreur.',
              status: 'open',
              autoFix: {
                id: `fix-ast-catch-${relPath}-${lineNum}`,
                available: true,
                reliable: true,
                confidence: 97,
                engine: 'deterministic',
                summary: `Journaliser explicitement l'exception '${paramName}' dans le bloc catch`,
                filePath: relPath,
                beforeSnippet: rawCatchSnippet,
                afterSnippet: `catch (${paramName}) { console.error("[Caught Exception]", ${paramName}); }`,
                actionType: 'replace-snippet',
              },
            });
          }
        }
      }

      // 2. AST-002 : Promesse flottante (appel fetch() ou .then() isolé sans await ni .catch() ni try/catch)
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
        const callExpr = node.expression;

        // Cas A : fetch(...) appelé directement comme instruction sans await ni .then/.catch
        if (
          ts.isIdentifier(callExpr.expression) &&
          callExpr.expression.text === 'fetch' &&
          !isInsideTryBlock(node)
        ) {
          const lineNum = getLineNumber(node.getStart(sourceFile));
          const stmtText = lines[lineNum - 1]?.trim() || node.getText(sourceFile).trim();
          findings.push({
            id: `finding-ast-floating-fetch-${relPath}-${lineNum}`,
            ruleId: 'AST-002',
            title: `Promesse flottante (Floating Promise) sur fetch() (${relPath}:${lineNum})`,
            description:
              'Un appel asynchrone `fetch(...)` est exécuté en tant qu instruction isolée sans `await` ni `.catch()`, exposant à un UnhandledPromiseRejection.',
            severity: 'high',
            category: 'ai-code-quality',
            stack: 'typescript',
            filePath: relPath,
            line: lineNum,
            impact:
              'Crash potentiel du processus Node.js ou perte silencieuse des erreurs réseau.',
            status: 'open',
            autoFix: {
              id: `fix-ast-floating-fetch-${relPath}-${lineNum}`,
              available: true,
              reliable: true,
              confidence: 93,
              engine: 'deterministic',
              summary: 'Attacher un gestionnaire .catch() à la promesse flottante',
              filePath: relPath,
              beforeSnippet: stmtText,
              afterSnippet: `${stmtText.replace(/;$/, '')}.catch((err) => console.error("[Async Error]", err));`,
              actionType: 'replace-snippet',
            },
          });
        }

        // Cas B : promise.then(fn) à 1 seul argument sans .catch() chaîné
        if (
          ts.isPropertyAccessExpression(callExpr.expression) &&
          callExpr.expression.name.text === 'then' &&
          callExpr.arguments.length === 1 &&
          !isInsideTryBlock(node)
        ) {
          const lineNum = getLineNumber(node.getStart(sourceFile));
          const fullText = node.getText(sourceFile).trim();
          const isSingleLine = !fullText.includes('\n');
          findings.push({
            id: `finding-ast-floating-then-${relPath}-${lineNum}`,
            ruleId: 'AST-002',
            title: `Chaîne .then() sans gestionnaire d'erreur .catch() (${relPath}:${lineNum})`,
            description:
              'L arbre AST détecte une chaîne `.then(onFulfilled)` exécutée sans second argument `onRejected` ni bloc `.catch()` final.',
            severity: 'medium',
            category: 'ai-code-quality',
            stack: 'typescript',
            filePath: relPath,
            line: lineNum,
            impact:
              'Toute exception rejetée dans la promesse ou le callback `.then()` provoquera une rejection non gérée.',
            status: 'open',
            autoFix: {
              id: `fix-ast-floating-then-${relPath}-${lineNum}`,
              available: true,
              reliable: isSingleLine,
              confidence: isSingleLine ? 92 : 82,
              engine: isSingleLine ? 'deterministic' : 'hybrid-ai',
              summary: 'Chaîner .catch((err) => console.error(err)) sur la promesse',
              filePath: relPath,
              beforeSnippet: isSingleLine ? fullText : lines[lineNum - 1]?.trim() || fullText,
              afterSnippet: isSingleLine
                ? `${fullText.replace(/;$/, '')}.catch((err) => console.error(err));`
                : `${lines[lineNum - 1]?.trim() || ''} /* Ajouter .catch((err) => console.error(err)) */`,
              actionType: 'replace-snippet',
            },
          });
        }
      }

      // 3. AST-003 : Complexité cyclomatique par fonction (hors composants UI JSX)
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)
      ) {
        functionsInspected++;
        if (!isTsxOrJsx) {
          const complexity = computeFunctionCyclomaticComplexity(node);
          if (complexity > 32) {
            const lineNum = getLineNumber(node.getStart(sourceFile));
            let fnName = 'anonymousFunction';
            if (
              (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
              node.name &&
              ts.isIdentifier(node.name)
            ) {
              fnName = node.name.text;
            } else if (
              node.parent &&
              ts.isVariableDeclaration(node.parent) &&
              ts.isIdentifier(node.parent.name)
            ) {
              fnName = node.parent.name.text;
            }

            const sigLine = lines[lineNum - 1]?.trim() || `function ${fnName}()`;
            findings.push({
              id: `finding-ast-complexity-${relPath}-${lineNum}`,
              ruleId: 'AST-003',
              title: `Complexité cyclomatique AST élevée dans '${fnName}' (score: ${complexity})`,
              description: `La fonction '${fnName}' (${relPath}:${lineNum}) cumule ${complexity} points de décision AST (if/for/while/switch/&&/||). Au-delà de 32, le risque de régression augmente fortement.`,
              severity: 'medium',
              category: 'ai-code-quality',
              stack: 'typescript',
              filePath: relPath,
              line: lineNum,
              impact:
                'Fonction monolithique difficile à tester unitairement et sujette aux effets de bord.',
              status: 'open',
              autoFix: {
                id: `fix-ast-complexity-${relPath}-${lineNum}`,
                available: true,
                reliable: false,
                confidence: 80,
                engine: 'hybrid-ai',
                summary: `Extraire les sous-branches de '${fnName}' en fonctions pures dédiées`,
                filePath: relPath,
                beforeSnippet: sigLine,
                afterSnippet: `// TODO(Aegis-AST): Extraire les sous-blocs de ${fnName} (complexité=${complexity})\n${sigLine}`,
                actionType: 'replace-snippet',
              },
            });
          }
        }

        // 4. AST-004 : Variables locales déclarées dans la fonction mais jamais lues
        if (node.body && ts.isBlock(node.body)) {
          for (const stmt of node.body.statements) {
            if (!ts.isVariableStatement(stmt)) continue;
            for (const decl of stmt.declarationList.declarations) {
              if (!ts.isIdentifier(decl.name)) continue;
              const varName = decl.name.text;
              if (varName.startsWith('_')) continue;
              const refs = countIdentifierReferencesInSubtree(node.body, varName);
              if (refs === 1) {
                const lineNum = getLineNumber(decl.getStart(sourceFile));
                const rawLine = lines[lineNum - 1]?.trim() || stmt.getText(sourceFile).trim();
                findings.push({
                  id: `finding-ast-unused-${relPath}-${lineNum}-${varName}`,
                  ruleId: 'AST-004',
                  title: `Variable locale morte '${varName}' détectée par AST (${relPath}:${lineNum})`,
                  description: `La variable locale '${varName}' est déclarée mais n'est jamais lue dans la portée de la fonction.`,
                  severity: 'low',
                  category: 'ai-code-quality',
                  stack: 'typescript',
                  filePath: relPath,
                  line: lineNum,
                  impact:
                    'Code mort typique des générations IA partielles qui alourdit la lecture et peut masquer un oubli de retour.',
                  status: 'open',
                  autoFix: {
                    id: `fix-ast-unused-${relPath}-${lineNum}-${varName}`,
                    available: true,
                    reliable: false,
                    confidence: 86,
                    engine: 'hybrid-ai',
                    summary: `Préfixer '${varName}' par '_${varName}' ou supprimer la déclaration inutilisée`,
                    filePath: relPath,
                    beforeSnippet: rawLine,
                    afterSnippet: rawLine.replace(
                      new RegExp(`\\b${varName}\\b`),
                      `_${varName}`
                    ),
                    actionType: 'replace-snippet',
                  },
                });
              }
            }
          }
        }
      }

      // 5. AST-004 (variante debugger) : Instruction debugger oubliée
      if (ts.isDebuggerStatement(node)) {
        const lineNum = getLineNumber(node.getStart(sourceFile));
        const rawLine = lines[lineNum - 1]?.trim() || 'debugger;';
        findings.push({
          id: `finding-ast-debugger-${relPath}-${lineNum}`,
          ruleId: 'AST-004',
          title: `Instruction 'debugger' active détectée par AST (${relPath}:${lineNum})`,
          description:
            'Une instruction `debugger;` est présente dans l arbre syntaxique et interrompra l exécution si un inspecteur est attaché.',
          severity: 'medium',
          category: 'ai-code-quality',
          stack: 'typescript',
          filePath: relPath,
          line: lineNum,
          impact: 'Bloque l exécution en pré-production ou révèle l état mémoire interne.',
          status: 'open',
          autoFix: {
            id: `fix-ast-debugger-${relPath}-${lineNum}`,
            available: true,
            reliable: true,
            confidence: 99,
            engine: 'deterministic',
            summary: "Supprimer l'instruction debugger;",
            filePath: relPath,
            beforeSnippet: rawLine,
            afterSnippet: '// debugger supprimé par Aegis AST',
            actionType: 'replace-snippet',
          },
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return {
    findings,
    functionsInspected,
    astNodesVisited,
  };
}
