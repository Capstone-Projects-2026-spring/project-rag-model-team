import dotenv from 'dotenv';
import { ChatGroq } from '@langchain/groq';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {listFiles, getFile} from '../../google_api/driveService.js';
import { queryGraphQL } from '../graphql_setup/graphql_client.js';
import {
  buildAccessDeniedMessage,
  annotateFilesWithClassification,
  canAccessClassification,
  filterAccessibleProfiles,
  getClassificationForRole,
  normalizeClassification,
} from '../security/access_control.js';
import {
  upsertDocumentTags,
  getDocumentTags,
} from '../database/documentTagService.js';

dotenv.config();

const llm = new ChatGroq({ apiKey: process.env.GROQ_API_KEY, model: 'llama-3.1-8b-instant' });

const GREETING_PATTERN = /^(hi|hello|hey|howdy|good morning|good afternoon|good evening)\b/i;

// Helper function to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

//All the prompt templates used

//JSON ONLY
const intentPrompt = PromptTemplate.fromTemplate(`
  Classify the intent of this message and return JSON only.

  Message: {message}

  Return one of these JSON formats and only these formats, no explanation:
  - Get all users:        {{"type": "GET_USER", "action": "GET_ALL"}}
  - Search Google Drive:  {{"type": "SEARCH_DRIVE", "query": "<search terms>"}}

  JSON only, no explanation. Information about people is most likely suited to GET_USER, and information about projects or documents is most likely suited to SEARCH_DRIVE, but use your judgement based on the content of the message.
`);

//Natural Language
const userInformationPrompt = PromptTemplate.fromTemplate(`
    Given the following user information, can you suggest a user that may be helpful to answer a question about {topic}?

    User information:
    {userInfo}

    If the user is asking information about hierarchy in the organization, then you may list out the multiple users and their roles. If the user is asking about who might be helpful for a question on a certain topic, you can use the information about users' roles, experience levels, departments, and areas of interest to make suggestions.
    If there are no users that seem helpful for questions about the topic, say something like "I don't think there are any users that may be helpful to answer this question".
    Please answer in natural language, as if you were responding to a question about {topic} with suggestions of who might be helpful to answer questions about that topic. You can use the information about users' roles, experience levels, departments, and areas of interest to make suggestions.
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
    JSON only, no explanation.
`);

//Natural Language
const driveSearchSelectionPrompt = PromptTemplate.fromTemplate(`
    Given the following files, can you distill the most relevant information to answer a question about {topic} from the content of these documents?
    If the question is asking about what information you do have, it is okay to list out a few file names that could help the user make further questions.
    Document contents: {content}
    Please answer the question about {topic} using only the information from these documents. If you don't have enough information to answer, say "IDK" and only "IDK".
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
  return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

//Functions to call the chains and decide what to do with the results

async function parseIntent(message) {
  console.log("parseIntent invoked with message:", message);
  try {
    const result = await intentChain.invoke({ message });
    console.log("Raw intent result:", result);
    try {
      return JSON.parse(stripCodeFences(result));
    } catch (jsonError) {
      console.warn("Intent parse JSON failed, defaulting GENERAL; result:", result, jsonError);
      return { type: 'GENERAL' };
    }
  } catch (invokeError) {
    console.error("intentChain.invoke failed:", invokeError);
    return { type: 'GENERAL' };
  }
}

async function suggestUserForTopic(userInfo, topic) {
  const result = await userInfoChain.invoke({ userInfo, topic });
  console.log("Raw user suggestion result:", result);
  return result;
}

function isGreetingMessage(message) {
  return GREETING_PATTERN.test(String(message || '').trim());
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
      classification_level: 'public'
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
          }
        }
      }`,
      { session_id: requesterSessionId }
    );

    const requesterProfile = data?.getUserProfile;
    const requesterInfo = requesterProfile?.userInfo;

    if (!requesterInfo) {
      return {
        session_id: requesterSessionId,
        role: null,
        classification_level: 'public'
      };
    }

    return {
      session_id: requesterSessionId,
      role: requesterInfo?.role || null,
      classification_level:
        requesterInfo?.classification_level ||
        getClassificationForRole(requesterInfo?.role)
    };
  } catch (error) {
    console.error('Error loading requester access context:', error);
    return {
      session_id: requesterSessionId,
      role: null,
      classification_level: 'public'
    };
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
    const result = await autoClassifyChain.invoke({ name: file.name, excerpt: excerpt });
    const parsed = JSON.parse(stripCodeFences(result));
    return {
      classification_level: normalizeClassification(parsed.classification_level),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(t => String(t).toLowerCase()) : [],
    };
  } catch (error) {
    console.warn(`Auto-classify failed for "${file.name}":`, error.message);
    return { classification_level: 'internal', tags: [] };
  }
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
      upsertDocumentTags(file.id, file.name, file.classification_level, file.tags, false);
    }
    return file;
  });
}

async function searchDriveForTopic(topic, requesterContext) {
  const files = await listFiles();
  // Annotate with Drive metadata first, then override with DB values (DB takes priority)
  const annotated = annotateFilesWithClassification(files);
  const enriched = enrichFilesWithTags(annotated);
  // Filter using the final classification (DB-overridden values)
  const enrichedFiles = enriched.filter((file) =>
    canAccessClassification(requesterContext.classification_level, file.classification_level)
  );

  if (enrichedFiles.length === 0) {
    return buildAccessDeniedMessage(topic);
  }

  const fileSuggestionsString = await driveSearchChain.invoke({
    files: JSON.stringify(enrichedFiles.map(f => ({
      id: f.id,
      name: f.name,
      classification_level: f.classification_level,
      tags: f.tags,
    }))),
    topic
  });

  let fileSuggestions;
  try {
    fileSuggestions = JSON.parse(stripCodeFences(fileSuggestionsString));
  } catch (error) {
    console.error("Error parsing file suggestions JSON:", error);
    return "Sorry, I couldn't find relevant information in our documents.";
  }

  if (!Array.isArray(fileSuggestions) || fileSuggestions.length === 0) {
    return "Sorry, I couldn't find relevant information in our documents.";
  }

  const enrichedFilesById = new Map(enrichedFiles.map(file => [file.id, file]));
  const authorizedSuggestions = fileSuggestions
    .map(file => enrichedFilesById.get(file.id))
    .filter(Boolean);

  if (authorizedSuggestions.length === 0) {
    return buildAccessDeniedMessage(topic);
  }

  try {
    const fileContents = await Promise.all(authorizedSuggestions.map(async file => {
        try {
          const stream = await getFile(file.id);
          const content = await streamToString(stream);

          // Auto-classify selected files that have no tags yet, caching for future queries
          if (!getDocumentTags(file.id)) {
            console.log(`Auto-classifying "${file.name}"...`);
            const { classification_level, tags } = await autoClassifyDocument({ ...file, _content: content });
            upsertDocumentTags(file.id, file.name, classification_level, tags, true);
          }

          return `File: ${file.name}\nClassification: ${file.classification_level}\nTags: ${file.tags.join(', ')}\n\n${content}`;
        } catch (error) {
          console.error(`Error reading file ${file.id}:`, error);
          return `Error reading file: ${error.message}`;
        }
    }));
    console.log("Retrieved file contents:", fileContents);
    try {
        const finalAnswer = await driveSearchSelectionChain.invoke({ content: fileContents, topic });
        if (finalAnswer.trim() === "IDK") {
            return "Sorry, I couldn't find relevant information in our documents.";
        } else {
            return finalAnswer;
        }
    } catch (error) {
        console.error("Error invoking driveSearchSelectionChain:", error);
        return "Sorry, I couldn't process the information from the documents.";
    }
  } catch (error) {
    console.error("Error retrieving file contents:", error);
    return "Sorry, I couldn't retrieve the documents from our drive.";
  }
}

//Chains for llm interactions
const intentChain = intentPrompt.pipe(llm).pipe(new StringOutputParser());
const userInfoChain = userInformationPrompt.pipe(llm).pipe(new StringOutputParser());
const driveSearchChain = driveSearchPrompt.pipe(llm).pipe(new StringOutputParser());
const driveSearchSelectionChain = driveSearchSelectionPrompt.pipe(llm).pipe(new StringOutputParser());
const autoClassifyChain = autoClassifyPrompt.pipe(llm).pipe(new StringOutputParser());

//Main function to decide what to do with a message based on the parsed intent
export async function answerQuestion(message, requesterSessionId = null){
    try {
        const requesterContext = await getRequesterAccessContext(requesterSessionId);

        if (isGreetingMessage(message)) {
            return buildGreetingResponse(requesterContext);
        }

        const intent = await parseIntent(message);
        console.log("Parsed intent:", intent);

        //This takes care of all user information retrieval
        if (intent.type === 'GET_USER' || intent.action === 'GET_USER') {
            const data = await queryGraphQL(`{
  getAllUserProfiles {
    id
    session_id
    userInfo {
      name
      email
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
                  profile?.session_id !== requesterSessionId
              ),
              requesterContext.classification_level
            );

            if (accessibleProfiles.length === 0) {
              return buildAccessDeniedMessage(message);
            }

            console.log("Accessible users:", JSON.stringify(accessibleProfiles,null,2));
            const suggestion = await suggestUserForTopic(JSON.stringify(accessibleProfiles,null,2), message);
            console.log("User suggestion:", suggestion);
            return suggestion;

        //This takes care of searching Google Drive
        } else if (intent.type === 'SEARCH_DRIVE' || intent.action === 'SEARCH_DRIVE') {
            const searchResults = await searchDriveForTopic(intent.query, requesterContext);
            return searchResults;

        } else {
            return "Sorry, there is no documentation available for that topic and cannot reliably give you information. Please ask about a different topic or try rephrasing your question.";
        }
    } catch (error) {
        console.error("Error in answerQuestion:", error);
        return "Sorry, I couldn't understand your question. Please try rephrasing it.";
    }
}
