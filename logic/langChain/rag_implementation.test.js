import { Readable } from "node:stream";
import { jest } from "@jest/globals";

const mockQueryGraphQL = jest.fn();
const mockListFiles = jest.fn();
const mockGetFile = jest.fn();
const mockGetFileContent = jest.fn();
const mockRecommendGitHubUsersForTopic = jest.fn();

const mockGetDocumentTags = jest.fn();
const mockUpsertDocumentTags = jest.fn();

const mockGetOne = jest.fn();
const mockGetAll = jest.fn();

const chainHandlers = {
  intent: jest.fn(),
  userInfo: jest.fn(),
  driveSearch: jest.fn(),
  driveSelection: jest.fn(),
  confidenceCheck: jest.fn(),
  autoClassify: jest.fn(),
  followUpQuestions: jest.fn(),
  threadHistory: jest.fn(),
};

function getChainHandler(template) {
  if (template.includes("Classify the intent of this message")) {
    return chainHandlers.intent;
  }

  if (template.includes("Given the following user information")) {
    return chainHandlers.userInfo;
  }

  if (template.includes("Return ONLY the files whose name or tags directly match")) {
    return chainHandlers.driveSearch;
  }

  if (template.includes("distill the most relevant information")) {
    return chainHandlers.driveSelection;
  }

  if (template.includes("Rate your CONFIDENCE (0-100)")) {
    return chainHandlers.confidenceCheck;
  }

  if (template.includes("classifying a document for a software team")) {
    return chainHandlers.autoClassify;
  }

  if (template.includes("generate 3-5 relevant follow-up questions")) {
    return chainHandlers.followUpQuestions;
  }

  if (template.includes("DIRECTLY answered from previous conversation history")) {
    return chainHandlers.threadHistory;
  }

  throw new Error(`Unknown prompt template: ${template}`);
}

function createChain(template) {
  return {
    pipe() {
      return createChain(template);
    },
    invoke(args) {
      return getChainHandler(template)(args);
    },
  };
}

await jest.unstable_mockModule("dotenv", () => ({
  default: {
    config: jest.fn(),
  },
}));

await jest.unstable_mockModule("@langchain/groq", () => ({
  ChatGroq: class ChatGroq {},
}));

await jest.unstable_mockModule("@langchain/core/prompts", () => ({
  PromptTemplate: {
    fromTemplate(template) {
      return createChain(template);
    },
  },
}));

await jest.unstable_mockModule("@langchain/core/output_parsers", () => ({
  StringOutputParser: class StringOutputParser {},
}));

await jest.unstable_mockModule("../../google_api/driveService.js", () => ({
  listFiles: mockListFiles,
  getFile: mockGetFile,
  getFileContent: mockGetFileContent,
}));

await jest.unstable_mockModule("../graphql_setup/graphql_client.js", () => ({
  queryGraphQL: mockQueryGraphQL,
}));

await jest.unstable_mockModule("../database/sqlite.js", () => ({
  getOne: mockGetOne,
  getAll: mockGetAll,
  initDatabase: jest.fn(),
}));

await jest.unstable_mockModule("../database/documentTagService.js", () => ({
  getDocumentTags: mockGetDocumentTags,
  upsertDocumentTags: mockUpsertDocumentTags,
}));

await jest.unstable_mockModule("../github/githubService.js", () => ({
  recommendGitHubUsersForTopic: mockRecommendGitHubUsersForTopic,
}));

const { answerQuestion } = await import("./rag_implementation.js");

beforeEach(() => {
  jest.clearAllMocks();

  chainHandlers.intent.mockResolvedValue('{"type":"GENERAL"}');
  chainHandlers.userInfo.mockResolvedValue("No matching users.");
  chainHandlers.driveSearch.mockResolvedValue("[]");
  chainHandlers.driveSelection.mockResolvedValue("IDK");
  chainHandlers.confidenceCheck.mockResolvedValue('{"confidence":85,"reason":"Documents directly answer the question."}');
  chainHandlers.autoClassify.mockResolvedValue('{"classification_level":"internal","tags":[]}');
  chainHandlers.threadHistory.mockResolvedValue('{"threadAnswer":false}');
  // Default: no profile in DB (requester is treated as public)
  mockGetOne.mockReturnValue(null);
  mockGetAll.mockReturnValue([]);
  // Default: files not yet in DB, so enrichment triggers auto-classify
  mockGetDocumentTags.mockReturnValue(null);
  mockUpsertDocumentTags.mockReturnValue(undefined);
  mockGetFileContent.mockResolvedValue({
    stream: Readable.from([Buffer.from("file content")]),
    format: "text",
  });
  mockRecommendGitHubUsersForTopic.mockReturnValue({
    answer: null,
    suggestedUsers: [],
  });
});

describe("answerQuestion access filtering", () => {
  it("returns low-confidence fallback for standalone no confirmation", async () => {
    const response = await answerQuestion("no");

    expect(response.answer).toContain("couldn't find relevant information in our internal documents");
    expect(response.followUpQuestions).toEqual([]);
    expect(chainHandlers.intent).not.toHaveBeenCalled();
  });

  it("returns a greeting response without sending greetings through the RAG prompt flow", async () => {
    // getOne returns null by default → public context → still a greeting
    const response = await answerQuestion("hi", "U_REQUESTER");

    expect(response).toContain("Hello! I'm Keystone Bot.");
    expect(chainHandlers.intent).not.toHaveBeenCalled();
    expect(chainHandlers.userInfo).not.toHaveBeenCalled();
    expect(chainHandlers.driveSearch).not.toHaveBeenCalled();
  });

  it("filters unauthorized profiles before user data reaches the suggestion prompt", async () => {
    chainHandlers.intent.mockResolvedValue(
      '{"type":"GET_USER","action":"GET_ALL"}',
    );
    chainHandlers.userInfo.mockResolvedValue("Talk to Alex.");
    chainHandlers.followUpQuestions.mockResolvedValue('[]');

    // getRequesterAccessContext: profile lookup then user_info
    mockGetOne
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ role: "junior_dev", classification_level: "internal", active_github_repo: "Capstone-Projects-2026-spring/project-rag-model-team" })
      // getAllUserProfiles: user_info for each of the 3 profiles
      .mockReturnValueOnce({ name: "Kidus", role: "mid_dev", classification_level: "internal", department: "Design" })
      .mockReturnValueOnce({ name: "Alex Internal", role: "mid_dev", classification_level: "internal", department: "Engineering" })
      .mockReturnValueOnce({ name: "Morgan Manager", role: "manager", classification_level: "restricted", department: "Leadership" });
    mockGetAll.mockReturnValueOnce([
      { id: "0", session_id: "U_REQUESTER" },
      { id: "1", session_id: "U_INTERNAL" },
      { id: "2", session_id: "U_RESTRICTED" },
    ]);

    const response = await answerQuestion(
      "Who can help with onboarding?",
      "U_REQUESTER",
    );

    expect(response.answer).toBe("Talk to Alex.");
    expect(response.followUpQuestions).toEqual([]);
    expect(chainHandlers.userInfo).toHaveBeenCalledTimes(1);

    const [{ userInfo }] = chainHandlers.userInfo.mock.calls[0];
    expect(userInfo).not.toContain("Kidus");
    expect(userInfo).toContain("Alex Internal");
    expect(userInfo).not.toContain("Morgan Manager");
    expect(userInfo).not.toContain("restricted");
  });

  it("uses synced GitHub contributor recommendations when linked users are available", async () => {
    chainHandlers.intent.mockResolvedValue(
      '{"type":"GET_USER","action":"GET_ALL"}',
    );
    chainHandlers.followUpQuestions.mockResolvedValue('[]');

    mockRecommendGitHubUsersForTopic.mockReturnValue({
      answer:
        'Here are a few people who look like strong references for "Who can help with auth?" based on synced GitHub activity.',
      suggestedUsers: [
        {
          session_id: "U_AUTH",
          name: "Alex Auth",
          role: "senior_dev",
          department: "Platform",
          reason: "Worked on files related to auth.",
          why: [
            "Worked on files related to auth.",
            "Made 3 recent commits in org/repo.",
          ],
        },
        {
          session_id: "U_RECENT",
          name: "Riley Recent",
          role: "qa",
          department: "Quality",
          reason: "Made 2 recent commits in org/repo.",
          why: [
            "Made 2 recent commits in org/repo.",
            "Has contributed heavily to org/repo.",
          ],
        },
      ],
      syncContext: {
        repoFullName: "Capstone-Projects-2026-spring/project-rag-model-team",
        syncedAt: "2026-04-09T10:00:00Z",
      },
    });

    mockGetOne
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ role: "junior_dev", classification_level: "internal", active_github_repo: "Capstone-Projects-2026-spring/project-rag-model-team" })
      .mockReturnValueOnce({ name: "Alex Auth", github_username: "alexauth", role: "senior_dev", classification_level: "internal", department: "Platform" })
      .mockReturnValueOnce({ name: "Riley Recent", github_username: "rileyrecent", role: "qa", classification_level: "internal", department: "Quality" });
    mockGetAll.mockReturnValueOnce([
      { id: "1", session_id: "U_AUTH" },
      { id: "2", session_id: "U_RECENT" },
    ]);

    const response = await answerQuestion("Who can help with auth?", "U_REQUESTER");

    expect(response.answer).toContain("strong references");
    expect(response.suggestedUsers).toHaveLength(2);
    expect(response.githubSyncContext).toEqual(
      expect.objectContaining({
        repoFullName: "Capstone-Projects-2026-spring/project-rag-model-team",
      }),
    );
    expect(response.suggestedUsers[0].why).toBeDefined();
    expect(mockRecommendGitHubUsersForTopic).toHaveBeenCalledTimes(1);
    expect(mockRecommendGitHubUsersForTopic).toHaveBeenCalledWith(
      "Who can help with auth?",
      expect.any(Array),
      3,
      "Capstone-Projects-2026-spring/project-rag-model-team",
    );
    expect(chainHandlers.userInfo).not.toHaveBeenCalled();
  });

  it("returns GitHub username recommendations even when no Slack users are linked yet", async () => {
    chainHandlers.intent.mockResolvedValue(
      '{"type":"GET_USER","action":"GET_ALL"}',
    );
    chainHandlers.followUpQuestions.mockResolvedValue('[]');

    mockRecommendGitHubUsersForTopic.mockReturnValue({
      answer:
        'Here are a few people who look like strong references for "Who can help with CI?" based on synced GitHub activity.',
      suggestedUsers: [
        {
          session_id: null,
          name: "octocat",
          github_username: "octocat",
          role: null,
          department: null,
          reason: "Worked on files related to ci.",
          why: [
            "Worked on files related to ci.",
            "Made 4 recent commits in org/repo.",
          ],
        },
      ],
    });

    mockGetOne
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ role: "junior_dev", classification_level: "internal" });
    mockGetAll.mockReturnValueOnce([]);

    const response = await answerQuestion("Who can help with CI?", "U_REQUESTER");

    expect(response.answer).toContain("strong references");
    expect(response.suggestedUsers).toEqual([
      expect.objectContaining({
        name: "octocat",
        github_username: "octocat",
      }),
    ]);
    expect(chainHandlers.userInfo).not.toHaveBeenCalled();
  });

  it("returns the GitHub repo-scope message instead of falling back to generic suggestions", async () => {
    chainHandlers.intent.mockResolvedValue(
      '{"type":"GET_USER","action":"GET_ALL"}',
    );
    chainHandlers.followUpQuestions.mockResolvedValue('[]');

    mockRecommendGitHubUsersForTopic.mockReturnValue({
      answer:
        "I have synced GitHub analytics for multiple repos: org/repo-a and org/repo-b. Use `/list-repos` to review them, set one with `/set-active-repo owner/repo`, or explicitly ask me to search across all synced repos.",
      suggestedUsers: [],
    });

    mockGetOne
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ role: "junior_dev", classification_level: "internal" })
      .mockReturnValueOnce({ name: "Alex Auth", role: "senior_dev", classification_level: "internal" });
    mockGetAll.mockReturnValueOnce([
      { id: "1", session_id: "U_AUTH" },
    ]);

    const response = await answerQuestion(
      "Who should I talk to about database?",
      "U_REQUESTER",
    );

    expect(response.answer).toContain("multiple repos");
    expect(response.answer).toContain("/set-active-repo");
    expect(response.answer).toContain("/list-repos");
    expect(response.suggestedUsers).toEqual([]);
    expect(chainHandlers.userInfo).not.toHaveBeenCalled();
  });

  it("filters unauthorized files before document metadata reaches the file-selection prompt", async () => {
    chainHandlers.intent.mockResolvedValue(
      '{"type":"SEARCH_DRIVE","query":"architecture"}',
    );
    chainHandlers.driveSearch.mockResolvedValue(
      '[{"id":"doc-internal","name":"architecture-guide.json"}]',
    );
    chainHandlers.driveSelection.mockResolvedValue(
      "Architecture guide summary",
    );
    chainHandlers.followUpQuestions.mockResolvedValue('[]');

    mockGetOne
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ role: "junior_dev", classification_level: "internal" });

    mockListFiles.mockResolvedValue([
      {
        id: "doc-internal",
        name: "architecture-guide.json",
        description: "classification: internal",
      },
      {
        id: "doc-restricted",
        name: "board-roadmap.json",
        description: "classification: restricted",
      },
    ]);

    mockGetFileContent.mockResolvedValue({
      stream: Readable.from([Buffer.from("Visible architecture content")]),
      format: "text",
    });

    const response = await answerQuestion(
      "Show me the architecture docs",
      "U_REQUESTER",
      false,
      []
    );
    console.log("Final response:", response);
    expect(response.answer).toBe("Architecture guide summary");
    expect(response.followUpQuestions).toEqual([]);
    expect(chainHandlers.driveSearch).toHaveBeenCalledTimes(1);

    const [{ files }] = chainHandlers.driveSearch.mock.calls[0];
    expect(files).toContain("architecture-guide.json");
    expect(files).not.toContain("board-roadmap.json");
    expect(files).not.toContain("restricted");

    const [{ content }] = chainHandlers.driveSelection.mock.calls[0];
    expect(content.join("\n")).toContain("Visible architecture content");
    expect(content.join("\n")).not.toContain("board-roadmap.json");
  });

  it("blocks unauthorized file suggestions before document contents reach the final answer prompt", async () => {
    chainHandlers.intent.mockResolvedValue(
      '{"type":"SEARCH_DRIVE","query":"roadmap"}',
    );
    chainHandlers.driveSearch.mockResolvedValue(
      '[{"id":"doc-restricted","name":"board-roadmap.json"}]',
    );
    chainHandlers.followUpQuestions.mockResolvedValue('[]');

    mockGetOne
      .mockReturnValueOnce({ id: 1 })
      .mockReturnValueOnce({ role: "junior_dev", classification_level: "internal" });

    mockListFiles.mockResolvedValue([
      {
        id: "doc-internal",
        name: "team-overview.json",
        description: "classification: internal",
      },
      {
        id: "doc-restricted",
        name: "board-roadmap.json",
        description: "classification: restricted",
      },
    ]);

    const response = await answerQuestion("Show me the roadmap", "U_REQUESTER");

    expect(response.answer).toContain("I can't share this information with you at the moment");
    expect(response.followUpQuestions).toEqual([]);
    expect(mockGetFileContent).not.toHaveBeenCalled();
    expect(chainHandlers.driveSelection).not.toHaveBeenCalled();
  });
});
