import {App} from '@slack/bolt';
import dotenv from 'dotenv';
import { queryGraphQL } from './logic/graphql_setup/graphql_client.js';
import slackHandlers from './google_api/slack.js';
import { answerQuestion } from './logic/langChain/rag_implementation.js';
import { logAndUploadFeedback } from './logic/logAndUploadFeedback.js';
import { initDatabase } from './logic/database/sqlite.js';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

let db;

// Setup Slack command handlers
slackHandlers(app);

// ================ Helper functions =====================
async function fetchUserProfile(sessionId) {
  const query = `
    query ($session_id: String!) {
      getUserProfile(session_id: $session_id) {
        id
        session_id
        hasCompletedIntake
        userInfo {
          id name email role experience_level department
          areas_of_interest technical_skills learning_goals preferred_content_complexity
        }
      }
    }
  `;
  const res = await queryGraphQL(query, { session_id: sessionId });
  return res?.getUserProfile || null;
}

async function upsertUserProfile(sessionId, data) {
  const payload = {
    session_id: sessionId,
    name: data.name || null,
    email: data.email || null,
    role: data.role,
    experience_level: data.experience_level,
    department: data.department || null,
    areas_of_interest: JSON.stringify(data.areas_of_interest || []),
    technical_skills: JSON.stringify(data.technical_skills || []),
    learning_goals: JSON.stringify(data.learning_goals || []),
    preferred_content_complexity: data.preferred_content_complexity || null,
  };
  console.log('📝 Processing intake submission for user:', sessionId);

  const existing = await fetchUserProfile(sessionId);
  if (existing) {
    const updateMutation = `
      mutation ($session_id: String!, $input: UserProfileInput!) {
        updateUserProfile(session_id: $session_id, input: $input) {
          id session_id hasCompletedIntake userInfo { id name email role }
        }
      }
    `;
    return (await queryGraphQL(updateMutation, { session_id: sessionId, input: payload })).updateUserProfile;
  }

  const createMutation = `
    mutation ($input: UserProfileInput!) {
      createUserProfile(input: $input) {
        id session_id hasCompletedIntake userInfo { id name email role }
      }
    }
  `;
  return (await queryGraphQL(createMutation, { input: payload })).createUserProfile;
}

// ================ Basic Bot Handlers =====================

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
      text: `Welcome to the team, <@${event.user.id}>!.`
    });
    logger.info(result);
  }
  catch (error) {
    logger.error(error);
  }
});

app.message(/^help$/i, async ({ say }) => {
  await say({
    text: `🤖 *Keystone Bot - Available Commands*\n` +
          `You must first preface your request with '@Project_Keystone_Bot\n\n'` +
          `• Say *hello* - I'll greet you!\n` +
          `• Ask about a *project* - Get documentation for specific projects\n` +
          `• Ask *help* - Show this message\n\n` +
          `Example queries:\n` +
          `• "Tell me about Project Alpha"\n` +
          `• "What is Project Beta?"\n` +
          `• "Info on Project Gamma"\n` +
          `• "List all projects"`
  });
});

// Main handler for questions directed at the bot in channels
app.event('app_mention', async ({ event, say }) => {
  // Remove bot mention from the message
  const question = event.text.replace(/<@[^>]+>/, '').trim(); 
  console.log("User asked a question:", question);
  const responseText = await answerQuestion(question, event.user);
  await say({
    text: responseText,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: responseText } },
        { type: "section", text: { type: "mrkdwn", text: "*Was this helpful?*" } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Yes" },
            style: "primary",
            value: JSON.stringify({ user: event.user, question, responseText, feedback: "yes" }),
            action_id: "feedback_yes"
          },
          {
            type: "button",
            text: { type: "plain_text", text: "No" },
            style: "danger",
            value: JSON.stringify({ user: event.user, question, responseText, feedback: "no" }),
            action_id: "feedback_no"
          }
        ]
      }
    ]
  });
});

// ============= DM Intake Handler =============

app.event('message', async ({ event, say }) => {
  //Checks that the message is an IM
  if (event.channel_type !== 'im' || event.bot_id) return;
  const userId = event.user;
  const text = event.text?.trim();
  console.log(`💬 DM from ${userId}: ${text}`);
  try {
    const profile = db.prepare('SELECT * FROM user_profiles WHERE session_id = ?').get(userId);
    //If there is no profile in the database for this user, prompt them to complete the intake form. If there is a profile, welcome them back and let them know they can ask questions in channels.
    if (!profile) {
      await say({
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
      return;
    }
    // If the user has a profile and sends a message, answer their question
    if (text) {
      const responseText = await answerQuestion(text, userId);
      await say({
        text: responseText,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: responseText } },
            { type: "section", text: { type: "mrkdwn", text: "*Was this helpful?*" } },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Yes" },
                style: "primary",
                value: JSON.stringify({ user: userId, question: text, responseText, feedback: "yes" }),
                action_id: "feedback_yes"
              },
              {
                type: "button",
                text: { type: "plain_text", text: "No" },
                style: "danger",
                value: JSON.stringify({ user: userId, question: text, responseText, feedback: "no" }),
                action_id: "feedback_no"
              }
            ]
          }
        ]
      });
    } else {
      await say("✅ Your profile is already set up! Ask me a question, and I'll do my best to help.");
    }
  // ============= Feedback Handlers =============

  app.action(/feedback_(yes|no)/, async ({ ack, body, action, client }) => {
    await ack();
    let feedbackData;
    try {
      feedbackData = JSON.parse(action.value);
    } catch (e) {
      feedbackData = { user: body.user.id, feedback: action.action_id === 'feedback_yes' ? 'yes' : 'no' };
    }
    try {
      await logAndUploadFeedback(
        feedbackData.user,
        feedbackData.feedback,
        { question: feedbackData.question, response: feedbackData.responseText }
      );
    } catch (err) {
      console.error('Failed to log/upload helpful feedback:', err);
    }
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: body.message.text,
      blocks: [
        ...(body.message.blocks?.filter(b => b.type !== 'actions') || []),
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `:white_check_mark: Thank you for your feedback!` }
          ]
        }
      ]
    });
  });
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
  const data = {
    name,
    email,
    role,
    experience_level: experienceLevel,
    department,
    areas_of_interest: interests,
    technical_skills: [], // Not collected in intake, but can be added later
    learning_goals: [], // Not collected in intake, but can be added later
    preferred_content_complexity: complexity
  };
  console.log('📝 Processing intake submission for user:', userId);

  try {
    await upsertUserProfile(userId, data);
    await fetchUserProfile(userId).then(async profile => {
      console.log('✅ Profile saved successfully:', profile);
      await client.chat.postMessage({
        channel: userId,
        text: `✅ Profile setup complete! Welcome, ${name}! You can now ask me questions by mentioning me in a channel.`
      });
    }).catch(error => {
      console.error('❌ Error fetching profile after upsert:', error);
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

//Note for future development, need to redo these functions to use graphql instead of direct database access, and also need to add error handling and edge case handling for the graphql functions
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
  db = initDatabase();
  await app.start();
  const result = await app.client.conversations.list({
    token: process.env.SLACK_BOT_TOKEN
  });
  const channel = result.channels.find(c => c.name === "all-project-keystone");
  const welcomeChannelId = channel?.id;
  if (!welcomeChannelId) console.error('Channel not found!');
  console.log("⚡️ Slack bot is running in socket mode!");
})();

process.on('SIGINT', () => {
  if (db) db.close();
  process.exit(0);
});
