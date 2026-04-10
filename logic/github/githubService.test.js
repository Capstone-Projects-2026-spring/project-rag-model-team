import { jest } from "@jest/globals";

await jest.unstable_mockModule("dotenv", () => ({
  default: {
    config: jest.fn(),
  },
}));

const mockGetAll = jest.fn();
const mockGetOne = jest.fn();
const mockRunQuery = jest.fn();

await jest.unstable_mockModule("../database/sqlite.js", () => ({
  getAll: mockGetAll,
  getOne: mockGetOne,
  runQuery: mockRunQuery,
}));

const {
  clearAllSyncedGitHubData,
  getSyncedGitHubRepositories,
  getSyncedGitHubRepository,
  parseGitHubRepository,
  recommendGitHubUsersForTopic,
} = await import("./githubService.js");

describe("parseGitHubRepository", () => {
  beforeEach(() => {
    mockGetAll.mockReset();
    mockGetOne.mockReset();
    mockRunQuery.mockReset();
  });

  it("accepts owner/repo values directly", () => {
    expect(
      parseGitHubRepository("Capstone-Projects-2026-spring/project-rag-model-team"),
    ).toBe("Capstone-Projects-2026-spring/project-rag-model-team");
  });

  it("accepts full GitHub URLs", () => {
    expect(
      parseGitHubRepository(
        "https://github.com/Capstone-Projects-2026-spring/project-rag-model-team",
      ),
    ).toBe("Capstone-Projects-2026-spring/project-rag-model-team");
  });

  it("accepts .git clone URLs", () => {
    expect(
      parseGitHubRepository(
        "https://github.com/Capstone-Projects-2026-spring/project-rag-model-team.git",
      ),
    ).toBe("Capstone-Projects-2026-spring/project-rag-model-team");
  });

  it("accepts Slack-formatted URLs", () => {
    expect(
      parseGitHubRepository(
        "<https://github.com/Capstone-Projects-2026-spring/project-rag-model-team.git|https://github.com/Capstone-Projects-2026-spring/project-rag-model-team.git>",
      ),
    ).toBe("Capstone-Projects-2026-spring/project-rag-model-team");
  });

  it("accepts repo names copied from the synced repo list", () => {
    expect(
      parseGitHubRepository(
        "• *Capstone-Projects-2026-spring/project-rag-model-team* (active)",
      ),
    ).toBe("Capstone-Projects-2026-spring/project-rag-model-team");
  });

  it("loads a synced repo using normalized repository input", () => {
    mockGetOne.mockReturnValue({
      id: 1,
      full_name: "Capstone-Projects-2026-spring/project-rag-model-team",
    });

    const repo = getSyncedGitHubRepository(
      "https://github.com/Capstone-Projects-2026-spring/project-rag-model-team.git",
    );

    expect(mockGetOne).toHaveBeenCalledWith(
      "SELECT * FROM github_repositories WHERE full_name = ?",
      ["Capstone-Projects-2026-spring/project-rag-model-team"],
    );
    expect(repo).toEqual({
      id: 1,
      full_name: "Capstone-Projects-2026-spring/project-rag-model-team",
    });
  });

  it("lists synced repos in name order", () => {
    mockGetAll.mockReturnValue([
      { full_name: "org/repo-a" },
      { full_name: "org/repo-b" },
    ]);

    expect(getSyncedGitHubRepositories()).toEqual(["org/repo-a", "org/repo-b"]);
  });

  it("clears synced repo analytics and active repo pointers", () => {
    mockGetAll.mockReturnValue([
      { full_name: "org/repo-a" },
      { full_name: "org/repo-b" },
    ]);
    mockGetOne.mockReturnValue({ count: 7 });

    const result = clearAllSyncedGitHubData();

    expect(result).toEqual({
      repositories_cleared: 2,
      contributors_cleared: 7,
    });
    expect(mockRunQuery).toHaveBeenNthCalledWith(
      1,
      "DELETE FROM github_contributors",
    );
    expect(mockRunQuery).toHaveBeenNthCalledWith(
      2,
      "DELETE FROM github_repositories",
    );
    expect(mockRunQuery).toHaveBeenNthCalledWith(
      3,
      "UPDATE user_info SET active_github_repo = NULL",
    );
  });

  it("filters contributor analytics to the requested active repo", () => {
    mockGetOne.mockReturnValue({
      id: 1,
      full_name: "Capstone-Projects-2026-spring/project-rag-model-team",
      synced_at: "2026-04-09T10:00:00Z",
    });

    mockGetAll.mockImplementation((sql) => {
      if (sql.includes("SELECT full_name FROM github_repositories")) {
        return [
          {
            full_name: "Capstone-Projects-2026-spring/project-rag-model-team",
          },
        ];
      }

      return [
        {
          github_login: "octocat",
          github_name: "Octo Cat",
          total_commits: 4,
          commits_last_15_days: 2,
          commits_last_30_days: 3,
          commits_last_90_days: 4,
          commits_last_180_days: 4,
          recent_commits: 3,
          last_commit_at: "2026-04-06T12:00:00Z",
          touched_files: '["src/auth/login.js"]',
          recent_messages: '["auth cleanup"]',
          full_name: "Capstone-Projects-2026-spring/project-rag-model-team",
        },
      ];
    });

    const result = recommendGitHubUsersForTopic(
      "Who can help with auth?",
      [],
      3,
      "https://github.com/Capstone-Projects-2026-spring/project-rag-model-team.git",
    );

    expect(mockGetAll).toHaveBeenCalledWith(
      expect.stringContaining("WHERE r.full_name IN (?)"),
      ["Capstone-Projects-2026-spring/project-rag-model-team"],
    );
    expect(result.answer).toContain(
      "Capstone-Projects-2026-spring/project-rag-model-team",
    );
    expect(result.answer).toContain("*Repo analytics:*");
    expect(result.answer).toContain(
      "<https://github.com/Capstone-Projects-2026-spring/project-rag-model-team|Capstone-Projects-2026-spring/project-rag-model-team>",
    );
    expect(result.syncContext).toEqual(
      expect.objectContaining({
        repoFullName: "Capstone-Projects-2026-spring/project-rag-model-team",
      }),
    );
    expect(result.suggestedUsers[0]).toEqual(
      expect.objectContaining({
        github_username: "octocat",
      }),
    );
  });

  it("auto-selects the only synced repo when no active repo is set", () => {
    mockGetAll.mockImplementation((sql) => {
      if (sql.includes("SELECT full_name FROM github_repositories")) {
        return [{ full_name: "org/solo-repo" }];
      }

      return [
        {
          github_login: "octocat",
          github_name: "Octo Cat",
          total_commits: 2,
          commits_last_15_days: 1,
          commits_last_30_days: 2,
          commits_last_90_days: 2,
          commits_last_180_days: 2,
          recent_commits: 2,
          last_commit_at: "2026-04-06T12:00:00Z",
          touched_files: '["db/schema.sql"]',
          recent_messages: '["database updates"]',
          full_name: "org/solo-repo",
        },
      ];
    });

    const result = recommendGitHubUsersForTopic("Who should I talk to about database?");

    expect(result.answer).toContain("*Repo analytics:*");
    expect(result.answer).toContain("from org/solo-repo");
    expect(result.suggestedUsers).toHaveLength(1);
    expect(result.suggestedUsers[0].why[0]).toContain('*"database"*');
  });

  it("shows last sync freshness in the repo analytics banner", () => {
    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-04-09T12:00:00Z"));

    try {
      mockGetAll.mockImplementation((sql) => {
        if (sql.includes("SELECT full_name FROM github_repositories")) {
          return [{ full_name: "org/solo-repo" }];
        }

        return [
          {
            github_login: "octocat",
            github_name: "Octo Cat",
            total_commits: 2,
            commits_last_15_days: 1,
            commits_last_30_days: 2,
            commits_last_90_days: 2,
            commits_last_180_days: 2,
            recent_commits: 2,
            last_commit_at: "2026-04-06T12:00:00Z",
            touched_files: '["db/schema.sql"]',
            recent_messages: '["database updates"]',
            full_name: "org/solo-repo",
          },
        ];
      });
      mockGetOne.mockReturnValue({
        id: 1,
        full_name: "org/solo-repo",
        synced_at: "2026-04-09T10:00:00Z",
      });

      const result = recommendGitHubUsersForTopic(
        "Who should I talk to about database?",
      );

      expect(result.answer).toContain("*Analytics last synced:* *2 hours ago*");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("highlights the activity window in contributor reasons", () => {
    mockGetAll.mockImplementation((sql) => {
      if (sql.includes("SELECT full_name FROM github_repositories")) {
        return [{ full_name: "org/solo-repo" }];
      }

      return [
        {
          github_login: "octocat",
          github_name: "Octo Cat",
          total_commits: 14,
          commits_last_15_days: 14,
          commits_last_30_days: 14,
          commits_last_90_days: 14,
          commits_last_180_days: 14,
          recent_commits: 14,
          last_commit_at: "2026-04-06T12:00:00Z",
          touched_files: '["src/auth/login.js"]',
          recent_messages: '["auth cleanup"]',
          full_name: "org/solo-repo",
        },
      ];
    });

    const result = recommendGitHubUsersForTopic("Who can help with auth?");

    expect(result.suggestedUsers[0].why).toEqual(
      expect.arrayContaining([
        expect.stringContaining("*14 commits*"),
        expect.stringContaining("last *15 days*"),
        expect.stringContaining("*2026-04-06*"),
      ]),
    );
  });

  it("avoids adding a second redundant synced-activity reason when recent activity is already shown", () => {
    mockGetAll.mockImplementation((sql) => {
      if (sql.includes("SELECT full_name FROM github_repositories")) {
        return [{ full_name: "org/solo-repo" }];
      }

      return [
        {
          github_login: "octocat",
          github_name: "Octo Cat",
          total_commits: 5,
          commits_last_15_days: 5,
          commits_last_30_days: 5,
          commits_last_90_days: 5,
          commits_last_180_days: 5,
          recent_commits: 5,
          last_commit_at: "2026-04-06T12:00:00Z",
          touched_files: '["logic/langChain/rag_implementation.js"]',
          recent_messages: '["langchain updates"]',
          full_name: "org/solo-repo",
        },
      ];
    });

    const result = recommendGitHubUsersForTopic("Who knows about langchain?");
    const why = result.suggestedUsers[0].why;

    expect(why).toEqual(
      expect.arrayContaining([
        expect.stringContaining("last *15 days*"),
      ]),
    );
    expect(why).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("Has contributed heavily"),
      ]),
    );
  });

  it("requires an active repo when multiple repos are synced unless multi-repo search is explicit", () => {
    mockGetAll.mockImplementation((sql) => {
      if (sql.includes("SELECT full_name FROM github_repositories")) {
        return [{ full_name: "org/repo-a" }, { full_name: "org/repo-b" }];
      }

      return [];
    });

    const result = recommendGitHubUsersForTopic(
      "Who should I talk to about database?",
    );

    expect(result.suggestedUsers).toEqual([]);
    expect(result.answer).toContain("multiple repos");
    expect(result.answer).toContain("/set-active-repo");
    expect(result.answer).toContain("/list-repos");
  });

  it("searches across multiple synced repos only when the prompt asks for it explicitly", () => {
    mockGetAll.mockImplementation((sql) => {
      if (sql.includes("SELECT full_name FROM github_repositories")) {
        return [{ full_name: "org/repo-a" }, { full_name: "org/repo-b" }];
      }

      return [
        {
          github_login: "octocat",
          github_name: "Octo Cat",
          total_commits: 5,
          commits_last_15_days: 2,
          commits_last_30_days: 4,
          commits_last_90_days: 5,
          commits_last_180_days: 5,
          recent_commits: 4,
          last_commit_at: "2026-04-06T12:00:00Z",
          touched_files: '["db/schema.sql"]',
          recent_messages: '["database updates"]',
          full_name: "org/repo-a",
        },
      ];
    });

    const result = recommendGitHubUsersForTopic(
      "Across all synced repos, who should I talk to about database?",
    );

    expect(mockGetAll).toHaveBeenCalledWith(
      expect.stringContaining("WHERE r.full_name IN (?, ?)"),
      ["org/repo-a", "org/repo-b"],
    );
    expect(result.answer).toContain("*Repo analytics:*");
    expect(result.answer).toContain("from org/repo-a and org/repo-b");
  });
});
