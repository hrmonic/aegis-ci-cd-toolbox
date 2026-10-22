#!/usr/bin/env node
/**
 * Aegis CI/CD Toolbox — CLI & Portable Project Injector
 * Permet d'exécuter un scan CI/CD en ligne de commande, d'auto-corriger un projet,
 * d'injecter la toolbox dans n'importe quel dépôt, ou de lancer le Studio DevOps Web.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const command = args[0] || 'help';
const targetArg = args.find((a) => !a.startsWith('-') && a !== command) || process.cwd();
const targetPath = path.resolve(targetArg);

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

function printBanner() {
  console.log(`\n${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║   🛡️  AEGIS CI/CD TOOLBOX — STUDIO DEVOPS & AUTO-CORRECTION IA       ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════╝${C.reset}\n`);
}

async function runCli() {
  printBanner();

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`${C.bold}Usage:${C.reset} npx ci-cd-toolbox <command> [project-path] [options]\n`);
    console.log(`${C.bold}Commandes disponibles :${C.reset}`);
    console.log(`  ${C.cyan}studio / start${C.reset}              Lance le Studio DevOps UI et le serveur d'analyse local`);
    console.log(`  ${C.cyan}scan [path]${C.reset}                 Analyse un projet (Pipelines, Sécurité, Qualité IA, Tests, Docker)`);
    console.log(`  ${C.cyan}fix [path]${C.reset}                  Applique les auto-corrections déterministes fiables (>90%)`);
    console.log(`  ${C.cyan}init [path]${C.reset}                 Installe/injecte la configuration CI/CD Toolbox dans un projet cible`);
    console.log(`  ${C.cyan}export-pack${C.reset}                 Génère une archive portable (.tgz) installable hors-ligne\n`);
    console.log(`${C.bold}Options :${C.reset}`);
    console.log(`  ${C.yellow}--json${C.reset}                      Sortie au format JSON pour intégration GitHub Actions / GitLab CI`);
    console.log(`  ${C.yellow}--strict${C.reset}                    Échoue avec code 1 si le score de santé est < 80/100`);
    console.log(`  ${C.yellow}--offline${C.reset}                   Force le mode 100% hors-ligne (moteur heuristique + Ollama local)\n`);
    return;
  }

  if (command === 'studio' || command === 'start') {
    console.log(`${C.green}▶ Démarrage d'Aegis CI/CD Studio sur le projet : ${C.bold}${targetPath}${C.reset}`);
    const child = spawn('npx', ['tsx', path.join(ROOT_DIR, 'server/index.ts'), '--target', targetPath], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  if (command === 'scan' || command === 'fix') {
    const child = spawn(
      'npx',
      ['tsx', path.join(ROOT_DIR, 'server/cliRunner.ts'), command, targetPath, ...args.slice(1)],
      {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        shell: true,
      }
    );
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  if (command === 'init') {
    const configPath = path.join(targetPath, '.cicd-toolbox.json');
    const defaultConfig = {
      $schema: 'https://github.com/hrmonic/ci-cd-toolbox/schema.json',
      projectName: path.basename(targetPath),
      createdAt: new Date().toISOString(),
      autoDetectStacks: true,
      stacks: ['nodejs', 'typescript', 'docker', 'github-actions'],
      aiStrategy: {
        mode: 'hybrid',
        preferredProvider: 'gemini',
        fallbackOrder: ['gemini', 'openai', 'free-openrouter', 'ollama-local', 'deterministic-offline'],
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: 'qwen2.5-coder:7b',
        minConfidenceForAutoFix: 85,
      },
      security: {
        e2eeSyncEnabled: true,
        secretScanning: true,
        offlineModeDefault: false,
      },
      thresholds: {
        minHealthScore: 85,
        failOnCritical: true,
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    console.log(`${C.green}✔ Configuration initialisée avec succès dans : ${C.bold}${configPath}${C.reset}`);
    console.log(`${C.gray}Astuce : Lancez 'npx ci-cd-toolbox scan "${targetPath}"' pour auditer ce projet.${C.reset}`);
    return;
  }

  if (command === 'export-pack') {
    console.log(`${C.cyan}📦 Construction du package portable installable localement...${C.reset}`);
    const child = spawn('npm', ['run', 'pack:toolbox'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  console.log(`${C.red}Commande inconnue : ${command}${C.reset}. Utilisez 'npx ci-cd-toolbox help'.`);
  process.exit(1);
}

runCli();
