import dotenv from "dotenv";
import { ChatGroq } from "@langchain/groq";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { listFiles, getFile, getFileContent } from "../../google_api/driveService.js";
import { queryGraphQL } from "../graphql_setup/graphql_client.js";
import { getOne, getAll } from "../database/sqlite.js";
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
import {
  searchWeb,
  searchAndFetchWeb,
} from "../webSearchService.js";
import {
  webSearchQueryPrompt as webSearchQueryTemplate,
  webContentSummarizationPrompt as webSummarizationTemplate,
  formatWebContentForLLM,
  createWebSourceAttribution,
} from "../webSearchPrompts.js";

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

// Converts a stream to text, routing binary formats through the right parser
async function streamToText(stream, format) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  if (format === "application/pdf") {
    const { default: pdfParse } = await import("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (format === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString("utf8");
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

  JSON only, no explanation. 
  
  Guidelines:
  - GET_USER: Questions about people, team members, or expertise (keywords: who, anyone, person, team lead, expert, contact)
  - SEARCH_DRIVE: Most other questions about information, topics, concepts, or documentation (keywords: information, documentation, how to, what is, explain, tell me about, do you have, find, search, look up, or any knowledge question)
  - GENERAL: Only use as a last resort if the message is off-topic, unclear, or not a question
  
  Treat most questions as potential documentation searches so we can offer web search if internal docs don't exist.
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
    Search query: "{topic}"
    Files available: {files}

    Return ONLY the files whose name or tags directly match the search query.
    Rules:
    - "Security-Policy", "Engineering-Handbook", "Architecture-Overview" do NOT match queries about specific projects, teams, or onboarding topics unless the query explicitly asks about security, architecture, or engineering standards.
    - A file named "project-gamma" or "project king dedede" DOES match a query about projects or those specific projects.
    - Do NOT include a file just because nothing else matches — return [] if nothing is relevant.
    - Return each file at most once (no duplicates).

    Return a JSON array: [{{"id": "file.id", "name": "file.name"}}]
    JSON only, no explanation.
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

//JSON ONLY - Confidence scoring
const confidenceCheckPrompt = PromptTemplate.fromTemplate(`
You are evaluating whether a set of documents adequately answer a user's question.

User's Question: {question}
Documents Retrieved: {documents}

Rate your CONFIDENCE (0-100) that these documents actually answer the user's question.

Return ONLY a JSON object with this format:
{{"confidence": <number 0-100>, "reason": "<brief reason>"}}

Guidelines:
- 80-100: Documents directly answer the question with specific information
- 50-79: Documents tangentially relate but don't fully address the question
- 20-49: Documents are only loosely related
- 0-19: Documents don't address the question at all

Be strict. If the documents are about a project but don't explain the topic the user asked about, rate it low.
`);

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

// Web Search Prompts
const webSearchQueryPrompt = PromptTemplate.fromTemplate(webSearchQueryTemplate);
const webContentSummarizationPrompt = PromptTemplate.fromTemplate(webSummarizationTemplate);
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

function isStandaloneConfirmation(message) {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'no';
}

function buildGreetingResponse(requesterContext) {
  if (requesterContext?.role) {
    return "Hello! I'm Keystone Bot. Ask me about project documentation or who might be helpful for a topic.";
  }

  return "Hello! I'm Keystone Bot. Complete your profile setup in DM if you'd like access tailored to your role.";
}

function getRequesterAccessContext(requesterSessionId) {
  if (!requesterSessionId) {
    return { session_id: null, role: null, classification_level: "public", active_github_repo: null };
  }
  try {
    const profile = getOne(
      `SELECT id FROM user_profiles WHERE session_id = ?`,
      [requesterSessionId],
    );
    if (!profile) {
      return { session_id: requesterSessionId, role: null, classification_level: "public", active_github_repo: null };
    }
    const info = getOne(`SELECT role, classification_level, active_github_repo FROM user_info WHERE profile_id = ?`, [profile.id]);
    if (!info) {
      return { session_id: requesterSessionId, role: null, classification_level: "public", active_github_repo: null };
    }
    return {
      session_id: requesterSessionId,
      role: info.role || null,
      classification_level: info.classification_level || getClassificationForRole(info.role),
      active_github_repo: info.active_github_repo || null,
    };
  } catch (error) {
    console.error("Error loading requester access context:", error);
    return { session_id: requesterSessionId, role: null, classification_level: "public", active_github_repo: null };
  }
}

/**
 * Uses the LLM to classify a Drive file and assign topic tags.
 * Accepts an optional `_content` string to avoid re-fetching the file.
 * Falls back to 'internal' classification with no tags on failure.
 */
export async function autoClassifyDocument(file) {
  try {
    let excerpt;
    if (file._content) {
      excerpt = file._content.slice(0, 500);
    } else {
      const stream = await getFile(file.id);
      const fullContent = await streamToString(stream);
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

/**
 * Search the web and synthesize results into an answer
 * @param {string} originalQuestion - User's original question
 * @returns {Promise<Object>} Object with { answer, sources, isWebResult: true }
 */
async function searchWebForTopic(originalQuestion) {
  try {
    console.log("Searching web for:", originalQuestion);
    
    // Generate an optimized search query
    const searchQuery = await webSearchQueryChain.invoke({ userQuestion: originalQuestion });
    console.log("Generated search query:", searchQuery);

    // Search and fetch web content
    const webResults = await searchAndFetchWeb(searchQuery.trim(), 3);
    console.log(`Fetched ${webResults.length} web results`);
    
    if (!webResults || webResults.length === 0) {
      console.warn("No web results found");
      return {
        answer: "Sorry, I couldn't find relevant information online either.",
        sources: [],
        isWebResult: true,
      };
    }

    // Format web content for LLM
    const formattedContent = formatWebContentForLLM(webResults);
    console.log("Formatted content length:", formattedContent.length);
    
    // Summarize web content into answer
    console.log("Invoking webContentSummarizationChain...");
    const synthesizedAnswer = await webContentSummarizationChain.invoke({
      userQuestion: originalQuestion,
      webContent: formattedContent,
    });
    console.log("Synthesized answer length:", synthesizedAnswer.length);
    console.log("Synthesized answer:", synthesizedAnswer.substring(0, 200));

    // Create source attribution
    const sourceAttribution = createWebSourceAttribution(webResults);
    console.log("Source attribution:", sourceAttribution);

    const finalAnswer = `${synthesizedAnswer}\n\n${sourceAttribution}`;
    console.log("Final answer length:", finalAnswer.length);

    return {
      answer: finalAnswer,
      sources: webResults,
      isWebResult: true,
    };
  } catch (error) {
    console.error("Web search error:", error.message);
    console.error("Full error:", error);
    return {
      answer: "Sorry, I couldn't search online at this time. Please try rephrasing your question.",
      sources: [],
      isWebResult: true,
    };
  }
}

/**
 * Marker object to indicate no internal results found
 */
const NO_INTERNAL_RESULTS = Symbol('NO_INTERNAL_RESULTS');

async function searchDriveForTopic(
  topic,
  requesterContext,
  preemptive = false,
) {
  const files = await listFiles();
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
    return NO_INTERNAL_RESULTS;
  }

  const enrichedFilesById = new Map(
    enrichedFiles.map((file) => [file.id, file]),
  );
  const seenIds = new Set();
  const authorizedSuggestions = fileSuggestions
    .map((file) => enrichedFilesById.get(file.id))
    .filter((file) => {
      if (!file || seenIds.has(file.id)) return false;
      seenIds.add(file.id);
      return true;
    });

  if (authorizedSuggestions.length === 0) {
    return buildAccessDeniedMessage(topic);
  }

  try {
    const fileContents = await Promise.all(
      authorizedSuggestions.map(async (file) => {
        try {
          const { stream, format } = await getFileContent(file.id, file.mimeType);
          const content = await streamToText(stream, format);

          // Auto-classify selected files that have no tags yet, caching for future queries
          if (!getDocumentTags(file.id)) {
            console.log(`Auto-classifying "${file.name}"...`);
            const { classification_level, tags } = await autoClassifyDocument({
              ...file,
              _content: content,
            });
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
      const preemptiveResult = await preemptivePromptingChain.invoke({
        topic: topic,
        data: fileContents});
      
      // Apply full relevance check to preemptive mode too
      const trimmedResult = preemptiveResult.trim();
      
      if (trimmedResult === "IDK" || trimmedResult.toLowerCase().includes("don't know")) {
        return NO_INTERNAL_RESULTS;
      }
      
      // Check if mostly questions
      const questionCount = (trimmedResult.match(/\?/g) || []).length;
      const isMainlyQuestions = questionCount > 1 && trimmedResult.length < (questionCount * 50);
      if (isMainlyQuestions) {
        console.log(`Preemptive answer is mostly questions: offering web search`);
        return NO_INTERNAL_RESULTS;
      }
      
      // Check keyword relevance
      const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const answerLower = trimmedResult.toLowerCase();
      const topicMatches = topicWords.filter(word => answerLower.includes(word)).length;
      const matchPercentage = topicMatches / Math.max(topicWords.length, 1);
      
      if (matchPercentage < 0.5 && topicWords.length > 1) {
        console.log(`Low relevance in preemptive (${Math.round(matchPercentage * 100)}%): offering web search`);
        return NO_INTERNAL_RESULTS;
      }
      
      return preemptiveResult;
    }
  } catch (error) {
    console.error("Error retrieving file contents:", error);
    return "Sorry, I couldn't retrieve the documents from our drive.";
  }
}

async function answerDriveSearchQuestion(fileContents, topic) {
  try {
    const finalAnswer = await driveSearchSelectionChain.invoke({ content: fileContents, topic });
    const trimmedAnswer = finalAnswer.trim();

    if (
      trimmedAnswer === "IDK" ||
      trimmedAnswer.toLowerCase().includes("don't have enough information") ||
      trimmedAnswer.toLowerCase().includes("cannot find")
    ) {
      return NO_INTERNAL_RESULTS;
    }

    return finalAnswer;
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
      // Extract the first valid JSON array from the result
      // Sometimes LLM returns multiple arrays, we only want the first one
      const jsonMatch = result.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        console.warn("No JSON array found in follow-up questions result");
        return [];
      }
      
      const questions = JSON.parse(jsonMatch[0]);
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
const userInfoChain = userInformationPrompt.pipe(llm).pipe(new StringOutputParser());
const driveSearchChain = driveSearchPrompt.pipe(llm).pipe(new StringOutputParser());
const driveSearchSelectionChain = driveSearchSelectionPrompt.pipe(llm).pipe(new StringOutputParser());
const autoClassifyChain = autoClassifyPrompt.pipe(llm).pipe(new StringOutputParser());
const confidenceCheckChain = confidenceCheckPrompt.pipe(llm).pipe(new StringOutputParser());
const followUpQuestionsChain = followUpQuestionsPrompt.pipe(llm).pipe(new StringOutputParser());
const preemptivePromptingChain = preemptivePrompting.pipe(llm).pipe(new StringOutputParser());
const threadHistoryChain = threadHistoryPrompt.pipe(llm).pipe(new StringOutputParser());
const webSearchQueryChain = webSearchQueryPrompt.pipe(llm).pipe(new StringOutputParser());
const webContentSummarizationChain = webContentSummarizationPrompt.pipe(llm).pipe(new StringOutputParser());

//Main function to decide what to do with a message based on the parsed intent
export async function answerQuestion(
  message,
  requesterSessionId = null,
  preemptive = false,
  threadHistory = [],
  setStatus = async () => {},
) {
  try {
    const requesterContext = getRequesterAccessContext(requesterSessionId);

    if (isGreetingMessage(message)) {
      return buildGreetingResponse(requesterContext);
    }

    if (isStandaloneConfirmation(message)) {
      if (preemptive) {
        return;
      }

      const normalized = String(message || '').trim().toLowerCase();
      if (normalized === 'no') {
        return {
          answer: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
          followUpQuestions: []
        };
      }

      return {
        answer: 'If you are responding to a web-search prompt, reply with yes/no directly in that thread. Otherwise, please ask a full question so I can help.',
        followUpQuestions: []
      };
    }

    if (threadHistory.length > 0) {
      await setStatus({
        status: "Checking conversation history…",
        loading_messages: [
          "Skimming through the chat logs…",
          "Checking if we've been here before…",
        ],
      });
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
    await setStatus({
      status: "Thinking…",
      loading_messages: [
        "Teaching the hamsters to type faster…",
        "Untangling the internet cables…",
        "Consulting the office goldfish…",
        "Polishing up the response just for you…",
        "Convincing the AI to stop overthinking…",
      ],
    });
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
      await setStatus({
        status: "Looking up the team…",
        loading_messages: [
          "Flipping through the employee directory…",
          "Asking around the virtual watercooler…",
          "Checking who knows what around here…",
        ],
      });
      const profileRows = getAll(`SELECT id, session_id FROM user_profiles`);
      const allProfiles = profileRows.map((p) => {
        const info = getOne(`SELECT name, email, github_username, role, classification_level, experience_level, department FROM user_info WHERE profile_id = ?`, [p.id]);
        return { id: p.id, session_id: p.session_id, userInfo: info || null, hasCompletedIntake: !!info };
      });

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
      await setStatus({
        status: "Searching the docs…",
        loading_messages: [
          "Digging through the filing cabinet…",
          "Reading every doc so you don't have to…",
          "Ctrl+F but make it AI…",
        ],
      });
      console.log("Searching drive for topic:", intent.query);
      const driveResult = await searchDriveForTopic(
        intent.query,
        requesterContext,
        preemptive,
      );
      
      // If no internal results, offer web search
      if (driveResult === NO_INTERNAL_RESULTS) {
        answer = {
          internal: "Sorry, I couldn't find relevant information in our internal documents.",
          offerWeb: true,
          query: intent.query,
        };
      } else {
        answer = driveResult;
      }
      intentType = "SEARCH_DRIVE";
    } else {
      answer =
        "Sorry, there is no documentation available for that topic and cannot reliably give you information. Please ask about a different topic or try rephrasing your question.";
      intentType = "GENERAL";
    }

    // Generate follow-up questions
    let followUpQuestions = null;
    if (!preemptive) {
      await setStatus({
        status: "Wrapping up…",
        loading_messages: [
          "Thinking of good follow-up questions…",
          "Putting a bow on it…",
        ],
      });
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

// Export web search utilities for use in index.js (thread listener)
export { NO_INTERNAL_RESULTS, searchWebForTopic };
