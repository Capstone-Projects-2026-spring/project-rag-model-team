import dotenv from 'dotenv';
import { ChatGroq } from '@langchain/groq';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {listFiles, getFile} from '../../google_api/driveService.js';
import { queryGraphQL } from '../graphql_setup/graphql_client.js';

dotenv.config();

const llm = new ChatGroq({ apiKey: process.env.GROQ_API_KEY, model: 'llama-3.1-8b-instant' });

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
    Given the following search query, can you suggest relevant documents from our Google Drive that may be helpful to answer a question about {topic}?
    Files in our drive: {files}
    Please return the files you want to suggest in a JSON array with the format: [{{"id": "file.id", "name": "file.name"}}] If you don't have enough information to make a suggestion, return an empty array.
    Please only use JSON, no explanation.
`);

//Natural Language
const driveSearchSelectionPrompt = PromptTemplate.fromTemplate(`
    Given the following files, can you distill the most relevant information to answer a question about {topic} from the content of these documents?
    If the question is asking about what information you do have, it is okay to list out a few file names that could help the user make further questions.
    Document contents: {content}
    Please answer the question about {topic} using only the information from these documents. If you don't have enough information to answer, say "IDK" and only "IDK".
`);

//Functions to call the chains and decide what to do with the results

async function parseIntent(message) {
  const result = await intentChain.invoke({ message });
  //console.log("Raw intent result:", result);
  try {
    return JSON.parse(result);
  } catch {
    return { type: 'GENERAL' };
  }
}

async function suggestUserForTopic(userInfo, topic) {
  const result = await userInfoChain.invoke({ userInfo, topic });
  //console.log("Raw user suggestion result:", result);
  return result;
}

async function searchDriveForTopic(topic) {
  const files = await listFiles();
  //console.log("Files in drive:", files);
  const fileSuggestionsString = await driveSearchChain.invoke({ files: JSON.stringify(files), topic });
  //console.log("Suggested Files (raw):", fileSuggestionsString);
  
  let fileSuggestions;
  try {
    fileSuggestions = JSON.parse(fileSuggestionsString);
    //console.log("Suggested Files (parsed):", fileSuggestions);
  } catch (error) {
    console.error("Error parsing file suggestions JSON:", error);
    return "Sorry, I couldn't find relevant information in our documents.";
  }
  
  if (!Array.isArray(fileSuggestions) || fileSuggestions.length === 0) {
    return "Sorry, I couldn't find relevant information in our documents.";
  }
  try {
    const fileContents = await Promise.all(fileSuggestions.map(async file => {
        try {
          const stream = await getFile(file.id);
          return await streamToString(stream);
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

//Main function to decide what to do with a message based on the parsed intent
export async function answerQuestion(message){
    try {
        const intent = await parseIntent(message);
        console.log("Parsed intent:", intent);
        
        //This takes care of all user information retrieval
        if (intent.type === 'GET_USER' || intent.action === 'GET_USER') {
            //Client side request for the list of all users, which we can then use to suggest who might be helpful for a question on a certain topic
            const data = await queryGraphQL(`{
  getAllUserProfiles {
    id
    session_id
    userInfo {
      name
      email
      role
      experience_level
      department
    }
    hasCompletedIntake
  }
}`);
            console.log("All users:", JSON.stringify(data,null,2));
            const suggestion = await suggestUserForTopic(JSON.stringify(data,null,2), message);
            console.log("User suggestion:", suggestion);
            return suggestion;
            
        //This takes care of searching Google Drive
        } else if (intent.type === 'SEARCH_DRIVE' || intent.action === 'SEARCH_DRIVE') {
            const searchResults = await searchDriveForTopic(intent.query);
            return searchResults;
            
        } else {
            return "Sorry, there is no documentation available for that topic and cannot reliably give you information. Please ask about a different topic or try rephrasing your question.";
        }
    } catch (error) {
        console.error("Error in answerQuestion:", error);
        return "Sorry, I couldn't understand your question. Please try rephrasing it.";
    }
}
