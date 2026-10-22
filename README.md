# 🛡️ Aegis CI/CD Toolbox — Studio DevOps & Auto-Correction IA Hybride

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](./LICENSE)
[![Stack: Multi-Stack](https://img.shields.io/badge/Stacks-Node%20%7C%20Python%20%7C%20PHP%20%7C%20Go%20%7C%20Rust%20%7C%20Docker-10b981.svg)](https://github.com/hrmonic/ci-cd-toolbox)
[![AI Engine: Hybrid + Local](https://img.shields.io/badge/AI-Gemini%20%7C%20OpenAI%20%7C%20Free%20APIs%20%7C%20Ollama%20Local-8b5cf6.svg)](https://github.com/hrmonic/ci-cd-toolbox)
[![Security: E2EE AES-256-GCM](https://img.shields.io/badge/Sync-E2EE%20AES--256--GCM-f59e0b.svg)](https://github.com/hrmonic/ci-cd-toolbox)

**Aegis CI/CD Toolbox** est un utilitaire de diagnostic CI/CD et un Studio DevOps modulaire open-source conçu pour accompagner le développement d'applications (notamment assisté par IA) afin de garantir un code **zéro bug, robuste, sécurisé et parfaitement maintenable**.

Il s'installe facilement dans n'importe quel projet existant (en CLI ou via son Studio Web sombre modulaire) et propose des **auto-corrections fiables en un clic** avec prévisualisation de diff et sauvegarde automatique.

---

## ✨ Fonctionnalités Clés

### 1. 🔍 Diagnostic CI/CD Ultra-Poussé & Choix des Stacks
- **Détection automatique & sélection des stacks au départ** :
  - **Node.js / TypeScript / React / Next.js / Vite**
  - **Python / FastAPI / Django / Pytest**
  - **PHP / Symfony / Laravel / Composer**
  - **Go / Rust / Cargo**
  - **Docker / Kubernetes / GitHub Actions / GitLab CI**
- **6 Piliers d'Audit Approfondi** :
  1. **Pipelines CI/CD** : Permissions `GITHUB_TOKEN`, actions non épinglées, absence de cache, étapes de test/lint manquantes, timeouts.
  2. **Fiabilité Code IA (Anti-Hallucination & Robustesse)** : Blocs `catch` silencieux, promesses flottantes, types `any` abusifs, `TODO/FIXME` oubliés, complexité cyclomatique, `console.log` de debug en prod.
  3. **Sécurité & Secrets (DevSecOps)** : Détection de clés API en dur (OpenAI, AWS, GitHub, JWT), fichiers `.env` non ignorés, `eval()`, conteneurs Docker exécutés en `root`.
  4. **Qualité de Suite de Tests** : Couverture des modules critiques, présence de tests unitaires/intégration, scripts `test` reproductibles.
  5. **Reproductibilité & Dépendances** : Cohérence des lockfiles, versions sauvages (`*` ou `latest`), scripts de vérification de types.
  6. **Générateur de Workflows CI/CD Clé-en-Main** : Création et injection directe de workflows GitHub Actions / GitLab CI optimisés pour votre stack.

### 2. 🤖 Moteur d'Auto-Correction IA Hybride & 100% Local
- **Moteur Déterministe Instantané (100% Hors-Ligne)** : Répare automatiquement et avec une fiabilité certifiée (>95%) les problèmes structurels (workflows CI, `.gitignore`, `Dockerfile`, `tsconfig.json`, `package.json`, nettoyage d'anti-patterns) avec **rollback en 1 clic**.
- **Connecteurs Multi-API Cloud & Gratuits** :
  - **Google Gemini** (`gemini-2.5-flash`, `gemini-2.5-pro`)
  - **OpenAI** (`gpt-4o`, `gpt-4o-mini`)
  - **APIs Gratuites** (OpenRouter Free Tier `deepseek-r1:free`, `llama-3.3-70b:free`, Groq, Mistral)
- **Mode 100% Local (Air-Gapped)** :
  - Connexion directe à **Ollama** (`http://localhost:11434`) ou **LM Studio** (`qwen2.5-coder`, `deepseek-coder`, `llama3.2`) sans qu'aucune ligne de code ne quitte votre machine.

### 3. 🖥️ Studio DevOps Sombre Moderne à Widgets Modulaires
- **Interface personnalisable** : Réorganisation des widgets modulaires, redimensionnement, masquage/affichage, choix de densité (Compact, Confort, Spacieux) et de thèmes sombres ergonomiques (*Obsidian Cyber*, *Midnight Slate*, *Emerald Matrix*, *High Contrast*).
- **Diff Viewer Interactif** : Comparez le code avant/après correction avant de l'appliquer sur vos fichiers réels.

### 4. 🔐 Synchronisation Multi-Appareils Chiffrée de Bout en Bout (E2EE)
- **Zero-Knowledge AES-256-GCM** : Vos préférences de studio, profils de stacks, historiques de diagnostics et règles personnalisées sont chiffrés localement via **Web Crypto API** (`PBKDF2` 250 000 itérations + `AES-256-GCM` avec IV aléatoire et empreinte SHA-256).
- **Synchronisation flexible** : Synchronisation via GitHub Gist chiffré, serveur relais ou export/import de bundle `.e2ee.json`.

### 5. 📡 Mode Hors-Ligne Complet & Notifications Intelligentes Adaptatives
- **Offline-First PWA** : Service Worker + persistance locale complète + file d'attente de synchronisation automatique au retour de la connexion.
- **Notifications Intelligentes Adaptatives** : Analyse en temps réel la cadence d'interaction de l'utilisateur (Mode *Deep Focus / Flow* vs *Review*) pour regrouper les alertes mineures en digest silencieux et ne notifier immédiatement que les alertes critiques de sécurité.

---

## 🚀 Installation & Utilisation Rapide

### 1. Cloner et installer localement
```bash
git clone https://github.com/hrmonic/ci-cd-toolbox.git
cd ci-cd-toolbox
npm install
```

### 2. Lancer le Studio DevOps (Interface UI + Serveur d'Analyse Local)
```bash
npm run dev
```
Ouvrez ensuite **http://localhost:5173** dans votre navigateur.

### 3. Utiliser la CLI dans n'importe quel projet local
Vous pouvez lier la toolbox globalement sur votre machine pour l'exécuter dans tous vos dépôts :
```bash
npm link

# Initialiser la toolbox dans un autre projet
cd /chemin/vers/mon-projet
ci-cd-toolbox init

# Lancer un audit CI/CD complet en CLI
ci-cd-toolbox scan .

# Appliquer automatiquement les corrections fiables (>90%)
ci-cd-toolbox fix .

# Exporter une archive portable (.tgz) installable hors-ligne
ci-cd-toolbox export-pack
```

---

## 🧱 Architecture du Projet

```text
ci-cd-toolbox/
├── bin/
│   └── ci-cd-toolbox.js         # Exécutable CLI portable (scan, fix, init, studio, export-pack)
├── server/
│   ├── index.ts                 # Serveur API Express local (analyse FS réelle, patch & rollback, Ollama proxy)
│   ├── scanner.ts               # Moteur d'audit CI/CD multi-stacks (25+ règles profondes & auto-fixers)
│   ├── pipelineTemplates.ts     # Générateur de pipelines GitHub Actions / GitLab CI / Docker par stack
│   └── cliRunner.ts             # Exécuteur CLI avec rapports colorés et sortie JSON
├── src/
│   ├── types/toolbox.ts         # Modèles de données typés (Diagnostics, Stacks, IA, E2EE, Widgets)
│   ├── services/
│   │   ├── aiEngine.ts          # Routage IA Hybride (Gemini, OpenAI, APIs Gratuites, Ollama Local, Hors-Ligne)
│   │   ├── e2eeCrypto.ts        # Chiffrement E2EE AES-256-GCM + PBKDF2 (Web Crypto API)
│   │   ├── adaptiveNotify.ts    # Moteur de notifications intelligentes adaptées au rythme utilisateur
│   │   └── offlineStore.ts      # Persistance hors-ligne & file de synchronisation
│   ├── components/              # Widgets modulaires du Studio DevOps
│   └── App.tsx                  # Studio DevOps principal personnalisable
└── tests/
    └── toolbox.test.ts          # Suite de tests unitaires & intégration (Vitest)
```

---

## 📄 Licence

Distribué sous licence **MIT**. Créé pour [hrmonic](https://github.com/hrmonic).
