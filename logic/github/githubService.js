import dotenv from "dotenv";
import { getAll, getOne, runQuery } from "../database/sqlite.js";

dotenv.config();

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_SYNC_COMMIT_LIMIT = Number(
  process.env.GITHUB_SYNC_COMMIT_LIMIT || 30,
);
const RECENT_ACTIVITY_DAYS = 30;
const ACTIVITY_WINDOWS = [15, 30, 90, 180];
const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "any",
  "are",
  "be",
  "because",
  "can",
  "changes",
  "do",
  "for",
  "from",
  "help",
  "how",
  "i",
  "in",
  "is",
  "it",
  "made",
  "me",
  "most",
  "of",
  "on",
  "or",
  "our",
  "recent",
  "recently",
  "repo",
  "repository",
  "show",
  "source",
  "team",
  "that",
  "the",
  "this",
  "those",
  "to",
  "topic",
  "user",
  "users",
  "was",
  "what",
  "who",
  "with",
  "worked",
  "working",
]);

function parseJsonField(value, fallback = []) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeGitHubUsername(value) {
  return normalizeText(value).replace(/^@/, "");
}

export function parseGitHubRepository(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/\s+\(active\)$/i, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^`+|`+$/g, "");
  if (!normalized) return null;

  const slackUnwrapped = normalized.replace(/^<|>$/g, "").split("|")[0].trim();

  const cleaned = slackUnwrapped
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");

  const [owner, repo] = cleaned.split("/").slice(0, 2);
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

export function getSyncedGitHubRepository(repoInput) {
  const repoFullName = parseGitHubRepository(repoInput);
  if (!repoFullName) {
    return null;
  }

  return getOne(`SELECT * FROM github_repositories WHERE full_name = ?`, [
    repoFullName,
  ]);
}

export function getSyncedGitHubRepositories() {
  return getAll(
    `SELECT full_name FROM github_repositories ORDER BY full_name COLLATE NOCASE`,
  ).map((row) => row.full_name);
}

export function clearAllSyncedGitHubData() {
  const syncedRepos = getSyncedGitHubRepositories();
  const contributorCount =
    getOne(`SELECT COUNT(*) AS count FROM github_contributors`)?.count || 0;

  runQuery(`DELETE FROM github_contributors`);
  runQuery(`DELETE FROM github_repositories`);
  runQuery(`UPDATE user_info SET active_github_repo = NULL`);

  return {
    repositories_cleared: syncedRepos.length,
    contributors_cleared: contributorCount,
  };
}

function hasExplicitMultiRepoRequest(topic) {
  const normalizedTopic = normalizeText(topic);
  return [
    "across all repos",
    "across all repositories",
    "across all synced repos",
    "across all synced repositories",
    "across multiple repos",
    "across multiple repositories",
    "search all repos",
    "search all repositories",
    "search across all repos",
    "search across all repositories",
    "all synced repos",
    "all synced repositories",
    "multiple repos",
    "multiple repositories",
  ].some((phrase) => normalizedTopic.includes(phrase));
}

function tokenizeTopic(topic) {
  return Array.from(
    new Set(
      normalizeText(topic)
        .split(/[^a-z0-9]+/i)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  );
}

function formatKeywordList(keywords) {
  if (keywords.length === 0) return "this topic";
  const highlightedKeywords = keywords
    .slice(0, 3)
    .map((keyword) => `*"${keyword}"*`);
  if (highlightedKeywords.length === 1) return highlightedKeywords[0];
  if (highlightedKeywords.length === 2) {
    return `${highlightedKeywords[0]} and ${highlightedKeywords[1]}`;
  }
  return `${highlightedKeywords[0]}, ${highlightedKeywords[1]}, and ${highlightedKeywords[2]}`;
}

function formatFileList(files) {
  const selected = files.slice(0, 2);
  if (selected.length === 0) return null;
  if (selected.length === 1) return `\`${selected[0]}\``;
  return `\`${selected[0]}\` and \`${selected[1]}\``;
}

function formatShortDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function formatRelativeTime(value) {
  if (!value) return null;

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) {
    return "just now";
  }

  if (diffMs < hourMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (diffMs < dayMs) {
    const hours = Math.floor(diffMs / hourMs);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(diffMs / dayMs);
  if (days < 7) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }

  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function getMostSpecificActivityWindow(stats) {
  for (const windowDays of ACTIVITY_WINDOWS) {
    const count = stats[`commits_last_${windowDays}_days`] || 0;
    if (count > 0) {
      return { days: windowDays, count };
    }
  }

  return null;
}

function parseContributorRow(row) {
  if (!row) return null;
  return {
    ...row,
    touched_files: parseJsonField(row.touched_files),
    recent_messages: parseJsonField(row.recent_messages),
  };
}

function upsertGitHubRepository(repo) {
  runQuery(
    `INSERT INTO github_repositories (full_name, owner, name, default_branch, synced_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(full_name) DO UPDATE SET
       owner = excluded.owner,
       name = excluded.name,
       default_branch = excluded.default_branch,
       synced_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [repo.full_name, repo.owner, repo.name, repo.default_branch || null],
  );

  return getOne(`SELECT * FROM github_repositories WHERE full_name = ?`, [
    repo.full_name,
  ]);
}

function replaceGitHubContributors(repoId, contributors) {
  runQuery(`DELETE FROM github_contributors WHERE repo_id = ?`, [repoId]);

  for (const contributor of contributors) {
    runQuery(
      `INSERT INTO github_contributors (
        repo_id,
        github_login,
        github_name,
        total_commits,
        commits_last_15_days,
        commits_last_30_days,
        commits_last_90_days,
        commits_last_180_days,
        recent_commits,
        last_commit_at,
        touched_files,
        recent_messages,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        repoId,
        contributor.github_login,
        contributor.github_name || null,
        contributor.total_commits,
        contributor.commits_last_15_days,
        contributor.commits_last_30_days,
        contributor.commits_last_90_days,
        contributor.commits_last_180_days,
        contributor.recent_commits,
        contributor.last_commit_at || null,
        JSON.stringify(contributor.touched_files),
        JSON.stringify(contributor.recent_messages),
      ],
    );
  }
}

async function fetchGitHubJson(path, token) {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "Keystone-Bot",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function fetchCommitDetails(repoFullName, commitShas, token) {
  const details = [];

  for (const sha of commitShas) {
    const commit = await fetchGitHubJson(
      `/repos/${repoFullName}/commits/${sha}`,
      token,
    );
    details.push(commit);
  }

  return details;
}

function aggregateContributors(commitDetails) {
  const cutoff = Date.now() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000;
  const contributors = new Map();

  for (const commit of commitDetails) {
    const committedAt =
      commit?.commit?.author?.date || commit?.commit?.committer?.date || null;
    const githubLogin = normalizeGitHubUsername(
      commit?.author?.login || commit?.committer?.login,
    );

    if (!githubLogin) {
      continue;
    }

    const contributor = contributors.get(githubLogin) || {
      github_login: githubLogin,
      github_name:
        commit?.commit?.author?.name ||
        commit?.commit?.committer?.name ||
        githubLogin,
      total_commits: 0,
      commits_last_15_days: 0,
      commits_last_30_days: 0,
      commits_last_90_days: 0,
      commits_last_180_days: 0,
      recent_commits: 0,
      last_commit_at: null,
      touched_files: new Set(),
      recent_messages: [],
    };

    contributor.total_commits += 1;

    if (committedAt) {
      const committedAtMs = Date.parse(committedAt);

      if (committedAtMs >= cutoff) {
        contributor.recent_commits += 1;
      }

      for (const windowDays of ACTIVITY_WINDOWS) {
        const windowCutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
        if (committedAtMs >= windowCutoff) {
          contributor[`commits_last_${windowDays}_days`] += 1;
        }
      }
    }

    if (
      !contributor.last_commit_at ||
      committedAt > contributor.last_commit_at
    ) {
      contributor.last_commit_at = committedAt;
    }

    for (const file of commit?.files || []) {
      if (file?.filename) {
        contributor.touched_files.add(file.filename);
      }
    }

    const message = String(commit?.commit?.message || "").trim();
    if (
      message &&
      !contributor.recent_messages.includes(message) &&
      contributor.recent_messages.length < 8
    ) {
      contributor.recent_messages.push(message);
    }

    contributors.set(githubLogin, contributor);
  }

  return Array.from(contributors.values()).map((contributor) => ({
    ...contributor,
    touched_files: Array.from(contributor.touched_files).slice(0, 100),
  }));
}

function matchKeywords(values, keywords) {
  if (keywords.length === 0) return [];

  return values.filter((value) => {
    const haystack = normalizeText(value);
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

function combineContributorStats(rows) {
  const combined = {
    repos: new Set(),
    github_login: rows[0].github_login,
    github_name: rows[0].github_name,
    total_commits: 0,
    commits_last_15_days: 0,
    commits_last_30_days: 0,
    commits_last_90_days: 0,
    commits_last_180_days: 0,
    recent_commits: 0,
    last_commit_at: null,
    touched_files: new Set(),
    recent_messages: [],
  };

  for (const row of rows) {
    combined.repos.add(row.full_name);
    combined.total_commits += row.total_commits;
    combined.commits_last_15_days += row.commits_last_15_days || 0;
    combined.commits_last_30_days += row.commits_last_30_days || 0;
    combined.commits_last_90_days += row.commits_last_90_days || 0;
    combined.commits_last_180_days += row.commits_last_180_days || 0;
    combined.recent_commits += row.recent_commits;

    if (
      !combined.last_commit_at ||
      row.last_commit_at > combined.last_commit_at
    ) {
      combined.last_commit_at = row.last_commit_at;
    }

    for (const file of row.touched_files) {
      combined.touched_files.add(file);
    }

    for (const message of row.recent_messages) {
      if (
        !combined.recent_messages.includes(message) &&
        combined.recent_messages.length < 8
      ) {
        combined.recent_messages.push(message);
      }
    }
  }

  return {
    ...combined,
    repos: Array.from(combined.repos),
    touched_files: Array.from(combined.touched_files),
  };
}

function buildContributorWhy(
  topic,
  stats,
  topicFileMatches,
  topicMessageMatches,
  heavyThreshold,
) {
  const topicLabel = formatKeywordList(tokenizeTopic(topic));
  const repoLabel =
    stats.repos.length === 1
      ? stats.repos[0]
      : `${stats.repos.length} synced repositories`;
  const why = [];

  if (topicFileMatches.length > 0) {
    const fileList = formatFileList(topicFileMatches);
    why.push(
      fileList
        ? `Worked on files related to ${topicLabel}, including ${fileList}.`
        : `Worked on files related to ${topicLabel}.`,
    );
  } else if (topicMessageMatches.length > 0) {
    why.push(`Recent commit messages mention ${topicLabel}.`);
  }

  if (stats.recent_commits > 0) {
    const lastCommitDate = formatShortDate(stats.last_commit_at);
    const activityWindow = getMostSpecificActivityWindow(stats);
    const windowDays = activityWindow?.days || 30;
    const windowCount = activityWindow?.count || stats.recent_commits;
    why.push(
      lastCommitDate
        ? `Made *${windowCount} commit${windowCount === 1 ? "" : "s"}* in the last *${windowDays} days* in ${repoLabel}; latest activity was *${lastCommitDate}*.`
        : `Made *${windowCount} commit${windowCount === 1 ? "" : "s"}* in the last *${windowDays} days* in ${repoLabel}.`,
    );
  }

  if (stats.total_commits >= heavyThreshold && stats.recent_commits === 0) {
    why.push(
      `Has contributed heavily to ${repoLabel} with ${stats.total_commits} synced commit${stats.total_commits === 1 ? "" : "s"}.`,
    );
  }

  return why.slice(0, 3);
}

function formatRepoScope(repoNames) {
  if (!Array.isArray(repoNames) || repoNames.length === 0) {
    return null;
  }

  if (repoNames.length === 1) {
    return repoNames[0];
  }

  if (repoNames.length === 2) {
    return `${repoNames[0]} and ${repoNames[1]}`;
  }

  return `${repoNames.slice(0, 3).join(", ")}${repoNames.length > 3 ? `, and ${repoNames.length - 3} more` : ""}`;
}

function formatHighlightedRepoScope(repoNames) {
  if (!Array.isArray(repoNames) || repoNames.length === 0) {
    return null;
  }

  const highlightedRepos = repoNames
    .slice(0, 3)
    .map((repoName) => `<https://github.com/${repoName}|${repoName}>`);
  if (repoNames.length === 1) {
    return highlightedRepos[0];
  }

  if (repoNames.length === 2) {
    return `${highlightedRepos[0]} and ${highlightedRepos[1]}`;
  }

  return `${highlightedRepos.join(", ")}${repoNames.length > 3 ? `, and ${repoNames.length - 3} more` : ""}`;
}

function buildSyncFreshnessLine(repo) {
  const relativeTime = formatRelativeTime(repo?.synced_at);
  return relativeTime ? `*Analytics last synced:* *${relativeTime}*` : null;
}

function buildGitHubSummary(topic, suggestions, repoNames = [], scopedRepo = null) {
  if (suggestions.length === 0) {
    return null;
  }

  const repoScope = formatRepoScope(repoNames);
  const highlightedRepoScope = formatHighlightedRepoScope(repoNames);
  const freshnessLine = buildSyncFreshnessLine(scopedRepo);
  const repoBanner = highlightedRepoScope
    ? `*Repo analytics:* ${highlightedRepoScope}\n${freshnessLine ? `${freshnessLine}\n` : ""}`
    : "";
  const repoLabel = repoScope ? ` from ${repoScope}` : "";
  return `${repoBanner}Here are a few people who look like strong references for "${topic}" based on synced GitHub activity${repoLabel}.`;
}

export async function syncGitHubRepository(
  repoInput,
  {
    token = process.env.GITHUB_TOKEN,
    commitLimit = DEFAULT_SYNC_COMMIT_LIMIT,
  } = {},
) {
  const repoFullName = parseGitHubRepository(
    repoInput || process.env.GITHUB_REPO,
  );
  if (!repoFullName) {
    throw new Error("Provide a GitHub repo as owner/repo or set GITHUB_REPO.");
  }

  const repo = await fetchGitHubJson(`/repos/${repoFullName}`, token);
  const repositoryRow = upsertGitHubRepository({
    full_name: repo.full_name,
    owner: repo.owner?.login || repo.owner?.name || repoFullName.split("/")[0],
    name: repo.name,
    default_branch: repo.default_branch,
  });

  const commits = await fetchGitHubJson(
    `/repos/${repoFullName}/commits?per_page=${Math.max(1, Math.min(commitLimit, 100))}`,
    token,
  );

  const commitShas = commits.map((commit) => commit.sha).filter(Boolean);
  const commitDetails = await fetchCommitDetails(
    repoFullName,
    commitShas,
    token,
  );
  const contributors = aggregateContributors(commitDetails);

  replaceGitHubContributors(repositoryRow.id, contributors);

  return {
    repository: repo.full_name,
    synced_commits: commitDetails.length,
    contributors: contributors.length,
  };
}

export function recommendGitHubUsersForTopic(
  topic,
  profiles = [],
  limit = 3,
  repoInput = null,
) {
  const repoFullName = parseGitHubRepository(repoInput);
  const syncedRepos = getSyncedGitHubRepositories();
  const explicitMultiRepoRequest = hasExplicitMultiRepoRequest(topic);
  let scopedRepos = [];

  if (repoFullName) {
    if (!syncedRepos.includes(repoFullName)) {
      return {
        answer: `Your active GitHub repo is set to "${repoFullName}", but I do not have synced analytics for it right now. Sync it again, or use \`/list-repos\` to see what's available before choosing another with \`/set-active-repo owner/repo\`.`,
        suggestedUsers: [],
      };
    }
    scopedRepos = [repoFullName];
  } else if (syncedRepos.length === 1) {
    scopedRepos = syncedRepos;
  } else if (syncedRepos.length > 1 && explicitMultiRepoRequest) {
    scopedRepos = syncedRepos;
  } else if (syncedRepos.length > 1) {
    return {
      answer: `I have synced GitHub analytics for multiple repos: ${formatRepoScope(syncedRepos)}. Use \`/list-repos\` to review them, set one with \`/set-active-repo owner/repo\`, or explicitly ask me to search across all synced repos.`,
      suggestedUsers: [],
    };
  }

  const scopedRepo =
    scopedRepos.length === 1 ? getSyncedGitHubRepository(scopedRepos[0]) : null;

  const contributorRows = getAll(
    `SELECT c.*, r.full_name
     FROM github_contributors c
     JOIN github_repositories r ON r.id = c.repo_id
     ${scopedRepos.length > 0 ? `WHERE r.full_name IN (${scopedRepos.map(() => "?").join(", ")})` : ""}`,
    scopedRepos,
  ).map(parseContributorRow);

  if (contributorRows.length === 0) {
    return {
      answer: null,
      suggestedUsers: [],
    };
  }

  const contributorGroups = contributorRows.reduce((map, row) => {
    const login = normalizeGitHubUsername(row.github_login);
    if (!map.has(login)) {
      map.set(login, []);
    }
    map.get(login).push(row);
    return map;
  }, new Map());

  const topicKeywords = tokenizeTopic(topic);
  const allCombinedStats = Array.from(contributorGroups.values()).map(
    combineContributorStats,
  );
  const heavyThreshold =
    allCombinedStats.map((stats) => stats.total_commits).sort((a, b) => b - a)[
      Math.min(2, Math.max(allCombinedStats.length - 1, 0))
    ] || 1;
  const allowGitHubOnlyFallback = profiles.length === 0;
  const profilesByGitHubUsername = new Map(
    profiles
      .filter((profile) =>
        normalizeGitHubUsername(profile?.userInfo?.github_username),
      )
      .map((profile) => [
        normalizeGitHubUsername(profile.userInfo.github_username),
        profile,
      ]),
  );

  const candidates = Array.from(contributorGroups.entries())
    .map(([githubUsername, rows]) => {
      const profile = profilesByGitHubUsername.get(githubUsername) || null;
      if (!profile && !allowGitHubOnlyFallback) {
        return null;
      }

      const combinedStats = combineContributorStats(rows);
      const topicFileMatches = matchKeywords(
        combinedStats.touched_files,
        topicKeywords,
      );
      const topicMessageMatches = matchKeywords(
        combinedStats.recent_messages,
        topicKeywords,
      );
      const why = buildContributorWhy(
        topic,
        combinedStats,
        topicFileMatches,
        topicMessageMatches,
        heavyThreshold,
      );

      if (why.length === 0) {
        return null;
      }

      return {
        profile,
        githubUsername,
        topicHitCount: topicFileMatches.length + topicMessageMatches.length,
        recentCommits: combinedStats.recent_commits,
        totalCommits: combinedStats.total_commits,
        lastCommitAt: combinedStats.last_commit_at,
        suggestion: {
          session_id: profile?.session_id || null,
          name:
            profile?.userInfo?.name ||
            combinedStats.github_name ||
            githubUsername,
          github_username: githubUsername,
          role: profile?.userInfo?.role || null,
          department: profile?.userInfo?.department || null,
          reason: why[0],
          why,
        },
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.topicHitCount !== left.topicHitCount) {
        return right.topicHitCount - left.topicHitCount;
      }
      if (right.recentCommits !== left.recentCommits) {
        return right.recentCommits - left.recentCommits;
      }
      if (right.totalCommits !== left.totalCommits) {
        return right.totalCommits - left.totalCommits;
      }
      return String(right.lastCommitAt || "").localeCompare(
        String(left.lastCommitAt || ""),
      );
    })
    .slice(0, limit)
    .map((candidate) => candidate.suggestion);

  return {
    answer: buildGitHubSummary(topic, candidates, scopedRepos, scopedRepo),
    suggestedUsers: candidates,
    syncContext: scopedRepo
      ? {
          repoFullName: scopedRepo.full_name,
          syncedAt: scopedRepo.synced_at || null,
        }
      : null,
  };
}
