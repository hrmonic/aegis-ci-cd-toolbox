import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  Lock,
  Globe,
  Plus,
  RefreshCw,
  Check,
  ExternalLink,
  Search,
  Settings,
  KeyRound,
  FolderGit2,
  UploadCloud,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Sparkles,
  Link2,
} from 'lucide-react';
import type { ScanReport } from '../types/toolbox';

interface GitHubUserProfile {
  login: string;
  name: string;
  avatar_url: string;
  html_url: string;
  public_repos: number;
  total_private_repos?: number;
  authSource: 'pat' | 'gh-cli';
}

interface GitHubRepoItem {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  description: string | null;
  default_branch: string;
  updated_at: string;
  language: string | null;
  topics?: string[];
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  homepage?: string | null;
}

interface GitChangedFile {
  status: string;
  path: string;
}

interface LocalGitStatus {
  isGitRepo: boolean;
  branch: string;
  branches: string[];
  remoteUrl: string;
  parsedOwnerRepo: { owner: string; repo: string } | null;
  gitUserName: string;
  gitUserEmail: string;
  changedFiles: GitChangedFile[];
  diffStat: string;
  recentCommits: { hash: string; subject: string; date: string; author: string }[];
  aheadCount: number;
  behindCount: number;
}

interface PullRequestItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  created_at: string;
  head: { ref: string };
  base: { ref: string };
  user: { login: string };
}

interface GitHubStudioPanelProps {
  projectPath: string;
  report: ScanReport;
  onNotify: (
    title: string,
    message: string,
    severity?: 'info' | 'low' | 'medium' | 'high' | 'critical'
  ) => void;
  onScanRefresh: () => void;
}

type GitHubSubTab = 'commit-pr' | 'repositories' | 'create-repo' | 'settings';

export const GitHubStudioPanel: React.FC<GitHubStudioPanelProps> = ({
  projectPath,
  report,
  onNotify,
  onScanRefresh,
}) => {
  const [subTab, setSubTab] = useState<GitHubSubTab>('commit-pr');

  // Auth state
  const [githubToken, setGithubToken] = useState<string>(() => {
    try {
      return localStorage.getItem('aegis_github_pat_v1') || '';
    } catch {
      return '';
    }
  });
  const [showToken, setShowToken] = useState(false);
  const [authUser, setAuthUser] = useState<GitHubUserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Local Git status state
  const [gitStatus, setGitStatus] = useState<LocalGitStatus | null>(null);
  const [gitLoading, setGitLoading] = useState(false);

  // Commit & Push state
  const [commitMessage, setCommitMessage] = useState(
    'fix(ci-cd): apply Aegis automated security & quality patches'
  );
  const [commitDescription, setCommitDescription] = useState('');
  const [useNewBranch, setUseNewBranch] = useState(false);
  const [targetBranchName, setTargetBranchName] = useState('fix/aegis-remediation');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitStatusMsg, setCommitStatusMsg] = useState<string | null>(null);
  const [commitErrorMsg, setCommitErrorMsg] = useState<string | null>(null);

  // Pull Request state
  const [prTitle, setPrTitle] = useState(
    '🛡️ fix(ci-cd): Aegis Automated DevSecOps & Quality Remediation'
  );
  const [prBody, setPrBody] = useState('');
  const [prBaseBranch, setPrBaseBranch] = useState('main');
  const [prDraft, setPrDraft] = useState(false);
  const [prBusy, setPrBusy] = useState(false);
  const [createdPrUrl, setCreatedPrUrl] = useState<string | null>(null);
  const [openPulls, setOpenPulls] = useState<PullRequestItem[]>([]);

  // Repositories list state
  const [repos, setRepos] = useState<GitHubRepoItem[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [repoVisFilter, setRepoVisFilter] = useState<'all' | 'public' | 'private'>('all');

  // Create New Repo state
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState(
    'Projet audité et sécurisé avec Aegis CI/CD Toolbox'
  );
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [newRepoHomepage, setNewRepoHomepage] = useState('');
  const [newRepoTopics, setNewRepoTopics] = useState('ci-cd, devops, aegis-toolbox');
  const [newRepoAutoInit, setNewRepoAutoInit] = useState(false);
  const [newRepoLinkLocal, setNewRepoLinkLocal] = useState(true);
  const [newRepoPushInitial, setNewRepoPushInitial] = useState(true);
  const [createRepoBusy, setCreateRepoBusy] = useState(false);

  // Edit Repo & Local Git Config state
  const [editTargetRepo, setEditTargetRepo] = useState<{ owner: string; repo: string } | null>(
    null
  );
  const [editDesc, setEditDesc] = useState('');
  const [editPrivate, setEditPrivate] = useState(false);
  const [editDefaultBranch, setEditDefaultBranch] = useState('main');
  const [editHomepage, setEditHomepage] = useState('');
  const [editTopics, setEditTopics] = useState('');
  const [editIssues, setEditIssues] = useState(true);
  const [editWiki, setEditWiki] = useState(true);
  const [editProjects, setEditProjects] = useState(true);
  const [gitUserNameInput, setGitUserNameInput] = useState('');
  const [gitUserEmailInput, setGitUserEmailInput] = useState('');
  const [gitRemoteInput, setGitRemoteInput] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);

  // Auto-populate commit & PR templates from fixed findings
  useEffect(() => {
    const fixedFindings = report.findings.filter((f) => f.status === 'fixed');
    if (fixedFindings.length > 0) {
      const ruleList = fixedFindings.map((f) => `- [${f.ruleId}] ${f.title} (\`${f.filePath}\`)`);
      setCommitMessage(
        `fix(ci-cd): resolve ${fixedFindings.length} diagnostic issue(s) via Aegis Toolbox`
      );
      setCommitDescription(ruleList.join('\n'));
      setPrTitle(
        `🛡️ fix(ci-cd): Resolve ${fixedFindings.length} DevSecOps & Quality issue(s) (Health ${report.overallScore}/100)`
      );
      setPrBody(
        [
          `## 🛡️ Aegis CI/CD Automated Remediation Report`,
          `- **Project:** \`${report.projectName}\``,
          `- **Health Score:** **${report.overallScore}/100** (AI-Readiness: **${report.aiReadinessScore}/100**)`,
          `- **Patches Applied:** ${fixedFindings.length}`,
          '',
          '### 🔧 Resolved Findings',
          ...ruleList,
        ].join('\n')
      );
    } else {
      setPrBody(
        [
          `## 🛡️ Aegis CI/CD Audit Summary`,
          `- **Project:** \`${report.projectName}\``,
          `- **Overall Health Score:** **${report.overallScore}/100**`,
          `- **AI-Readiness Score:** **${report.aiReadinessScore}/100**`,
          `- **Active Stacks:** ${report.detectedStacks.join(', ')}`,
        ].join('\n')
      );
    }
  }, [report]);

  useEffect(() => {
    if (report.projectName && !newRepoName) {
      setNewRepoName(report.projectName.replace(/[^a-zA-Z0-9._-]/g, '-'));
    }
  }, [report.projectName, newRepoName]);

  const fetchLocalGitStatus = useCallback(async () => {
    setGitLoading(true);
    try {
      const res = await fetch('/api/git/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      if (res.ok) {
        const data = (await res.json()) as LocalGitStatus;
        setGitStatus(data);
        setSelectedFiles(data.changedFiles.map((f) => f.path));
        setGitUserNameInput(data.gitUserName || '');
        setGitUserEmailInput(data.gitUserEmail || '');
        setGitRemoteInput(data.remoteUrl || '');
        if (data.parsedOwnerRepo) {
          setEditTargetRepo(data.parsedOwnerRepo);
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setGitLoading(false);
    }
  }, [projectPath]);

  const fetchOpenPullRequests = useCallback(
    async (owner: string, repo: string, tokenOverride?: string) => {
      try {
        const res = await fetch('/api/github/pulls/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner,
            repo,
            token: tokenOverride !== undefined ? tokenOverride : githubToken,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setOpenPulls(data.pulls || []);
        }
      } catch {
        // Ignore
      }
    },
    [githubToken]
  );

  const fetchRepositories = useCallback(
    async (tokenOverride?: string) => {
      setReposLoading(true);
      try {
        const res = await fetch('/api/github/repos/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: tokenOverride !== undefined ? tokenOverride : githubToken,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const list = (data.repos || []) as GitHubRepoItem[];
          setRepos(list);
        }
      } catch {
        // Ignore
      } finally {
        setReposLoading(false);
      }
    },
    [githubToken]
  );

  const handleAuthenticateGitHub = useCallback(
    async (tokenToUse?: string) => {
      setAuthLoading(true);
      setAuthError(null);
      const effectiveToken = tokenToUse !== undefined ? tokenToUse : githubToken;
      try {
        const res = await fetch('/api/github/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: effectiveToken }),
        });
        const data = await res.json();
        if (res.ok && data.authenticated && data.user) {
          setAuthUser(data.user);
          if (effectiveToken) {
            localStorage.setItem('aegis_github_pat_v1', effectiveToken);
          }
          fetchRepositories(effectiveToken);
          if (gitStatus?.parsedOwnerRepo) {
            fetchOpenPullRequests(
              gitStatus.parsedOwnerRepo.owner,
              gitStatus.parsedOwnerRepo.repo,
              effectiveToken
            );
          }
        } else {
          setAuthUser(null);
          if (effectiveToken) {
            setAuthError(data.error || 'Jeton GitHub invalide.');
          }
        }
      } catch {
        setAuthError('Serveur local hors-ligne.');
      } finally {
        setAuthLoading(false);
      }
    },
    [githubToken, fetchRepositories, fetchOpenPullRequests, gitStatus?.parsedOwnerRepo]
  );

  useEffect(() => {
    fetchLocalGitStatus();
    handleAuthenticateGitHub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  useEffect(() => {
    if (authUser && gitStatus?.parsedOwnerRepo) {
      fetchOpenPullRequests(gitStatus.parsedOwnerRepo.owner, gitStatus.parsedOwnerRepo.repo);
      const matchingRepo = repos.find(
        (r) =>
          r.full_name.toLowerCase() ===
          `${gitStatus.parsedOwnerRepo!.owner}/${gitStatus.parsedOwnerRepo!.repo}`.toLowerCase()
      );
      if (matchingRepo) {
        setEditDesc(matchingRepo.description || '');
        setEditPrivate(matchingRepo.private);
        setEditDefaultBranch(matchingRepo.default_branch || 'main');
        setEditHomepage(matchingRepo.homepage || '');
        setEditTopics((matchingRepo.topics || []).join(', '));
        setEditIssues(matchingRepo.has_issues ?? true);
        setEditWiki(matchingRepo.has_wiki ?? true);
        setEditProjects(matchingRepo.has_projects ?? true);
      }
    }
  }, [authUser, gitStatus?.parsedOwnerRepo, repos, fetchOpenPullRequests]);

  const handleCommitAndPush = async (pushToOrigin: boolean, openPrAfter = false) => {
    setCommitBusy(true);
    setCommitErrorMsg(null);
    setCommitStatusMsg(null);
    setCreatedPrUrl(null);
    try {
      // If user clicked "Commit, Push & Créer la PR" while still on base branch (e.g. main == main),
      // automatically create and switch to the PR branch so GitHub PR creation succeeds.
      const currentBranch = gitStatus?.branch || 'main';
      const needsFeatureBranchForPr =
        openPrAfter && !useNewBranch && currentBranch === prBaseBranch;
      const effectiveCreateNewBranch = useNewBranch || needsFeatureBranchForPr;
      const effectiveBranchName = effectiveCreateNewBranch
        ? targetBranchName.trim() || `fix/aegis-remediation-${Date.now().toString().slice(-4)}`
        : currentBranch;

      if (needsFeatureBranchForPr) {
        setUseNewBranch(true);
        setTargetBranchName(effectiveBranchName);
      }

      const res = await fetch('/api/git/commit-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          branchName: effectiveBranchName,
          createNewBranch: effectiveCreateNewBranch,
          commitMessage,
          commitDescription,
          filesToStage: selectedFiles,
          pushToOrigin,
          githubToken,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setCommitErrorMsg(data.error || 'Échec lors du commit/push.');
        return;
      }

      setGitStatus(data.status);
      setCommitStatusMsg(data.message);
      onNotify('Git Operation Success', data.message, 'info');
      onScanRefresh();

      if (openPrAfter && data.status?.parsedOwnerRepo) {
        await handleCreatePullRequest(
          data.status.parsedOwnerRepo.owner,
          data.status.parsedOwnerRepo.repo,
          data.branch
        );
      }
    } catch (err) {
      setCommitErrorMsg(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setCommitBusy(false);
    }
  };

  const handleCreatePullRequest = async (
    overrideOwner?: string,
    overrideRepo?: string,
    overrideHead?: string
  ) => {
    const owner = overrideOwner || gitStatus?.parsedOwnerRepo?.owner;
    const repo = overrideRepo || gitStatus?.parsedOwnerRepo?.repo;
    const head = overrideHead || (useNewBranch ? targetBranchName : gitStatus?.branch || 'main');

    if (!owner || !repo) {
      setCommitErrorMsg(
        'Aucun dépôt GitHub (remote origin) détecté sur ce projet. Liez un dépôt d’abord.'
      );
      return;
    }

    setPrBusy(true);
    setCommitErrorMsg(null);
    try {
      const res = await fetch('/api/github/pulls/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: githubToken,
          owner,
          repo,
          title: prTitle,
          body: prBody,
          head,
          base: prBaseBranch,
          draft: prDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.created) {
        setCommitErrorMsg(data.error || 'Impossible de créer la Pull Request.');
        return;
      }

      setCreatedPrUrl(data.pullRequest.html_url);
      setCommitStatusMsg(`Pull Request #${data.pullRequest.number} créée avec succès !`);
      onNotify(
        `Pull Request #${data.pullRequest.number} Created`,
        `${data.pullRequest.title}`,
        'info'
      );
      fetchOpenPullRequests(owner, repo);
    } catch (err) {
      setCommitErrorMsg(err instanceof Error ? err.message : 'Erreur création PR');
    } finally {
      setPrBusy(false);
    }
  };

  const handleLinkRepoToProject = async (repo: GitHubRepoItem) => {
    setSettingsBusy(true);
    try {
      const res = await fetch('/api/git/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          initIfMissing: true,
          defaultBranch: repo.default_branch || 'main',
          remoteOriginUrl: repo.clone_url,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setGitStatus(data.status);
        setGitRemoteInput(repo.clone_url);
        setEditTargetRepo({
          owner: repo.full_name.split('/')[0],
          repo: repo.name,
        });
        onNotify(
          'Dépôt GitHub lié',
          `${repo.full_name} est désormais configuré comme remote "origin" de ${projectPath}.`,
          'info'
        );
        setSubTab('commit-pr');
      }
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleCreateNewRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateRepoBusy(true);
    setCommitErrorMsg(null);
    setCommitStatusMsg(null);
    try {
      const topicsArray = newRepoTopics
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch('/api/github/repos/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: githubToken,
          name: newRepoName,
          description: newRepoDesc,
          isPrivate: newRepoPrivate,
          homepage: newRepoHomepage,
          autoInit: newRepoAutoInit,
          topics: topicsArray,
          linkToProjectPath: newRepoLinkLocal ? projectPath : undefined,
          pushInitialCode: newRepoLinkLocal && newRepoPushInitial,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.created) {
        setCommitErrorMsg(data.error || 'Échec de la création du dépôt GitHub.');
        return;
      }

      if (data.gitStatus) {
        setGitStatus(data.gitStatus);
      }
      await fetchRepositories();
      setCommitStatusMsg(`Dépôt ${data.repo.full_name} créé avec succès !`);
      onNotify(
        'Nouveau Dépôt GitHub Créé',
        `${data.repo.full_name} (${data.repo.private ? 'Privé' : 'Public'}) est prêt.`,
        'info'
      );
      setSubTab('commit-pr');
    } catch (err) {
      setCommitErrorMsg(err instanceof Error ? err.message : 'Erreur création dépôt');
    } finally {
      setCreateRepoBusy(false);
    }
  };

  const handleSaveRepoAndGitSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsBusy(true);
    setCommitErrorMsg(null);
    setCommitStatusMsg(null);
    try {
      // 1. Save local Git config
      const localRes = await fetch('/api/git/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          initIfMissing: true,
          userName: gitUserNameInput,
          userEmail: gitUserEmailInput,
          remoteOriginUrl: gitRemoteInput,
        }),
      });
      const localData = await localRes.json();
      if (localData.status) {
        setGitStatus(localData.status);
      }

      // 2. Update GitHub repository settings if authenticated & linked
      if (authUser && editTargetRepo) {
        const topicsList = editTopics
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const ghRes = await fetch('/api/github/repos/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: githubToken,
            owner: editTargetRepo.owner,
            repo: editTargetRepo.repo,
            description: editDesc,
            isPrivate: editPrivate,
            defaultBranch: editDefaultBranch,
            homepage: editHomepage,
            hasIssues: editIssues,
            hasWiki: editWiki,
            hasProjects: editProjects,
            topics: topicsList,
          }),
        });
        const ghData = await ghRes.json();
        if (!ghRes.ok) {
          setCommitErrorMsg(ghData.error || 'Erreur lors de la mise à jour GitHub.');
          return;
        }
        await fetchRepositories();
      }

      setCommitStatusMsg('Paramètres Git & GitHub enregistrés avec succès.');
      onNotify('Paramètres sauvegardés', 'Configuration Git locale et dépôt GitHub mis à jour.', 'info');
    } catch (err) {
      setCommitErrorMsg(err instanceof Error ? err.message : 'Erreur sauvegarde paramètres');
    } finally {
      setSettingsBusy(false);
    }
  };

  const filteredRepos = repos.filter((r) => {
    if (repoVisFilter === 'public' && r.private) return false;
    if (repoVisFilter === 'private' && !r.private) return false;
    if (
      repoSearch.trim() &&
      !`${r.full_name} ${r.description || ''} ${(r.topics || []).join(' ')}`
        .toLowerCase()
        .includes(repoSearch.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const toggleFileSelection = (filePath: string) => {
    setSelectedFiles((prev) =>
      prev.includes(filePath) ? prev.filter((p) => p !== filePath) : [...prev, filePath]
    );
  };

  return (
    <div className="space-y-6 text-xs">
      {/* =====================================================================
          1. TOP GITHUB AUTHENTICATION & ACTIVE REPOSITORY BAR
      ===================================================================== */}
      <section className="rounded-lg bg-[#101115] border border-[#22242c] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {authUser ? (
            <img
              src={authUser.avatar_url}
              alt={authUser.login}
              className="w-10 h-10 rounded-full border border-teal-500/50"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#181a22] border border-[#272a34] flex items-center justify-center text-zinc-400">
              <KeyRound className="w-4 h-4" />
            </div>
          )}

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-100">
                {authUser ? `${authUser.name || authUser.login} (@${authUser.login})` : 'Connexion GitHub'}
              </span>
              {authUser ? (
                <span className="px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Connecté ({authUser.authSource === 'gh-cli' ? 'GitHub CLI' : 'Token PAT'})
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-500/40 text-amber-300 font-mono text-[10px]">
                  Non connecté
                </span>
              )}
            </div>

            <div className="text-[11px] text-zinc-400 mt-0.5 flex flex-wrap items-center gap-2">
              <span>
                Projet ciblé : <code className="text-zinc-200 font-mono">{projectPath}</code>
              </span>
              {gitStatus?.parsedOwnerRepo ? (
                <>
                  <span>·</span>
                  <a
                    href={`https://github.com/${gitStatus.parsedOwnerRepo.owner}/${gitStatus.parsedOwnerRepo.repo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-teal-400 hover:text-teal-300 font-mono flex items-center gap-1 underline"
                  >
                    {gitStatus.parsedOwnerRepo.owner}/{gitStatus.parsedOwnerRepo.repo}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              ) : (
                <>
                  <span>·</span>
                  <span className="text-amber-400">Aucun remote GitHub lié</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Token Input & Connect Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px]">
            <input
              type={showToken ? 'text' : 'password'}
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={
                authUser?.authSource === 'gh-cli'
                  ? 'Authentifié via gh CLI (ou saisir PAT)...'
                  : 'Personal Access Token (ghp_... / github_pat_...)'
              }
              className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 pr-8 text-xs text-zinc-100 font-mono focus:outline-none focus:border-teal-500"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
            >
              {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          <button
            type="button"
            disabled={authLoading}
            onClick={() => handleAuthenticateGitHub(githubToken)}
            className="px-3.5 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${authLoading ? 'animate-spin' : ''}`} />
            <span>{authUser ? 'Actualiser' : 'Connecter GitHub'}</span>
          </button>
        </div>
      </section>

      {authError && (
        <div className="p-3 rounded-md bg-red-950/30 border border-red-500/30 text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{authError}</span>
        </div>
      )}

      {/* =====================================================================
          2. SUB-NAVIGATION TABS
      ===================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e2028] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('commit-pr')}
            className={`px-3.5 py-1.5 rounded-md font-medium flex items-center gap-2 transition ${
              subTab === 'commit-pr'
                ? 'bg-[#1b1e26] text-zinc-100 border border-teal-500/50'
                : 'bg-[#101115] hover:bg-[#16181f] text-zinc-400 border border-[#22242c]'
            }`}
          >
            <GitPullRequest className="w-3.5 h-3.5 text-teal-400" />
            <span>1. Commit, Push & Pull Request ({gitStatus?.changedFiles.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('repositories')}
            className={`px-3.5 py-1.5 rounded-md font-medium flex items-center gap-2 transition ${
              subTab === 'repositories'
                ? 'bg-[#1b1e26] text-zinc-100 border border-teal-500/50'
                : 'bg-[#101115] hover:bg-[#16181f] text-zinc-400 border border-[#22242c]'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5 text-teal-400" />
            <span>2. Mes Dépôts GitHub ({repos.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('create-repo')}
            className={`px-3.5 py-1.5 rounded-md font-medium flex items-center gap-2 transition ${
              subTab === 'create-repo'
                ? 'bg-[#1b1e26] text-zinc-100 border border-teal-500/50'
                : 'bg-[#101115] hover:bg-[#16181f] text-zinc-400 border border-[#22242c]'
            }`}
          >
            <Plus className="w-3.5 h-3.5 text-teal-400" />
            <span>3. Créer un Nouveau Dépôt</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('settings')}
            className={`px-3.5 py-1.5 rounded-md font-medium flex items-center gap-2 transition ${
              subTab === 'settings'
                ? 'bg-[#1b1e26] text-zinc-100 border border-teal-500/50'
                : 'bg-[#101115] hover:bg-[#16181f] text-zinc-400 border border-[#22242c]'
            }`}
          >
            <Settings className="w-3.5 h-3.5 text-teal-400" />
            <span>4. Paramètres Dépôt & Config Git</span>
          </button>
        </div>

        <button
          type="button"
          onClick={fetchLocalGitStatus}
          className="px-3 py-1.5 rounded-md bg-[#14161c] hover:bg-[#1c1f28] border border-[#242730] text-zinc-300 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${gitLoading ? 'animate-spin' : ''}`} />
          <span>Rafraîchir Git</span>
        </button>
      </div>

      {/* Status / Error Banner */}
      {commitStatusMsg && (
        <div className="p-3 rounded-md bg-emerald-950/30 border border-emerald-500/40 text-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{commitStatusMsg}</span>
          </div>
          {createdPrUrl && (
            <a
              href={createdPrUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1 rounded bg-emerald-500 text-zinc-950 font-semibold flex items-center gap-1.5 shrink-0"
            >
              <span>Voir la Pull Request sur GitHub</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {commitErrorMsg && (
        <div className="p-3 rounded-md bg-red-950/30 border border-red-500/40 text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{commitErrorMsg}</span>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 1: COMMIT, PUSH & PULL REQUEST (POST-CORRECTIONS)
      ===================================================================== */}
      {subTab === 'commit-pr' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 5 Cols: Working Tree Changed Files & Recent Commits */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-3.5 h-3.5 text-teal-400" />
                  <span className="font-semibold text-zinc-100">
                    Fichiers Modifiés ({gitStatus?.changedFiles.length || 0})
                  </span>
                </div>
                <span className="font-mono text-[11px] text-zinc-400">
                  Branche: <strong className="text-zinc-200">{gitStatus?.branch || 'main'}</strong>
                </span>
              </div>

              {!gitStatus?.isGitRepo ? (
                <div className="p-6 text-center space-y-3">
                  <p className="text-zinc-400">
                    Ce dossier n’est pas encore initialisé avec Git (`.git` absent).
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch('/api/git/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          projectPath,
                          initIfMissing: true,
                          defaultBranch: 'main',
                        }),
                      });
                      fetchLocalGitStatus();
                    }}
                    className="px-4 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold"
                  >
                    Initialiser Git (git init -b main)
                  </button>
                </div>
              ) : gitStatus.changedFiles.length === 0 ? (
                <div className="p-6 text-center text-zinc-500 space-y-1">
                  <Check className="w-5 h-5 text-emerald-400 mx-auto" />
                  <div className="text-zinc-300 font-medium">Working tree clean</div>
                  <div>Aucune modification locale en attente de commit.</div>
                </div>
              ) : (
                <div className="divide-y divide-[#1a1c23] max-h-64 overflow-y-auto">
                  {gitStatus.changedFiles.map((file) => {
                    const isChecked = selectedFiles.includes(file.path);
                    return (
                      <label
                        key={file.path}
                        className="px-4 py-2.5 hover:bg-[#15171d] flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleFileSelection(file.path)}
                            className="rounded border-zinc-700"
                          />
                          <span
                            className={`px-1.5 py-0.2 rounded font-mono text-[10px] ${
                              file.status.includes('?') || file.status.includes('A')
                                ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/30'
                                : file.status.includes('D')
                                  ? 'bg-red-950/50 text-red-300 border border-red-500/30'
                                  : 'bg-amber-950/50 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {file.status}
                          </span>
                          <span className="font-mono text-zinc-200 truncate">{file.path}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Commits Log */}
            <div className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
              <div className="px-4 py-3 bg-[#0c0d10] border-b border-[#22242c] flex items-center justify-between">
                <span className="font-semibold text-zinc-200">Historique des Commits Récents</span>
                {gitStatus && gitStatus.aheadCount > 0 && (
                  <span className="px-2 py-0.5 rounded bg-teal-950/40 border border-teal-500/30 text-teal-300 font-mono text-[10px]">
                    {gitStatus.aheadCount} commit(s) prêt(s) à push
                  </span>
                )}
              </div>

              <div className="divide-y divide-[#1a1c23] max-h-60 overflow-y-auto">
                {!gitStatus || gitStatus.recentCommits.length === 0 ? (
                  <div className="p-5 text-center text-zinc-500">Aucun commit dans ce dépôt.</div>
                ) : (
                  gitStatus.recentCommits.map((c) => (
                    <div key={c.hash} className="px-4 py-2.5 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-teal-400 font-semibold">
                          {c.hash}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {c.author} · {c.date}
                        </span>
                      </div>
                      <div className="text-zinc-200 truncate">{c.subject}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right 7 Cols: Commit, Push & Pull Request Composer */}
          <div className="lg:col-span-7 space-y-6">
            {/* Step A: Commit & Push Box */}
            <div className="rounded-lg bg-[#101115] border border-[#22242c] p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1e2028] pb-3">
                <div className="flex items-center gap-2">
                  <GitCommit className="w-4 h-4 text-teal-400" />
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Créer un Commit & Pousser sur le Projet Ciblé
                  </h3>
                </div>
                <span className="font-mono text-[11px] text-zinc-400">
                  {selectedFiles.length} fichier(s) sélectionné(s)
                </span>
              </div>

              {/* Branch mode selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-md bg-[#0b0c0e] border border-[#1f222b]">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-200">
                  <input
                    type="radio"
                    checked={!useNewBranch}
                    onChange={() => setUseNewBranch(false)}
                  />
                  <span>
                    Sur la branche actuelle (
                    <code className="text-teal-400 font-mono">{gitStatus?.branch || 'main'}</code>)
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-zinc-200">
                  <input
                    type="radio"
                    checked={useNewBranch}
                    onChange={() => setUseNewBranch(true)}
                  />
                  <span>Créer une nouvelle branche de correctif (PR)</span>
                </label>

                {useNewBranch && (
                  <div className="sm:col-span-2 pt-1">
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Nom de la nouvelle branche :
                    </label>
                    <input
                      type="text"
                      value={targetBranchName}
                      onChange={(e) => setTargetBranchName(e.target.value)}
                      placeholder="fix/aegis-ci-cd-patches"
                      className="w-full rounded bg-[#121318] border border-[#262932] px-3 py-1.5 font-mono text-xs text-zinc-100"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Titre du Commit (Conventional Commits)
                </label>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Description détaillée du Commit (Optionnel)
                </label>
                <textarea
                  rows={3}
                  value={commitDescription}
                  onChange={(e) => setCommitDescription(e.target.value)}
                  placeholder="Détails des règles Aegis corrigées..."
                  className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] p-2.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={commitBusy}
                  onClick={() => handleCommitAndPush(false, false)}
                  className="px-3.5 py-2 rounded-md bg-[#181a22] hover:bg-[#222530] border border-[#2a2d3a] text-zinc-200 font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <GitCommit className="w-3.5 h-3.5" />
                  <span>Commit Local Seul</span>
                </button>

                <button
                  type="button"
                  disabled={commitBusy}
                  onClick={() => handleCommitAndPush(true, false)}
                  className="px-4 py-2 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{commitBusy ? 'En cours...' : 'Commit & Push sur GitHub'}</span>
                </button>

                <button
                  type="button"
                  disabled={commitBusy || prBusy}
                  onClick={() => handleCommitAndPush(true, true)}
                  className="px-4 py-2 rounded-md bg-teal-500 hover:bg-teal-400 text-zinc-950 font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Commit, Push & Créer la PR</span>
                </button>
              </div>
            </div>

            {/* Step B: Pull Request Creator */}
            <div className="rounded-lg bg-[#101115] border border-[#22242c] p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#1e2028] pb-3">
                <div className="flex items-center gap-2">
                  <GitPullRequest className="w-4 h-4 text-teal-400" />
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Créer une Pull Request (PR) sur GitHub
                  </h3>
                </div>
                {gitStatus?.parsedOwnerRepo && (
                  <span className="font-mono text-[11px] text-zinc-400">
                    {gitStatus.parsedOwnerRepo.owner}/{gitStatus.parsedOwnerRepo.repo}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Branche Source (head)
                  </label>
                  <input
                    type="text"
                    value={useNewBranch ? targetBranchName : gitStatus?.branch || 'main'}
                    onChange={(e) => {
                      setUseNewBranch(true);
                      setTargetBranchName(e.target.value);
                    }}
                    className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Branche Cible (base)
                  </label>
                  <input
                    type="text"
                    value={prBaseBranch}
                    onChange={(e) => setPrBaseBranch(e.target.value)}
                    className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Titre de la Pull Request
                </label>
                <input
                  type="text"
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Rapport Markdown de la Pull Request
                </label>
                <textarea
                  rows={5}
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] p-2.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={prDraft}
                    onChange={(e) => setPrDraft(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                  <span>Ouvrir en mode Draft (Brouillon)</span>
                </label>

                <button
                  type="button"
                  disabled={prBusy}
                  onClick={() => handleCreatePullRequest()}
                  className="px-4 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  <GitPullRequest className="w-3.5 h-3.5" />
                  <span>{prBusy ? 'Création PR...' : 'Ouvrir la Pull Request'}</span>
                </button>
              </div>

              {/* Open Pull Requests List */}
              {openPulls.length > 0 && (
                <div className="pt-3 border-t border-[#1e2028] space-y-2">
                  <div className="text-[11px] font-semibold text-zinc-300">
                    Pull Requests Ouvertes ({openPulls.length})
                  </div>
                  <div className="divide-y divide-[#1a1c23] border border-[#22242c] rounded bg-[#0b0c0e]">
                    {openPulls.map((pr) => (
                      <div
                        key={pr.id}
                        className="px-3 py-2 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-zinc-200 font-medium truncate">
                            #{pr.number} — {pr.title}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500">
                            {pr.head.ref} → {pr.base.ref} · par @{pr.user.login}
                          </div>
                        </div>
                        <a
                          href={pr.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded bg-[#181a22] hover:bg-[#222530] border border-[#282b36] text-teal-300 text-[11px] flex items-center gap-1 shrink-0"
                        >
                          <span>Ouvrir</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: LISTE DES DÉPÔTS GITHUB EXISTANTS
      ===================================================================== */}
      {subTab === 'repositories' && (
        <div className="rounded-lg bg-[#101115] border border-[#22242c] overflow-hidden">
          <div className="p-4 bg-[#0c0d10] border-b border-[#22242c] flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Rechercher parmi vos dépôts GitHub (nom, description, topic)..."
                className="w-full rounded-md bg-[#121318] border border-[#252730] pl-8 pr-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={repoVisFilter}
                onChange={(e) => setRepoVisFilter(e.target.value as 'all' | 'public' | 'private')}
                className="rounded-md bg-[#121318] border border-[#252730] px-3 py-1.5 text-xs text-zinc-200"
              >
                <option value="all">Tous ({repos.length})</option>
                <option value="public">Publics uniquement</option>
                <option value="private">Privés uniquement</option>
              </select>

              <button
                type="button"
                onClick={() => fetchRepositories()}
                className="px-3 py-1.5 rounded-md bg-[#161820] hover:bg-[#1f222d] border border-[#272a36] text-zinc-200 flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reposLoading ? 'animate-spin' : ''}`} />
                <span>Actualiser</span>
              </button>

              <button
                type="button"
                onClick={() => setSubTab('create-repo')}
                className="px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nouveau Dépôt</span>
              </button>
            </div>
          </div>

          {reposLoading ? (
            <div className="p-12 text-center text-zinc-500">
              Chargement de vos dépôts GitHub...
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              Aucun dépôt trouvé. Connectez votre compte GitHub ou créez un nouveau dépôt.
            </div>
          ) : (
            <div className="divide-y divide-[#1a1c23] max-h-[65vh] overflow-y-auto">
              {filteredRepos.map((repo) => {
                const isLinked =
                  gitStatus?.parsedOwnerRepo &&
                  `${gitStatus.parsedOwnerRepo.owner}/${gitStatus.parsedOwnerRepo.repo}`.toLowerCase() ===
                    repo.full_name.toLowerCase();

                return (
                  <div
                    key={repo.id}
                    className="p-4 hover:bg-[#14161d] transition flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {repo.private ? (
                          <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <Globe className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-zinc-100 font-mono">
                          {repo.full_name}
                        </span>
                        <span
                          className={`px-2 py-0.2 rounded text-[10px] font-mono border ${
                            repo.private
                              ? 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                              : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                          }`}
                        >
                          {repo.private ? 'Private' : 'Public'}
                        </span>
                        {repo.language && (
                          <span className="px-2 py-0.2 rounded bg-[#181a22] border border-[#262934] text-[10px] font-mono text-zinc-300">
                            {repo.language}
                          </span>
                        )}
                        {isLinked && (
                          <span className="px-2 py-0.2 rounded bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono">
                            Lié au projet actif
                          </span>
                        )}
                      </div>

                      {repo.description && (
                        <p className="text-[11px] text-zinc-400 truncate">{repo.description}</p>
                      )}

                      <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-3">
                        <span>Branche: {repo.default_branch}</span>
                        <span>·</span>
                        <span>Mis à jour: {new Date(repo.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={settingsBusy}
                        onClick={() => handleLinkRepoToProject(repo)}
                        className="px-3 py-1.5 rounded bg-[#181a22] hover:bg-[#222530] border border-[#282b36] text-zinc-200 text-[11px] font-medium flex items-center gap-1.5 transition"
                      >
                        <Link2 className="w-3.5 h-3.5 text-teal-400" />
                        <span>{isLinked ? 'Re-lier Origin' : 'Lier au projet actif'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditTargetRepo({
                            owner: repo.full_name.split('/')[0],
                            repo: repo.name,
                          });
                          setEditDesc(repo.description || '');
                          setEditPrivate(repo.private);
                          setEditDefaultBranch(repo.default_branch || 'main');
                          setEditHomepage(repo.homepage || '');
                          setEditTopics((repo.topics || []).join(', '));
                          setEditIssues(repo.has_issues ?? true);
                          setEditWiki(repo.has_wiki ?? true);
                          setEditProjects(repo.has_projects ?? true);
                          setSubTab('settings');
                        }}
                        className="px-2.5 py-1.5 rounded bg-[#15171e] hover:bg-[#1e202a] border border-[#252834] text-zinc-300 text-[11px] flex items-center gap-1"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Paramétrer</span>
                      </button>

                      <a
                        href={repo.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded bg-[#15171e] hover:bg-[#1e202a] border border-[#252834] text-zinc-400 hover:text-zinc-100"
                        title="Ouvrir sur GitHub"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 3: CRÉER UN NOUVEAU DÉPÔT GITHUB VIA L'APP
      ===================================================================== */}
      {subTab === 'create-repo' && (
        <form
          onSubmit={handleCreateNewRepository}
          className="max-w-3xl mx-auto rounded-lg bg-[#101115] border border-[#22242c] p-5 space-y-4"
        >
          <div className="border-b border-[#1e2028] pb-3">
            <h3 className="text-sm font-semibold text-zinc-100">
              Créer un Nouveau Dépôt sur GitHub
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Créez un dépôt public ou privé sur votre compte GitHub et liez-le automatiquement au dossier local actif ({projectPath}).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Nom du dépôt GitHub *
              </label>
              <input
                type="text"
                required
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                placeholder="mon-projet-devops"
                className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Visibilité</label>
              <select
                value={newRepoPrivate ? 'private' : 'public'}
                onChange={(e) => setNewRepoPrivate(e.target.value === 'private')}
                className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100"
              >
                <option value="public">🌐 Public (Visible par tous)</option>
                <option value="private">🔒 Privé (Accès restreint)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Description du projet</label>
            <input
              type="text"
              value={newRepoDesc}
              onChange={(e) => setNewRepoDesc(e.target.value)}
              placeholder="Description courte affichée sur GitHub..."
              className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Topics / Tags GitHub (séparés par virgule)
              </label>
              <input
                type="text"
                value={newRepoTopics}
                onChange={(e) => setNewRepoTopics(e.target.value)}
                placeholder="ci-cd, devops, typescript, docker"
                className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Site Web / Homepage URL (Optionnel)
              </label>
              <input
                type="text"
                value={newRepoHomepage}
                onChange={(e) => setNewRepoHomepage(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-md bg-[#0b0c0e] border border-[#1f222b] space-y-2.5">
            <div className="text-[11px] font-semibold text-zinc-200">
              Automatisation Post-Création sur {report.projectName}
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={newRepoLinkLocal}
                onChange={(e) => setNewRepoLinkLocal(e.target.checked)}
                className="rounded border-zinc-700"
              />
              <span>
                Lier automatiquement ce nouveau dépôt comme `remote origin` de{' '}
                <code className="text-zinc-200 font-mono">{projectPath}</code>
              </span>
            </label>

            {newRepoLinkLocal && (
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300 pl-5">
                <input
                  type="checkbox"
                  checked={newRepoPushInitial}
                  onChange={(e) => setNewRepoPushInitial(e.target.checked)}
                  className="rounded border-zinc-700"
                />
                <span>
                  Créer immédiatement un commit et pousser tout le projet local vers GitHub (`git push -u origin main`)
                </span>
              </label>
            )}

            {!newRepoLinkLocal && (
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={newRepoAutoInit}
                  onChange={(e) => setNewRepoAutoInit(e.target.checked)}
                  className="rounded border-zinc-700"
                />
                <span>Initialiser un README vide côté GitHub (`auto_init`)</span>
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setSubTab('repositories')}
              className="px-4 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 font-medium"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={createRepoBusy}
              className="px-5 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {createRepoBusy ? 'Création & Push en cours...' : 'Créer le Dépôt sur GitHub'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* =====================================================================
          SUB-TAB 4: PARAMÉTRER LES INFOS DU DÉPÔT & IDENTITÉ GIT
      ===================================================================== */}
      {subTab === 'settings' && (
        <form
          onSubmit={handleSaveRepoAndGitSettings}
          className="max-w-3xl mx-auto rounded-lg bg-[#101115] border border-[#22242c] p-5 space-y-5"
        >
          {/* Local Git Config */}
          <div className="space-y-3">
            <div className="border-b border-[#1e2028] pb-2">
              <h3 className="text-sm font-semibold text-zinc-100">
                Identité Git & Remote du Projet Ciblé ({report.projectName})
              </h3>
              <p className="text-[11px] text-zinc-400">
                Configure `git config user.name`, `user.email` et l’URL `remote.origin.url` du dossier {projectPath}.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Auteur Git (`user.name`)
                </label>
                <input
                  type="text"
                  value={gitUserNameInput}
                  onChange={(e) => setGitUserNameInput(e.target.value)}
                  placeholder="Réda Touzani"
                  className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Email Git (`user.email`)
                </label>
                <input
                  type="email"
                  value={gitUserEmailInput}
                  onChange={(e) => setGitUserEmailInput(e.target.value)}
                  placeholder="dev@example.com"
                  className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                URL du dépôt distant (`remote.origin.url`)
              </label>
              <input
                type="text"
                value={gitRemoteInput}
                onChange={(e) => setGitRemoteInput(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
              />
            </div>
          </div>

          {/* Remote GitHub Repository Settings */}
          {editTargetRepo && (
            <div className="space-y-3 pt-3 border-t border-[#1e2028]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Paramètres GitHub de{' '}
                    <span className="text-teal-400 font-mono">
                      {editTargetRepo.owner}/{editTargetRepo.repo}
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Modifie en direct les métadonnées, la visibilité et les fonctionnalités du dépôt sur GitHub.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Visibilité</label>
                  <select
                    value={editPrivate ? 'private' : 'public'}
                    onChange={(e) => setEditPrivate(e.target.value === 'private')}
                    className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100"
                  >
                    <option value="public">🌐 Public</option>
                    <option value="private">🔒 Privé</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Branche par défaut
                  </label>
                  <input
                    type="text"
                    value={editDefaultBranch}
                    onChange={(e) => setEditDefaultBranch(e.target.value)}
                    className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Description GitHub</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Topics / Tags (séparés par virgule)
                  </label>
                  <input
                    type="text"
                    value={editTopics}
                    onChange={(e) => setEditTopics(e.target.value)}
                    className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Homepage URL</label>
                  <input
                    type="text"
                    value={editHomepage}
                    onChange={(e) => setEditHomepage(e.target.value)}
                    className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editIssues}
                    onChange={(e) => setEditIssues(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                  <span>Activer Issues</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editProjects}
                    onChange={(e) => setEditProjects(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                  <span>Activer Projects</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editWiki}
                    onChange={(e) => setEditWiki(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                  <span>Activer Wiki</span>
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={settingsBusy}
              className="px-5 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{settingsBusy ? 'Enregistrement...' : 'Enregistrer les Paramètres'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
