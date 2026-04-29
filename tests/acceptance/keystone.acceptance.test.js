import { Readable } from "node:stream";
import { jest } from "@jest/globals";

const mockListFiles = jest.fn();
const mockGetFile = jest.fn();
const mockGetFileContent = jest.fn();
const mockGetOne = jest.fn();
const mockGetAll = jest.fn();
const mockGetDocumentTags = jest.fn();
const mockUpsertDocumentTags = jest.fn();
const mockRecommendGitHubUsersForTopic = jest.fn();

const chainHandlers = {
  intent: jest.fn(),
  userInfo: jest.fn(),
  driveSearch: jest.fn(),
  driveSelection: jest.fn(),
  autoClassify: jest.fn(),
  followUpQuestions: jest.fn(),
  threadHistory: jest.fn(),
  webQuery: jest.fn(),
  webSummary: jest.fn(),
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
    return jest.fn().mockResolvedValue('{"confidence":90,"reason":"Relevant"}');
  }
  if (template.includes("classifying a document for a software team")) {
    return chainHandlers.autoClassify;
  }
  if (template.includes("generate up to 3 relevant follow-up questions")) {
    return chainHandlers.followUpQuestions;
  }
  if (template.includes("DIRECTLY answered from previous conversation history")) {
    return chainHandlers.threadHistory;
  }
  if (template.includes("Generate a concise web search query")) {
    return chainHandlers.webQuery;
  }
  if (template.includes("synthesize a helpful answer")) {
    return chainHandlers.webSummary;
  }

  return jest.fn().mockResolvedValue("IDK");
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

await jest.unstable_mockModule("../../logic/graphql_setup/graphql_client.js", () => ({
  queryGraphQL: jest.fn(),
}));

await jest.unstable_mockModule("../../logic/database/sqlite.js", () => ({
  getOne: mockGetOne,
  getAll: mockGetAll,
  initDatabase: jest.fn(),
}));

await jest.unstable_mockModule("../../logic/database/documentTagService.js", () => ({
  getDocumentTags: mockGetDocumentTags,
  upsertDocumentTags: mockUpsertDocumentTags,
}));

await jest.unstable_mockModule("../../logic/github/githubService.js", () => ({
  recommendGitHubUsersForTopic: mockRecommendGitHubUsersForTopic,
}));

const { answerQuestion } = await import("../../logic/langChain/rag_implementation.js");

function mockRequesterContext({
  profileId = 1,
  role = "junior_dev",
  classification = "internal",
  activeRepo = null,
} = {}) {
  mockGetOne
    .mockReturnValueOnce({ id: profileId })
    .mockReturnValueOnce({
      role,
      classification_level: classification,
      active_github_repo: activeRepo,
    });
}

function readableText(text) {
  return Readable.from([Buffer.from(text)]);
}

beforeEach(() => {
  jest.clearAllMocks();

  mockListFiles.mockResolvedValue([]);
  mockGetFile.mockResolvedValue(readableText("document content"));
  mockGetFileContent.mockResolvedValue({
    stream: readableText("document content"),
    format: "text",
  });
  mockGetAll.mockReturnValue([]);
  mockGetDocumentTags.mockReturnValue(null);
  mockUpsertDocumentTags.mockReturnValue(undefined);
  mockRecommendGitHubUsersForTopic.mockReturnValue({
    answer: null,
    suggestedUsers: [],
  });

  chainHandlers.intent.mockResolvedValue('{"type":"SEARCH_DRIVE","query":"onboarding process"}');
  chainHandlers.userInfo.mockResolvedValue('{"suggestions":[],"explanation":"No matching users."}');
  chainHandlers.driveSearch.mockResolvedValue("[]");
  chainHandlers.driveSelection.mockResolvedValue("I don't have enough information about that yet");
  chainHandlers.autoClassify.mockResolvedValue('{"classification_level":"internal","tags":["onboarding"]}');
  chainHandlers.followUpQuestions.mockResolvedValue("[]");
  chainHandlers.threadHistory.mockResolvedValue('{"threadAnswer":false}');
  chainHandlers.webQuery.mockResolvedValue("software team onboarding");
  chainHandlers.webSummary.mockResolvedValue("External summary");
});

describe("Keystone automated acceptance tests", () => {
  it("F-1/F-4 answers an internal documentation question and returns follow-up questions", async () => {
    mockRequesterContext();
    mockListFiles.mockResolvedValue([
      {
        id: "doc-onboarding",
        name: "Engineering-Onboarding.md",
        description: "classification: internal | tags: onboarding, developer",
        mimeType: "text/plain",
      },
    ]);
    mockGetDocumentTags.mockReturnValue({
      classification_level: "internal",
      tags: ["onboarding", "developer"],
    });
    chainHandlers.driveSearch.mockResolvedValue(
      '[{"id":"doc-onboarding","name":"Engineering-Onboarding.md"}]',
    );
    mockGetFileContent.mockResolvedValue({
      stream: readableText("New developers should complete setup, read the architecture overview, and join the project Slack channels."),
      format: "text",
    });
    chainHandlers.driveSelection.mockResolvedValue(
      "New developers should complete setup, read the architecture overview, and join the project Slack channels.",
    );
    chainHandlers.followUpQuestions.mockResolvedValue(
      '["What should I set up first?","Who can help with onboarding?"]',
    );

    const result = await answerQuestion(
      "What is the onboarding process for new developers?",
      "U_NEW_USER",
    );

    expect(result.answer).toContain("New developers should complete setup");
    expect(result.followUpQuestions).toEqual([
      "What should I set up first?",
      "Who can help with onboarding?",
    ]);
  });

  it("F-2 offers web search when no internal documentation matches", async () => {
    mockRequesterContext();
    mockListFiles.mockResolvedValue([
      {
        id: "doc-handbook",
        name: "Engineering-Handbook.md",
        description: "classification: internal | tags: standards",
        mimeType: "text/plain",
      },
    ]);
    mockGetDocumentTags.mockReturnValue({
      classification_level: "internal",
      tags: ["standards"],
    });
    chainHandlers.intent.mockResolvedValue(
      '{"type":"SEARCH_DRIVE","query":"third party library usage"}',
    );
    chainHandlers.driveSearch.mockResolvedValue("[]");

    const result = await answerQuestion(
      "How do I use this third party library?",
      "U_NEW_USER",
    );

    expect(result.answer).toEqual({
      internal: "Sorry, I couldn't find relevant information in our internal documents.",
      offerWeb: true,
      query: "third party library usage",
    });
  });

  it("F-5 recommends a relevant team member for a topic", async () => {
    mockRequesterContext({
      activeRepo: "Capstone-Projects-2026-spring/project-rag-model-team",
    });
    mockGetAll.mockReturnValue([{ id: 2, session_id: "U_AUTH" }]);
    mockGetOne.mockReturnValueOnce({
      name: "Alex Auth",
      email: "alex@example.com",
      github_username: "alexauth",
      role: "senior_dev",
      classification_level: "internal",
      experience_level: "senior",
      department: "Platform",
    });
    mockRecommendGitHubUsersForTopic.mockReturnValue({
      answer: "Alex Auth is a strong reference for authentication work.",
      suggestedUsers: [
        {
          session_id: "U_AUTH",
          name: "Alex Auth",
          role: "senior_dev",
          department: "Platform",
          github_username: "alexauth",
          reason: "Worked on authentication-related files.",
        },
      ],
      syncContext: {
        repoFullName: "Capstone-Projects-2026-spring/project-rag-model-team",
      },
    });
    chainHandlers.userInfo.mockResolvedValue(
      '{"suggestions":[{"session_id":"U_AUTH","name":"Alex Auth","role":"senior_dev","department":"Platform","reason":"Profile context matches authentication."}],"explanation":"Alex can help."}',
    );

    const result = await answerQuestion("Who can help with auth?", "U_NEW_USER");

    expect(result.answer).toContain("Alex Auth");
    expect(result.suggestedUsers[0]).toEqual(
      expect.objectContaining({
        session_id: "U_AUTH",
        github_username: "alexauth",
      }),
    );
  });

  it("NF-3/NF-4 prevents unauthorized users from receiving restricted documentation", async () => {
    mockRequesterContext({
      role: "junior_dev",
      classification: "internal",
    });
    mockListFiles.mockResolvedValue([
      {
        id: "doc-roadmap",
        name: "Manager-Roadmap.md",
        description: "classification: restricted | tags: roadmap, strategy",
        mimeType: "text/plain",
      },
    ]);
    mockGetDocumentTags.mockReturnValue({
      classification_level: "restricted",
      tags: ["roadmap", "strategy"],
    });
    chainHandlers.intent.mockResolvedValue(
      '{"type":"SEARCH_DRIVE","query":"manager roadmap"}',
    );

    const result = await answerQuestion(
      "What is in the manager roadmap?",
      "U_NEW_USER",
    );

    expect(result.answer).toContain("current access level");
    expect(result.answer).not.toContain("roadmap, strategy");
    expect(chainHandlers.driveSearch).not.toHaveBeenCalled();
  });
});
