import dotenv from "dotenv";
import { ChatGroq } from "@langchain/groq";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import OnedriveServiceUser from "../../microsoft_api/onedriveServiceUser.js";
import { getTokens } from "../../microsoft_api/tokenManager.js";
import { generateAuthUrl } from "../../microsoft_api/onedriveAuth.js";
import { queryGraphQL } from "../graphql_setup/graphql_client.js";
import {
  buildAccessDeniedMessage,
  annotateFilesWithClassification,
  canAccessClassification,
  filterAccessibleProfiles,
  getClassificationForRole,
  normalizeClassification,
} from "../security/access_control.js";
import {
  upsertDocumentTags,
  getDocumentTags,
} from "../database/documentTagService.js";
import { recommendGitHubUsersForTopic } from "../github/githubService.js";

dotenv.config();

const llm = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "llama-3.1-8b-instant",
});

const GREETING_PATTERN =
  /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)\b/i;

// Helper function to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Helper function to extract JSON object from LLM response
function extractJSON(text) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  // Find whichever comes first — { or [
  const objStart = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");

  let start;
  if (objStart === -1 && arrStart === -1) return null;
  if (objStart === -1) start = arrStart;
  else if (arrStart === -1) start = objStart;
  else start = Math.min(objStart, arrStart);

  const openChar = cleaned[start] === "{" ? "{" : "[";
  const closeChar = cleaned[start] === "{" ? "}" : "]";

  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === openChar) depth++;
    if (cleaned[i] === closeChar) depth--;

    if (depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, i + 1));
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

//All the prompt templates used

//JSON ONLY
const intentPrompt = PromptTemplate.fromTemplate(`
  Classify the intent of this message and return JSON only.

  Message: {message}

  Return one of these JSON formats and only these formats, no explanation:
  - Get all users:        {{"type": "GET_USER", "action": "GET_ALL"}}
  - Search Google Drive:  {{"type": "SEARCH_DRIVE", "query": "<search terms>"}}
  - General question:     {{"type": "GENERAL"}}

  JSON only, no explanation. Information about people is most likely suited to GET_USER (words like anyone, who, or someone may be key), and information about projects or documents is most likely suited to SEARCH_DRIVE (words like project, document, or goal may be useful), but use your judgement based on the content of the message - you are trying to see what you can help with. Only use GENERAL as a last resort.
`);

//Natural Language
const userInformationPrompt = PromptTemplate.fromTemplate(`
    Given the following user information, suggest up to 3 users who may be helpful to answer a question about {topic}.

    User information:
    {userInfo}

    Return JSON only with this exact structure:
    {{"suggestions":[{{"session_id":"<session_id>","name":"<name>","role":"<role>","department":"<department>","reason":"<reason>"}}],"explanation":"<plain language summary>"}}

    Rules:
    - Include only users who seem directly helpful for the topic.
    - Copy session_id exactly from the input userInfo for each suggested user.
    - Provide a one-sentence reason for each recommendation.
    - If there are no helpful users, return {{"suggestions": [], "explanation": "I don't think there are any users that may be helpful to answer this question."}}

    JSON only, no explanation.
`);

//JSON ONLY
const driveSearchPrompt = PromptTemplate.fromTemplate(`
    Given the following search query, suggest ONLY documents that are directly relevant to the topic "{topic}".
    Files in our drive: {files}
    Each file includes: id, name, classification_level, and tags (topic labels).

    Rules:
    - Only include a file if its name or tags clearly match the topic.
    - Do NOT suggest a file just because nothing else is available.
    - If no file is a clear match, return an empty array.

    Return a JSON array with the format: [{{"id": "file.id", "name": "file.name"}}]
    Do not add any text before or after the JSON. JSON only.
`);

//Natural Language
const driveSearchSelectionPrompt = PromptTemplate.fromTemplate(`
  You are a helpful onboarding assistant helping new employees learn about the company.
  
  A user has asked: {topic}
  
  Your job is to distill the most relevant information from the document contents below and provide a helpful, direct answer.
  Using ONLY the document contents below, provide a helpful and direct answer.
  - Summarize the most relevant information clearly
  - If the documents contain project details, team info, or descriptions, share them
  - Do not mention file names or links unless the user specifically asks for them
  - If there is truly no relevant information, say "I don't have enough information about that yet"
  - Keep your answer under 100 words
  
  Document contents:
  {content}
`);

//JSON ONLY — used to auto-classify documents with no existing metadata tags
const autoClassifyPrompt = PromptTemplate.fromTemplate(`
  You are classifying a document for a software team knowledge base.
  File name: {name}
  Content excerpt (first 500 characters): {excerpt}

  Return JSON only with this exact format:
  {{"classification_level": "public|internal|confidential|restricted", "tags": ["tag1", "tag2"]}}

  classification_level rules:
  - public: general info anyone can see
  - internal: standard team docs (default)
  - confidential: senior/technical design docs
  - restricted: management or strategic docs

  tags: up to 5 lowercase topic labels (e.g. "onboarding", "backend", "api", "architecture", "testing")
  JSON only, no explanation.
`);

// Strip markdown code fences that the LLM sometimes wraps around JSON responses
function stripCodeFences(str) {
  return str
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

//JSON ONLY
const followUpQuestionsPrompt = PromptTemplate.fromTemplate(`
    Based on the user's original question and the answer provided, generate 3-5 relevant follow-up questions that would help the user explore related topics or dive deeper into the subject.

    Original Question: {originalQuestion}
    Answer Provided: {answer}
    Intent Type: {intentType}

    Guidelines:
    - Generate questions that are natural extensions of the conversation
    - Make questions specific and actionable
    - Ensure diversity - don't ask similar questions in different ways
    - For user-related queries, suggest questions about other team members or roles
    - For document queries, suggest questions about related topics or deeper aspects
    - Questions should be concise and clear (under 15 words each)
    
    Return ONLY a JSON array of question strings with no explanation, for example:
    ["Question 1 here?", "Question 2 here?", "Question 3 here?"]
`);

//Preemptive suggestion prompt - not fully implemented yet
const preemptivePrompting = PromptTemplate.fromTemplate(`
    Message: {topic}
    Data: {data}
    You are a helpful assistant that has to be prompted to answer direct questions, right now, you are reading the discussions of people and the information that could be used to answer their questions. 
    Your task is to get the user to ask you a question that you can answer with the information you have.
    Please suggest a question that this user might be able to ask you about with the data provided. For example "I see that you're interested in project X, feel free to ask me about it!"
    Keep responses under 20 words max.
    If you cannot make any suggestions based on the content of the message, please say "IDK" and only "IDK".
`);

const threadHistoryPrompt = PromptTemplate.fromTemplate(`
  You are checking if a question can be DIRECTLY answered from previous conversation history.
  
  Message: {message}
  Thread History: {threadHistory}

  Rules:
  - ONLY return threadAnswer: true if the thread history EXPLICITLY contains the answer
  - If the answer is vague, implied, or uncertain — return threadAnswer: false
  - If the thread history is empty — return threadAnswer: false
  - If you are not 100% sure — return threadAnswer: false
  - Answers must be under 40 words

  Return JSON only, no explanation, no markdown:
  
  If answer found:
  {{"threadAnswer": true, "answer": "answer from thread history"}}
  
  If answer NOT found:
  {{"threadAnswer": false}}
`);
//Functions to call the chains and decide what to do with the results

async function parseIntent(message) {
  console.log("parseIntent invoked with message:", message);
  try {
    const result = await intentChain.invoke({ message });
    console.log("Raw intent result:", result);
    try {
      const parsed = extractJSON(result);
      return parsed || { type: "GENERAL" };
    } catch (jsonError) {
      console.warn(
        "Intent parse JSON failed, defaulting GENERAL; result:",
        result,
        jsonError,
      );
      return { type: "GENERAL" };
    }
  } catch (invokeError) {
    console.error("intentChain.invoke failed:", invokeError);
    return { type: "GENERAL" };
  }
}

async function suggestUserForTopic(userInfo, topic) {
  const result = await userInfoChain.invoke({ userInfo, topic });
  console.log("Raw user suggestion result:", result);

  try {
    const parsed = extractJSON(result);
    if (parsed && Array.isArray(parsed.suggestions)) {
      return {
        suggestions: parsed.suggestions,
        explanation: parsed.explanation || result,
      };
    }
  } catch (error) {
    console.warn(
      "User suggestion parse failed, returning raw suggestion text:",
      error,
    );
  }

  return {
    suggestions: [],
    explanation: result,
  };
}

function isGreetingMessage(message) {
  return GREETING_PATTERN.test(String(message || "").trim());
}

function buildGreetingResponse(requesterContext) {
  if (requesterContext?.role) {
    return "Hello! I'm Keystone Bot. Ask me about project documentation or who might be helpful for a topic.";
  }

  return "Hello! I'm Keystone Bot. Complete your profile setup in DM if you'd like access tailored to your role.";
}

async function getRequesterAccessContext(requesterSessionId) {
  if (!requesterSessionId) {
    return {
      session_id: null,
      role: null,
      classification_level: "public",
    };
  }

  try {
    const data = await queryGraphQL(
      `query GetRequesterProfile($session_id: String!) {
        getUserProfile(session_id: $session_id) {
          session_id
          userInfo {
            role
            classification_level
            active_github_repo
          }
        }
      }`,
      { session_id: requesterSessionId },
    );

    const requesterProfile = data?.getUserProfile;
    const requesterInfo = requesterProfile?.userInfo;

    if (!requesterInfo) {
      return {
        session_id: requesterSessionId,
        role: null,
        classification_level: "public",
      };
    }

    return {
      session_id: requesterSessionId,
      role: requesterInfo?.role || null,
      classification_level:
        requesterInfo?.classification_level ||
        getClassificationForRole(requesterInfo?.role),
      active_github_repo: requesterInfo?.active_github_repo || null,
    };
  } catch (error) {
    console.error("Error loading requester access context:", error);
      return {
        session_id: requesterSessionId,
        role: null,
        classification_level: "public",
        active_github_repo: null,
      };
  }
}

/**
 * Uses the LLM to classify a Drive file and assign topic tags.
 * Accepts an optional `_content` string to avoid re-fetching the file.
 * Falls back to 'internal' classification with no tags on failure.
 */
export async function autoClassifyDocument(file, onedrive) {
  try {
    let excerpt;
    if (file._content) {
      excerpt = file._content.slice(0, 500);
    } else {
      if (!onedrive) {
        console.warn(`Auto-classify skipped for "${file.name}": no onedrive instance provided`);
        return { classification_level: "internal", tags: [] };
      }
      const fileBuffer = await onedrive.getFile(file.id);
      const fullContent = fileBuffer.toString('utf-8');
      excerpt = fullContent.slice(0, 500);
    }
    const result = await autoClassifyChain.invoke({
      name: file.name,
      excerpt: excerpt,
    });
    const parsed = extractJSON(result);
    if (parsed) {
      return {
        classification_level: normalizeClassification(
          parsed.classification_level,
        ),
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map((t) => String(t).toLowerCase())
          : [],
      };
    }
  } catch (error) {
    console.warn(`Auto-classify failed for "${file.name}":`, error.message);
  }
  return { classification_level: "internal", tags: [] };
}

/**
 * Enriches an annotated file list with DB-cached or Drive-metadata tags.
 * Files with no tags anywhere get empty tags for now — auto-classification
 * happens lazily only for files actually selected for answering.
 */
function enrichFilesWithTags(annotatedFiles) {
  return annotatedFiles.map((file) => {
    const cached = getDocumentTags(file.id);
    if (cached) {
      return {
        ...file,
        classification_level: cached.classification_level,
        tags: cached.tags,
      };
    }
    if (file.tags.length > 0) {
      upsertDocumentTags(
        file.id,
        file.name,
        file.classification_level,
        file.tags,
        false,
      );
    }
    return file;
  });
}

async function searchDriveForTopic(
  topic,
  requesterContext,
  preemptive = false,
) {
  // Get access token for the requester
  const tokenData = getTokens(requesterContext.session_id);
  if (!tokenData || !tokenData.access_token) {
    console.error("No access token found for user:", requesterContext.session_id);
    const authUrl = generateAuthUrl(requesterContext.session_id);
    return `I need permission to access your documents. Please authenticate here: ${authUrl}`;
  }

  const onedrive = new OnedriveServiceUser(tokenData.access_token);

  try {
    const files = await onedrive.listFiles();
    // Annotate with Drive metadata first, then override with DB values (DB takes priority)
    const annotated = annotateFilesWithClassification(files);
    const enriched = enrichFilesWithTags(annotated);
    // Filter using the final classification (DB-overridden values)
    const enrichedFiles = enriched.filter((file) =>
      canAccessClassification(
        requesterContext.classification_level,
        file.classification_level,
      ),
    );

    if (enrichedFiles.length === 0) {
      return buildAccessDeniedMessage(topic);
    }

    const fileSuggestionsString = await driveSearchChain.invoke({
      files: JSON.stringify(
        enrichedFiles.map((f) => ({
          id: f.id,
          name: f.name,
          classification_level: f.classification_level,
          tags: f.tags,
        })),
      ),
      topic,
    });

    let fileSuggestions;
    try {
      fileSuggestions = extractJSON(fileSuggestionsString);
    } catch (error) {
      console.error("Error parsing file suggestions JSON:", error);
      return "Sorry, I couldn't find relevant information in our documents.";
    }

    if (!Array.isArray(fileSuggestions) || fileSuggestions.length === 0) {
      return "Sorry, I couldn't find relevant information in our documents.";
    }

    const enrichedFilesById = new Map(
      enrichedFiles.map((file) => [file.id, file]),
    );
    const authorizedSuggestions = fileSuggestions
      .map((file) => enrichedFilesById.get(file.id))
      .filter(Boolean);

    if (authorizedSuggestions.length === 0) {
      return buildAccessDeniedMessage(topic);
    }

    try {
      const fileContents = await Promise.all(
        authorizedSuggestions.map(async (file) => {
          try {
            const fileBuffer = await onedrive.getFile(file.id);
            const content = fileBuffer.toString('utf-8');

            // Auto-classify selected files that have no tags yet, caching for future queries
            if (!getDocumentTags(file.id)) {
              console.log(`Auto-classifying "${file.name}"...`);
              const { classification_level, tags } = await autoClassifyDocument(
                {
                  ...file,
                  _content: content,
                },
                onedrive,
              );
              upsertDocumentTags(
                file.id,
                file.name,
                classification_level,
                tags,
                true,
              );
            }

            return `File: ${file.name}\nClassification: ${file.classification_level}\nTags: ${file.tags.join(", ")}\n\n${content}`;
          } catch (error) {
            console.error(`Error reading file ${file.id}:`, error);
            return `Error reading file: ${error.message}`;
          }
        }),
      );
      console.log("Retrieved file contents:", fileContents);
      if (!preemptive) {
        return await answerDriveSearchQuestion(fileContents, topic);
      } else {
        console.log("Invoking preemptive prompting chain with file contents");
        return await preemptivePromptingChain.invoke({
          topic: topic,
          data: fileContents,
        });
      }
    } catch (error) {
      console.error("Error retrieving file contents:", error);
      return "Sorry, I couldn't retrieve the documents from our drive.";
    }
  } catch (error) {
    console.error("Error listing files from OneDrive:", error);
    return "Sorry, I couldn't access your documents. Please try again later.";
  }
}

async function answerDriveSearchQuestion(fileContents, topic) {
  try {
    console.log(
      "FileContents being sent to driveSearchSelectionChain:",
      fileContents,
    );
    const finalAnswer = await driveSearchSelectionChain.invoke({
      content: fileContents,
      topic,
    });
    console.log("Final answer from driveSearchSelectionChain:", finalAnswer);
    if (finalAnswer.trim() === "IDK") {
      return "Sorry, I couldn't find relevant information in our documents.";
    } else {
      return finalAnswer;
    }
  } catch (error) {
    console.error("Error invoking driveSearchSelectionChain:", error);
    return "Sorry, I couldn't process the information from the documents.";
  }
}

async function generateFollowUpQuestions(originalQuestion, answer, intentType) {
  try {
    console.log("Generating follow-up questions for:", originalQuestion);
    const result = await followUpQuestionsChain.invoke({
      originalQuestion,
      answer,
      intentType,
    });
    console.log("Raw follow-up questions result:", result);

    try {
      const questions = extractJSON(result);
      console.log("Parsed follow-up questions:", questions);
      if (Array.isArray(questions) && questions.length > 0) {
        // Limit to 5 questions max
        return questions.slice(0, 5);
      }
      console.warn(
        "Follow-up questions not in expected format, returning empty array",
      );
      return [];
    } catch (jsonError) {
      console.error("Error parsing follow-up questions JSON:", jsonError);
      return [];
    }
  } catch (error) {
    console.error("Error generating follow-up questions:", error);
    return [];
  }
}

//Chains for llm interactions
const intentChain = intentPrompt.pipe(llm).pipe(new StringOutputParser());
const userInfoChain = userInformationPrompt
  .pipe(llm)
  .pipe(new StringOutputParser());
const driveSearchChain = driveSearchPrompt
  .pipe(llm)
  .pipe(new StringOutputParser());
const driveSearchSelectionChain = driveSearchSelectionPrompt
  .pipe(llm)
  .pipe(new StringOutputParser());
const autoClassifyChain = autoClassifyPrompt
  .pipe(llm)
  .pipe(new StringOutputParser());
const followUpQuestionsChain = followUpQuestionsPrompt
  .pipe(llm)
  .pipe(new StringOutputParser());
const preemptivePromptingChain = preemptivePrompting
  .pipe(llm)
  .pipe(new StringOutputParser());
const threadHistoryChain = threadHistoryPrompt
  .pipe(llm)
  .pipe(new StringOutputParser());

//Main function to decide what to do with a message based on the parsed intent
export async function answerQuestion(
  message,
  requesterSessionId = null,
  preemptive = false,
  threadHistory = [],
) {
  try {
    const requesterContext =
      await getRequesterAccessContext(requesterSessionId);

    if (isGreetingMessage(message)) {
      return buildGreetingResponse(requesterContext);
    }

    if (threadHistory.length > 0) {
      const threadHistoryResult = await threadHistoryChain.invoke({
        message,
        threadHistory: JSON.stringify(threadHistory),
      });
      console.log("Thread history chain result:", threadHistoryResult);
      try {
        const parsedThreadResult = extractJSON(threadHistoryResult);

        if (parsedThreadResult?.threadAnswer) {
          const ans = { answer: parsedThreadResult?.answer };
          console.log("Answer found in thread history", ans);
          return ans;
        }
      } catch (error) {
        console.warn(
          "Error parsing thread history chain result, proceeding with normal flow:",
          error,
        );
      }
    }

    const intent = await parseIntent(message);
    console.log("Parsed intent:", intent);
    if (preemptive && intent.type == "GENERAL") {
      return;
    }

    let answer = "";
    let intentType = "";
    let suggestedUsers = [];
    let githubSyncContext = null;

    //This takes care of all user information retrieval
    if (intent.type === "GET_USER" || intent.action === "GET_USER") {
      const data = await queryGraphQL(`{
  getAllUserProfiles {
    id
    session_id
    userInfo {
      name
      email
      github_username
      role
      classification_level
      experience_level
      department
    }
    hasCompletedIntake
  }
}`);
      const allProfiles = data?.getAllUserProfiles || [];
      const accessibleProfiles = filterAccessibleProfiles(
        allProfiles.filter(
          (profile) =>
            profile?.hasCompletedIntake &&
            profile?.session_id !== requesterSessionId,
        ),
        requesterContext.classification_level,
      );

      if (!preemptive) {
        const githubRecommendations = recommendGitHubUsersForTopic(
          message,
          accessibleProfiles,
          3,
          requesterContext.active_github_repo,
        );

        if (githubRecommendations.suggestedUsers.length > 0) {
          answer = githubRecommendations.answer;
          suggestedUsers = githubRecommendations.suggestedUsers;
          githubSyncContext = githubRecommendations.syncContext || null;
        } else if (githubRecommendations.answer) {
          answer = githubRecommendations.answer;
          githubSyncContext = githubRecommendations.syncContext || null;
        } else if (accessibleProfiles.length === 0) {
          answer = buildAccessDeniedMessage(message);
        } else {
          console.log(
            "Accessible users:",
            JSON.stringify(accessibleProfiles, null, 2),
          );
          const suggestionResult = await suggestUserForTopic(
            JSON.stringify(accessibleProfiles, null, 2),
            message,
          );
          answer = suggestionResult.explanation;
          suggestedUsers = suggestionResult.suggestions || [];
        }
      } else if (accessibleProfiles.length === 0) {
        answer = buildAccessDeniedMessage(message);
      } else {
        answer = await preemptivePromptingChain.invoke({
          topic: message,
          data: JSON.stringify(accessibleProfiles, null, 2),
        });
      }
      console.log("User suggestion:", answer);
      intentType = "GET_USER";

      //This takes care of searching Google Drive
    } else if (
      intent.type === "SEARCH_DRIVE" ||
      intent.action === "SEARCH_DRIVE"
    ) {
      console.log("Searching drive for topic:", intent.query);
      answer = await searchDriveForTopic(
        intent.query,
        requesterContext,
        preemptive,
      );
      intentType = "SEARCH_DRIVE";
    } else {
      answer =
        "Sorry, there is no documentation available for that topic and cannot reliably give you information. Please ask about a different topic or try rephrasing your question.";
      intentType = "GENERAL";
    }

    // Generate follow-up questions
    let followUpQuestions = null;
    if (!preemptive) {
      followUpQuestions = await generateFollowUpQuestions(
        message,
        answer,
        intentType,
      );
    }
    // Return object with answer, follow-up questions, and any structured user suggestions
    return {
      answer,
      followUpQuestions,
      suggestedUsers,
      githubSyncContext,
    };
  } catch (error) {
    console.error("Error in answerQuestion:", error);
    return {
      answer:
        "Sorry, I couldn't understand your question. Please try rephrasing it.",
      followUpQuestions: [],
      suggestedUsers: [],
      githubSyncContext: null,
    };
  }
}
