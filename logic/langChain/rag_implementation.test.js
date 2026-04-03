import { Readable } from "node:stream";
import { jest } from "@jest/globals";

const mockQueryGraphQL = jest.fn();
const mockListFiles = jest.fn();
const mockGetFile = jest.fn();

const mockGetDocumentTags = jest.fn();
const mockUpsertDocumentTags = jest.fn();

const chainHandlers = {
  intent: jest.fn(),
  userInfo: jest.fn(),
  driveSearch: jest.fn(),
  driveSelection: jest.fn(),
  autoClassify: jest.fn(),
  followUpQuestions: jest.fn(),
};

function getChainHandler(template) {
  if (template.includes("Classify the intent of this message")) {
    return chainHandlers.intent;
  }

  if (template.includes("Given the following user information")) {
    return chainHandlers.userInfo;
  }

  if (template.includes("suggest ONLY documents that are directly relevant")) {
    return chainHandlers.driveSearch;
  }

  if (template.includes("distill the most relevant information")) {
    return chainHandlers.driveSelection;
  }

  if (template.includes("classifying a document for a software team")) {
    return chainHandlers.autoClassify;
  }

  if (template.includes("generate 3-5 relevant follow-up questions")) {
    return chainHandlers.followUpQuestions;
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
}));

await jest.unstable_mockModule("../graphql_setup/graphql_client.js", () => ({
  queryGraphQL: mockQueryGraphQL,
}));

await jest.unstable_mockModule("../database/documentTagService.js", () => ({
  getDocumentTags: mockGetDocumentTags,
  upsertDocumentTags: mockUpsertDocumentTags,
}));

const { answerQuestion } = await import("./rag_implementation.js");

beforeEach(() => {
  jest.clearAllMocks();

  chainHandlers.intent.mockResolvedValue('{"type":"GENERAL"}');
  chainHandlers.userInfo.mockResolvedValue("No matching users.");
  chainHandlers.driveSearch.mockResolvedValue("[]");
  chainHandlers.driveSelection.mockResolvedValue("IDK");
  chainHandlers.autoClassify.mockResolvedValue('{"classification_level":"internal","tags":[]}');
  // Default: files not yet in DB, so enrichment triggers auto-classify
  mockGetDocumentTags.mockReturnValue(null);
  mockUpsertDocumentTags.mockReturnValue(undefined);
});

describe("answerQuestion access filtering", () => {
  it("returns a greeting response without sending greetings through the RAG prompt flow", async () => {
    mockQueryGraphQL.mockResolvedValueOnce({
      getUserProfile: null,
    });

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

    mockQueryGraphQL
      .mockResolvedValueOnce({
        getUserProfile: {
          session_id: "U_REQUESTER",
          userInfo: {
            role: "junior_dev",
            classification_level: "internal",
          },
        },
      })
      .mockResolvedValueOnce({
        getAllUserProfiles: [
          {
            id: "0",
            session_id: "U_REQUESTER",
            hasCompletedIntake: true,
            userInfo: {
              name: "Kidus",
              role: "mid_dev",
              classification_level: "internal",
              department: "Design",
            },
          },
          {
            id: "1",
            session_id: "U_INTERNAL",
            hasCompletedIntake: true,
            userInfo: {
              name: "Alex Internal",
              role: "mid_dev",
              classification_level: "internal",
              department: "Engineering",
            },
          },
          {
            id: "2",
            session_id: "U_RESTRICTED",
            hasCompletedIntake: true,
            userInfo: {
              name: "Morgan Manager",
              role: "manager",
              classification_level: "restricted",
              department: "Leadership",
            },
          },
        ],
      });

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

    mockQueryGraphQL.mockResolvedValueOnce({
      getUserProfile: {
        session_id: "U_REQUESTER",
        userInfo: {
          role: "junior_dev",
          classification_level: "internal",
        },
      },
    });

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

    mockGetFile.mockResolvedValue(
      Readable.from([Buffer.from("Visible architecture content")]),
    );

    const response = await answerQuestion(
      "Show me the architecture docs",
      "U_REQUESTER",
    );

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

    mockQueryGraphQL.mockResolvedValueOnce({
      getUserProfile: {
        session_id: "U_REQUESTER",
        userInfo: {
          role: "junior_dev",
          classification_level: "internal",
        },
      },
    });

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

    expect(response.answer).toContain("does not allow me to share");
    expect(response.followUpQuestions).toEqual([]);
    expect(mockGetFile).not.toHaveBeenCalled();
    expect(chainHandlers.driveSelection).not.toHaveBeenCalled();
  });
});
