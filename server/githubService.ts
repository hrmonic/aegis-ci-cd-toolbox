import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface GitHubUserProfile {
  login: string;
  name: string;
  avatar_url: string;
  html_url: string;
  public_repos: number;
  total_private_repos?: number;
  authSource: 'pat' | 'gh-cli';
}

export interface GitHubRepoItem {
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

export interface GitChangedFile {
  status: string; // M, A, D, ??
  path: string;
}

export interface LocalGitStatus {
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

/**
 * Try to retrieve an existing GitHub token from `gh auth token` if the user hasn't supplied one manually.
 */
export function resolveGitHubToken(providedToken?: string): {
  token: string | null;
  source: 'pat' | 'gh-cli' | null;
} {
  if (providedToken && providedToken.trim().length > 0) {
    return { token: providedToken.trim(), source: 'pat' };
  }
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim().length > 0) {
    return { token: process.env.GITHUB_TOKEN.trim(), source: 'pat' };
  }
  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    })
      .toString()
      .trim();
    if (out && out.length > 10) {
      return { token: out, source: 'gh-cli' };
    }
  } catch {
    // gh CLI not installed or not logged in
  }
  return { token: null, source: null };
}

export function parseGitHubOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  if (!remoteUrl) return null;
  const cleaned = remoteUrl.trim().replace(/\.git$/, '');
  // Match https://github.com/owner/repo or git@github.com:owner/repo
  const httpsMatch = cleaned.match(/github\.com\/([^/]+)\/([^/]+)$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = cleaned.match(/github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

function runGitSafe(cwd: string, args: string[], preserveLeadingSpace = false): string {
  try {
    const out = execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    }).toString();
    return preserveLeadingSpace ? out.trimEnd() : out.trim();
  } catch {
    return '';
  }
}

export function inspectLocalGitStatus(projectPath: string): LocalGitStatus {
  const resolved = path.resolve(projectPath);
  const gitDir = path.join(resolved, '.git');
  const isGitRepo =
    fs.existsSync(gitDir) || runGitSafe(resolved, ['rev-parse', '--is-inside-work-tree']) === 'true';

  if (!isGitRepo) {
    return {
      isGitRepo: false,
      branch: 'main',
      branches: [],
      remoteUrl: '',
      parsedOwnerRepo: null,
      gitUserName: runGitSafe(resolved, ['config', 'user.name']),
      gitUserEmail: runGitSafe(resolved, ['config', 'user.email']),
      changedFiles: [],
      diffStat: '',
      recentCommits: [],
      aheadCount: 0,
      behindCount: 0,
    };
  }

  const branch = runGitSafe(resolved, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const rawBranches = runGitSafe(resolved, ['branch', '--format=%(refname:short)']);
  const branches = rawBranches
    ? rawBranches
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean)
    : [branch];

  const remoteUrl = runGitSafe(resolved, ['remote', 'get-url', 'origin']);
  const parsedOwnerRepo = parseGitHubOwnerRepo(remoteUrl);
  const gitUserName = runGitSafe(resolved, ['config', 'user.name']);
  const gitUserEmail = runGitSafe(resolved, ['config', 'user.email']);

  const porcelain = runGitSafe(resolved, ['status', '--porcelain'], true);
  const changedFiles: GitChangedFile[] = porcelain
    ? porcelain
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((line) => {
          const match = line.match(/^\s*([MADRCU?!]{1,2})\s+(.+)$/);
          if (match) {
            const status = match[1].trim() || 'M';
            let filePath = match[2].trim();
            if (filePath.includes(' -> ')) {
              filePath = filePath.split(' -> ').pop()!.trim();
            }
            filePath = filePath.replace(/^"+|"+$/g, '');
            if (
              !fs.existsSync(path.join(resolved, filePath)) &&
              fs.existsSync(path.join(resolved, '.' + filePath))
            ) {
              filePath = '.' + filePath;
            }
            return { status, path: filePath };
          }
          const status = line.slice(0, 2).trim() || 'M';
          const filePath = line.slice(3).trim();
          return { status, path: filePath };
        })
    : [];

  const diffStat = runGitSafe(resolved, ['diff', '--stat']);

  const rawLog = runGitSafe(resolved, [
    'log',
    '-n',
    '8',
    '--pretty=format:%h|%s|%cr|%an',
  ]);
  const recentCommits = rawLog
    ? rawLog
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, subject, date, author] = line.split('|');
          return {
            hash: hash || '',
            subject: subject || '',
            date: date || '',
            author: author || '',
          };
        })
    : [];

  let aheadCount = 0;
  let behindCount = 0;
  const revList = runGitSafe(resolved, ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`]);
  if (revList) {
    const parts = revList.split(/\s+/);
    if (parts.length === 2) {
      behindCount = Number(parts[0]) || 0;
      aheadCount = Number(parts[1]) || 0;
    }
  }

  return {
    isGitRepo: true,
    branch,
    branches,
    remoteUrl: remoteUrl.replace(/https:\/\/[^@]+@github\.com/i, 'https://github.com'),
    parsedOwnerRepo,
    gitUserName,
    gitUserEmail,
    changedFiles,
    diffStat,
    recentCommits,
    aheadCount,
    behindCount,
  };
}

export function configureLocalGitRepo(
  projectPath: string,
  options: {
    initIfMissing?: boolean;
    defaultBranch?: string;
    userName?: string;
    userEmail?: string;
    remoteOriginUrl?: string;
  }
): { success: boolean; message: string; status: LocalGitStatus } {
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Le dossier cible n'existe pas : ${resolved}`);
  }

  const isGitRepo =
    fs.existsSync(path.join(resolved, '.git')) ||
    runGitSafe(resolved, ['rev-parse', '--is-inside-work-tree']) === 'true';

  if (!isGitRepo && options.initIfMissing) {
    const branchName = (options.defaultBranch || 'main').replace(/[^a-zA-Z0-9._/-]/g, '');
    execFileSync('git', ['init', '-b', branchName || 'main'], { cwd: resolved });
  }

  if (options.userName !== undefined && options.userName.trim()) {
    execFileSync('git', ['config', 'user.name', options.userName.trim()], { cwd: resolved });
  }
  if (options.userEmail !== undefined && options.userEmail.trim()) {
    execFileSync('git', ['config', 'user.email', options.userEmail.trim()], { cwd: resolved });
  }

  if (options.remoteOriginUrl !== undefined && options.remoteOriginUrl.trim()) {
    const cleanUrl = options.remoteOriginUrl.trim();
    const existingRemote = runGitSafe(resolved, ['remote', 'get-url', 'origin']);
    if (existingRemote) {
      execFileSync('git', ['remote', 'set-url', 'origin', cleanUrl], { cwd: resolved });
    } else {
      execFileSync('git', ['remote', 'add', 'origin', cleanUrl], { cwd: resolved });
    }
  }

  return {
    success: true,
    message: 'Configuration Git mise à jour avec succès.',
    status: inspectLocalGitStatus(resolved),
  };
}

export function commitAndPushChanges(
  projectPath: string,
  options: {
    branchName?: string;
    createNewBranch?: boolean;
    commitMessage: string;
    commitDescription?: string;
    filesToStage?: string[]; // empty or undefined = stage all (`git add -A`)
    pushToOrigin?: boolean;
    githubToken?: string;
  }
): {
  success: boolean;
  commitHash: string;
  branch: string;
  pushed: boolean;
  message: string;
  status: LocalGitStatus;
} {
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Dossier introuvable : ${resolved}`);
  }

  // Ensure git repo is initialized
  const isGitRepo =
    fs.existsSync(path.join(resolved, '.git')) ||
    runGitSafe(resolved, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!isGitRepo) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: resolved });
  }

  // Ensure git user.name and user.email exist locally so commit never fails
  const currentName = runGitSafe(resolved, ['config', 'user.name']);
  const currentEmail = runGitSafe(resolved, ['config', 'user.email']);
  if (!currentName) {
    execFileSync('git', ['config', 'user.name', 'Aegis DevOps Bot'], { cwd: resolved });
  }
  if (!currentEmail) {
    execFileSync('git', ['config', 'user.email', 'aegis-bot@users.noreply.github.com'], {
      cwd: resolved,
    });
  }

  // Switch or create branch if requested
  let activeBranch = runGitSafe(resolved, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  if (options.branchName && options.branchName.trim()) {
    const cleanBranch = options.branchName.trim().replace(/[^a-zA-Z0-9._/-]/g, '-');
    if (options.createNewBranch) {
      try {
        execFileSync('git', ['checkout', '-b', cleanBranch], { cwd: resolved });
      } catch {
        execFileSync('git', ['checkout', cleanBranch], { cwd: resolved });
      }
      activeBranch = cleanBranch;
    } else if (cleanBranch !== activeBranch) {
      execFileSync('git', ['checkout', cleanBranch], { cwd: resolved });
      activeBranch = cleanBranch;
    }
  }

  // Stage files safely (auto-heal missing leading dot from older porcelain state and fallback to git add -A)
  if (options.filesToStage && options.filesToStage.length > 0) {
    const normalizedFiles = options.filesToStage.map((f) => {
      const clean = f.trim();
      if (
        !fs.existsSync(path.join(resolved, clean)) &&
        fs.existsSync(path.join(resolved, '.' + clean))
      ) {
        return '.' + clean;
      }
      return clean;
    });
    try {
      execFileSync('git', ['add', '--', ...normalizedFiles], { cwd: resolved });
    } catch {
      execFileSync('git', ['add', '-A'], { cwd: resolved });
    }
  } else {
    execFileSync('git', ['add', '-A'], { cwd: resolved });
  }

  // Check if there are staged changes to commit
  const stagedPorcelain = runGitSafe(resolved, ['status', '--porcelain'], true);
  let commitHash = runGitSafe(resolved, ['rev-parse', '--short', 'HEAD']);

  if (stagedPorcelain.length > 0) {
    const commitArgs = ['commit', '-m', options.commitMessage.trim() || 'fix(ci-cd): apply Aegis patches'];
    if (options.commitDescription && options.commitDescription.trim()) {
      commitArgs.push('-m', options.commitDescription.trim());
    }
    execFileSync('git', commitArgs, { cwd: resolved });
    commitHash = runGitSafe(resolved, ['rev-parse', '--short', 'HEAD']);
  }

  let pushed = false;
  if (options.pushToOrigin) {
    const remoteUrl = runGitSafe(resolved, ['remote', 'get-url', 'origin']);
    if (!remoteUrl) {
      throw new Error(
        'Aucun dépôt distant (remote "origin") n’est configuré sur ce projet. Liez ou créez un dépôt GitHub d’abord.'
      );
    }

    const { token } = resolveGitHubToken(options.githubToken);
    const ownerRepo = parseGitHubOwnerRepo(remoteUrl);

    if (token && ownerRepo && remoteUrl.startsWith('https://')) {
      // Push using transient HTTP Basic Auth header so token is never written to .git/config
      const basicAuth = Buffer.from(`x-access-token:${token}`, 'utf-8').toString('base64');
      execFileSync(
        'git',
        [
          '-c',
          `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basicAuth}`,
          'push',
          '-u',
          'origin',
          activeBranch,
        ],
        { cwd: resolved, timeout: 45000 }
      );
      pushed = true;
    } else {
      execFileSync('git', ['push', '-u', 'origin', activeBranch], {
        cwd: resolved,
        timeout: 45000,
      });
      pushed = true;
    }
  }

  return {
    success: true,
    commitHash,
    branch: activeBranch,
    pushed,
    message: pushed
      ? `Commit ${commitHash} créé et poussé sur origin/${activeBranch}.`
      : `Commit local ${commitHash} créé sur la branche ${activeBranch}.`,
    status: inspectLocalGitStatus(resolved),
  };
}

export async function githubApiRequest<T>(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.github.com${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Aegis-CI-CD-Toolbox/1.0',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let errDetail = `${response.status} ${response.statusText}`;
    try {
      const errJson = (await response.json()) as { message?: string; errors?: { message?: string }[] };
      if (errJson.message) {
        errDetail = errJson.message;
        if (errJson.errors && errJson.errors.length > 0) {
          errDetail += ` (${errJson.errors.map((e) => e.message).filter(Boolean).join(', ')})`;
        }
      }
    } catch {
      // Ignore parse error
    }
    throw new Error(`GitHub API: ${errDetail}`);
  }

  return (await response.json()) as T;
}
