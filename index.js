import {App} from '@slack/bolt';
import dotenv from 'dotenv';
import express from 'express';
import { retrieveDocument, listAllProjects, formatDocumentForSlack, searchDocuments, retrieveDocumentFromDrive } from './document-retriever.js';
import routes from './google_api/routes.js';
import slackHandlers from './google_api/slack.js';

dotenv.config();

const expressApp = express();
const PORT = process.env.PORT || 3001;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Middleware
expressApp.use(express.json());

// Setup routes
routes(expressApp);
slackHandlers(app);

const result = await app.client.conversations.list({
  token: process.env.SLACK_BOT_TOKEN
});

const channel = result.channels.find(c => c.name === "all-project-keystone");
const welcomeChannelId = channel.id;

app.message('hello', async ({ message, say }) => {
    console.log("User said hello");
  await say(`Hello, <@${message.user}>!`);
});

app.event('reaction_added', async ({ event, client, logger }) => {
    console.log("User added a reaction");
    await client.chat.postMessage({
        channel: event.item.channel,
        text: `You added a reaction: ${event.reaction}`
    });
});

app.event('team_join', async ({ event, client, logger }) => {
  try {
    const result = await client.chat.postMessage({
      channel: welcomeChannelId,
      text: `Welcome to the team, <@${event.user.id}>! If you get this message, put in the discord the phrase 'Cucumbers'.`
    });
    logger.info(result);
  }
  catch (error) {
    logger.error(error);
  }
});

app.message(/project/i, async ({ message, say }) => {
  console.log("User asked about a project");

  const text = message.text.toLowerCase();

  if (text.includes('list') || text.includes('what projects') || text.includes('available projects')) {
    const projects = listAllProjects();
    const projectList = projects.map(p => `• *${p.name}*: ${p.description}`).join('\n');

    await say({
      text: `Here are the available projects:\n\n${projectList}\n\nAsk me about any of these projects to get more details!`
    });
    return;
  }

  let projectQuery = null;

  const patterns = [
    /(?:about|regarding|on)\s+(?:project\s+)?(\w+)/i,
    /(?:tell me about|info on|information about|what is|describe)\s+(?:project\s+)?(\w+)/i,
    /project\s+(\w+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      projectQuery = match[1];
      break;
    }
  }

  if (projectQuery) {
    const document = retrieveDocument(projectQuery);
    const formattedDoc = formatDocumentForSlack(document);
    await say(formattedDoc);
  } else {
    await say("I can help you find information about our projects! Try asking:\n• 'List all projects'\n• 'Tell me about Project Alpha'\n• 'What is Project Beta?'\n• 'Info on Project Gamma'");
  }
});

app.message(/^help$/i, async ({ say }) => {
  await say({
    text: `🤖 *Keystone Bot - Available Commands*\n\n` +
          `• Say *hello* - I'll greet you!\n` +
          `• Ask about a *project* - Get documentation for specific projects\n` +
          `• Say *list projects* - See all available projects\n` +
          `• Ask *help* - Show this message\n\n` +
          `Example queries:\n` +
          `• "Tell me about Project Alpha"\n` +
          `• "What is Project Beta?"\n` +
          `• "Info on Project Gamma"\n` +
          `• "List all projects"`
  });
});

app.message(async ({ message, say }) => {
});

(async () => {
  try {
    await app.client.chat.postMessage({
      channel: welcomeChannelId,
      text: "Hello! I just started up!"
    });
  } catch (error) {
    console.error("Error sending startup message:", error);
  }
  
  // Start Express server for OAuth callbacks
  expressApp.listen(PORT, () => {
    console.log(`🌐 Express server is running on http://localhost:${PORT}`);
  });

  // Start Slack bolt app
  await app.start();
  console.log("⚡️ Slack bot is running in socket mode!");
})();
