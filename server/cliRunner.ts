import { scanProject, applyAutoFixOnDisk } from './scanner.ts';

const args = process.argv.slice(2);
const mode = args[0] || 'scan';
const targetPath = args[1] || process.cwd();
const isJson = args.includes('--json');
const isStrict = args.includes('--strict');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const report = scanProject(targetPath);

if (isJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(isStrict && report.overallScore < 80 ? 1 : 0);
}

console.log(`${C.bold}📂 Projet analysé :${C.reset} ${report.projectName} (${report.projectPath})`);
console.log(`${C.bold}🧩 Stacks détectées :${C.reset} ${report.detectedStacks.join(', ')}`);
console.log(`${C.bold}📊 Score Santé CI/CD :${C.reset} ${report.overallScore}/100 | ${C.bold}Score Zéro-Bug IA :${C.reset} ${report.aiReadinessScore}/100`);
console.log(`${C.bold}🔎 Fichiers inspectés :${C.reset} ${report.filesScanned} en ${report.durationMs}ms\n`);

if (report.findings.length === 0) {
  console.log(`${C.green}${C.bold}✔ Aucun problème détecté ! Le projet est 100% conforme CI/CD.${C.reset}`);
  process.exit(0);
}

console.log(`${C.bold}Diagnostics détectés (${report.findings.length}) :${C.reset}`);
for (const f of report.findings) {
  const badge =
    f.severity === 'critical'
      ? `${C.red}[CRITIQUE]${C.reset}`
      : f.severity === 'high'
        ? `${C.yellow}[ÉLEVÉ]${C.reset}`
        : `${C.cyan}[MOYEN]${C.reset}`;
  console.log(`  ${badge} ${C.bold}${f.ruleId}${C.reset} — ${f.title}`);
  console.log(`      ${C.gray}Fichier: ${f.filePath}${f.line ? `:${f.line}` : ''} | Auto-Fix: ${f.autoFix.confidence}% (${f.autoFix.engine})${C.reset}`);
}

if (mode === 'fix') {
  console.log(`\n${C.cyan}${C.bold}🔧 Application des auto-corrections fiables (>= 90% de confiance)...${C.reset}`);
  for (const f of report.findings) {
    if (f.autoFix.available && f.autoFix.reliable && f.autoFix.confidence >= 90) {
      const res = applyAutoFixOnDisk(targetPath, f.autoFix);
      if (res.success) {
        console.log(`  ${C.green}✔ [${f.ruleId}] ${res.message}${C.reset}`);
      } else {
        console.log(`  ${C.red}✖ [${f.ruleId}] ${res.message}${C.reset}`);
      }
    }
  }
}

if (isStrict && report.overallScore < 80) {
  process.exit(1);
}
