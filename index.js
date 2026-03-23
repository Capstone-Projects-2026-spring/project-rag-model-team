import {App} from '@slack/bolt';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { retrieveDocument, listAllProjects, formatDocumentForSlack, searchDocuments } from './document-retriever.js';
import { retrieveFromDrive } from './drive-document-retriever.js';
import slackHandlers from './google_api/slack.js';
import { answerQuestion } from './logic/langChain/rag_implementation.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Setup Slack command handlers
slackHandlers(app);

const result = await app.client.conversations.list({
  token: process.env.SLACK_BOT_TOKEN
});

const channel = result.channels.find(c => c.name === "all-project-keystone");
const welcomeChannelId = channel.id;

app.message(/hello/i, async ({ message, say }) => {
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

// app.message(/project/i, async ({ message, say }) => {
//   console.log("User asked about a project");

//   const text = message.text.toLowerCase();

//   if (text.includes('list') || text.includes('what projects') || text.includes('available projects')) {
//     const projects = listAllProjects();
//     const projectList = projects.map(p => `• *${p.name}*: ${p.description}`).join('\n');

//     await say({
//       text: `Here are the available projects:\n\n${projectList}\n\nAsk me about any of these projects to get more details!`
//     });
//     return;
//   }

//   let projectQuery = null;

//   const patterns = [
//     /(?:about|regarding|on)\s+(?:project\s+)?(\w+)/i,
//     /(?:tell me about|info on|information about|what is|describe)\s+(?:project\s+)?(\w+)/i,
//     /project\s+(\w+)/i
//   ];

//   for (const pattern of patterns) {
//     const match = text.match(pattern);
//     if (match && match[1]) {
//       projectQuery = match[1];
//       break;
//     }
//   }

//   if (projectQuery) {
//     // Try Drive first (service account), then fall back to local sample docs.
//     let document = await retrieveFromDrive(projectQuery);
//     if (!document) {
//       document = retrieveDocument(projectQuery);
//     }

//     const formattedDoc = formatDocumentForSlack(document);
//     await say(formattedDoc);
//   } else {
//     await say("I can help you find information about our projects! Try asking:\n• 'List all projects'\n• 'Tell me about Project Alpha'\n• 'What is Project Beta?'\n• 'Info on Project Gamma'");
//   }
// });

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

app.event('app_mention', async ({ event, say }) => {
  const question = event.text.replace(/<@[^>]+>/, '').trim(); // Remove bot mention from the message
  console.log("User asked a question:", question);
  const responseText = await answerQuestion(question);
  await say({text: responseText});
});

// ============= Database Setup =============

const dbPath = path.join(__dirname, 'backend', 'database', 'users.db');
let db;

function initDatabase() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(dbPath);
  const schema = fs.readFileSync(path.join(__dirname, 'backend', 'database', 'schema.sql'), 'utf8');
  db.exec(schema);
  console.log(`📊 Database initialized: ${dbPath}`);
}

// ============= DM Intake Handler =============

app.event('message', async ({ event, say }) => {
  if (event.channel_type !== 'im' || event.bot_id) return;

  const userId = event.user;
  console.log(`💬 DM from ${userId}`);

  try {
    const profile = db.prepare('SELECT * FROM user_profiles WHERE session_id = ?').get(userId);
    const userInfo = profile
      ? db.prepare('SELECT * FROM user_info WHERE profile_id = ?').get(profile.id)
      : null;

    if (!userInfo) {
      await say({
        text: "Welcome! 👋 I'm your documentation assistant. To help you better, I'd like to learn about your role and experience.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Welcome! 👋 I'm your documentation assistant.\n\nTo provide you with the most relevant information, I'd like to learn about your role and experience level."
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Complete Profile Setup", emoji: true },
                action_id: "open_intake_modal",
                style: "primary"
              }
            ]
          }
        ]
      });
    } else {
      await say("✅ Your profile is already set up! Ask me questions by mentioning me in a channel.");
    }
  } catch (error) {
    console.error('Error handling DM:', error);
    await say("Sorry, I encountered an error. Please try again.");
  }
});

// ============= Intake Form Handlers =============

app.action('open_intake_modal', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: getIntakeModal()
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

app.view('intake_submission', async ({ ack, body, view, client }) => {
  await ack();

  const userId = body.user.id;
  const values = view.state.values;

  const name = values.name_block?.name_input?.value || '';
  const email = values.email_block?.email_input?.value || '';
  const role = values.role_block?.role_select?.selected_option?.value;
  const experienceLevel = values.experience_block?.experience_select?.selected_option?.value;
  const department = values.department_block?.department_input?.value || '';
  const interests = values.interests_block?.interests_select?.selected_options?.map(opt => opt.value) || [];
  const complexity = values.complexity_block?.complexity_select?.selected_option?.value || '';

  console.log('📝 Processing intake submission for user:', userId);

  try {
    let profile = db.prepare('SELECT * FROM user_profiles WHERE session_id = ?').get(userId);

    if (!profile) {
      db.prepare('INSERT INTO user_profiles (session_id) VALUES (?)').run(userId);
      profile = db.prepare('SELECT * FROM user_profiles WHERE session_id = ?').get(userId);
    }

    const existingInfo = db.prepare('SELECT * FROM user_info WHERE profile_id = ?').get(profile.id);

    if (existingInfo) {
      db.prepare(`
        UPDATE user_info SET
          name = ?, email = ?, role = ?, experience_level = ?, department = ?,
          areas_of_interest = ?, preferred_content_complexity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE profile_id = ?
      `).run(name, email, role, experienceLevel, department, JSON.stringify(interests), complexity, profile.id);
    } else {
      db.prepare(`
        INSERT INTO user_info (
          profile_id, name, email, role, experience_level, department,
          areas_of_interest, technical_skills, learning_goals, preferred_content_complexity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(profile.id, name, email, role, experienceLevel, department,
        JSON.stringify(interests), '[]', '[]', complexity);
    }

    console.log('✅ Profile saved successfully');

    await client.chat.postMessage({
      channel: userId,
      text: `✅ Profile setup complete! Welcome, ${name}! You can now ask me questions by mentioning me in a channel.`
    });
  } catch (error) {
    console.error('❌ Error saving intake:', error);
    await client.chat.postMessage({
      channel: userId,
      text: "Sorry, there was an error saving your profile. Please try again."
    });
  }
});

app.command('/update-profile', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: getIntakeModal()
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

app.command('/reset', async ({ ack, body, client }) => {
  await ack();
  const userId = body.user_id;

  try {
    const profile = db.prepare('SELECT * FROM user_profiles WHERE session_id = ?').get(userId);

    if (profile) {
      db.prepare('DELETE FROM user_interactions WHERE profile_id = ?').run(profile.id);
      db.prepare('DELETE FROM user_info WHERE profile_id = ?').run(profile.id);
      db.prepare('DELETE FROM user_profiles WHERE id = ?').run(profile.id);

      await client.chat.postMessage({
        channel: userId,
        text: "🔄 Your profile has been reset! Send me a message to start fresh with a new profile setup."
      });
      console.log(`✅ Profile reset for user: ${userId}`);
    } else {
      await client.chat.postMessage({
        channel: userId,
        text: "You don't have a profile yet. Send me a message to get started!"
      });
    }
  } catch (error) {
    console.error('Error resetting profile:', error);
    await client.chat.postMessage({
      channel: userId,
      text: "Sorry, there was an error resetting your profile. Please try again."
    });
  }
});

// ============= Intake Modal Definition =============

function getIntakeModal() {
  return {
    type: "modal",
    callback_id: "intake_submission",
    title: { type: "plain_text", text: "Profile Setup" },
    submit: { type: "plain_text", text: "Submit" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Let's personalize your experience!*\nThis helps me provide you with the most relevant documentation and guidance."
        }
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "name_block",
        element: { type: "plain_text_input", action_id: "name_input", placeholder: { type: "plain_text", text: "Your name" } },
        label: { type: "plain_text", text: "Name *" }
      },
      {
        type: "input",
        block_id: "email_block",
        element: { type: "plain_text_input", action_id: "email_input", placeholder: { type: "plain_text", text: "your.email@company.com" } },
        label: { type: "plain_text", text: "Email *" }
      },
      {
        type: "input",
        block_id: "role_block",
        element: {
          type: "static_select",
          action_id: "role_select",
          placeholder: { type: "plain_text", text: "Select your role" },
          options: [
            { text: { type: "plain_text", text: "Junior Developer" }, value: "junior_dev" },
            { text: { type: "plain_text", text: "Mid-Level Developer" }, value: "mid_dev" },
            { text: { type: "plain_text", text: "Senior Developer" }, value: "senior_dev" },
            { text: { type: "plain_text", text: "Manager/Team Lead" }, value: "manager" },
            { text: { type: "plain_text", text: "Designer" }, value: "designer" },
            { text: { type: "plain_text", text: "QA Engineer" }, value: "qa" },
            { text: { type: "plain_text", text: "DevOps Engineer" }, value: "devops" },
            { text: { type: "plain_text", text: "Student" }, value: "student" }
          ]
        },
        label: { type: "plain_text", text: "Your Role *" }
      },
      {
        type: "input",
        block_id: "experience_block",
        element: {
          type: "static_select",
          action_id: "experience_select",
          placeholder: { type: "plain_text", text: "Select your experience level" },
          options: [
            { text: { type: "plain_text", text: "Entry Level (0-2 years)" }, value: "entry" },
            { text: { type: "plain_text", text: "Mid Level (2-5 years)" }, value: "mid" },
            { text: { type: "plain_text", text: "Senior (5-10 years)" }, value: "senior" },
            { text: { type: "plain_text", text: "Expert (10+ years)" }, value: "expert" }
          ]
        },
        label: { type: "plain_text", text: "Experience Level *" }
      },
      {
        type: "input",
        block_id: "department_block",
        optional: true,
        element: { type: "plain_text_input", action_id: "department_input", placeholder: { type: "plain_text", text: "e.g., Engineering, Product" } },
        label: { type: "plain_text", text: "Department" }
      },
      {
        type: "input",
        block_id: "interests_block",
        optional: true,
        element: {
          type: "multi_static_select",
          action_id: "interests_select",
          placeholder: { type: "plain_text", text: "Select your areas of interest" },
          options: [
            { text: { type: "plain_text", text: "Frontend Development" }, value: "frontend" },
            { text: { type: "plain_text", text: "Backend Development" }, value: "backend" },
            { text: { type: "plain_text", text: "Database Design" }, value: "database" },
            { text: { type: "plain_text", text: "API Development" }, value: "api" },
            { text: { type: "plain_text", text: "Testing" }, value: "testing" },
            { text: { type: "plain_text", text: "DevOps" }, value: "devops" },
            { text: { type: "plain_text", text: "UI/UX Design" }, value: "design" },
            { text: { type: "plain_text", text: "System Architecture" }, value: "architecture" },
            { text: { type: "plain_text", text: "Documentation" }, value: "documentation" }
          ]
        },
        label: { type: "plain_text", text: "Areas of Interest" }
      },
      {
        type: "input",
        block_id: "complexity_block",
        optional: true,
        element: {
          type: "static_select",
          action_id: "complexity_select",
          placeholder: { type: "plain_text", text: "Let me decide" },
          options: [
            { text: { type: "plain_text", text: "Beginner - Simple explanations" }, value: "beginner" },
            { text: { type: "plain_text", text: "Intermediate - Balanced detail" }, value: "intermediate" },
            { text: { type: "plain_text", text: "Advanced - Technical depth" }, value: "advanced" }
          ]
        },
        label: { type: "plain_text", text: "Preferred Content Complexity" }
      }
    ]
  };
}


// ============= Start the Bot =============

(async () => {
  // try {
  //   await app.client.chat.postMessage({
  //     channel: welcomeChannelId,
  //     text: "Hello! I just started up!"
  //   });
  // } catch (error) {
  //   console.error("Error sending startup message:", error);
  // }

  initDatabase();
  await app.start();
  console.log("⚡️ Slack bot is running in socket mode!");
})();

process.on('SIGINT', () => {
  if (db) db.close();
  process.exit(0);
});
