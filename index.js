import { App } from "@slack/bolt";
import dotenv from "dotenv";
import { queryGraphQL } from "./logic/graphql_setup/graphql_client.js";
import slackHandlers from "./google_api/slack.js";
import { answerQuestion, autoClassifyDocument } from "./logic/langChain/rag_implementation.js";
import { startGraphQL } from "./logic/graphql_setup/graphql_implementation.js";
import { initDatabase } from "./logic/database/sqlite.js";
import { listFiles } from "./google_api/driveService.js";
import { annotateFilesWithClassification } from "./logic/security/access_control.js";
import { upsertDocumentTags, getDocumentTags, getAllDocumentTags } from "./logic/database/documentTagService.js";

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

const interactionLogMutation = `
  mutation ($sessionID: String!, $interactionType: String!, $message: String!) {
    createInteractionRecord(session_id: $sessionID, interactionType: $interactionType, message: $message) {
      profile_id
      interaction_type
      message
      created_at
    }
  }
`;

function logInteraction(userId, message, type) {
  queryGraphQL(interactionLogMutation, { sessionID: userId, interactionType: type, message })
    .catch(err => console.warn("Interaction logging failed:", err.message));
}

async function fetchUserProfile(sessionId) {
  const query = `
    query ($session_id: String!) {
      getUserProfile(session_id: $session_id) {
        id
        session_id
        hasCompletedIntake
        userInfo {
          id
          name
          email
          role
          classification_level
          experience_level
          department
          areas_of_interest
          technical_skills
          learning_goals
          preferred_content_complexity
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
    email: null,
    role: data.role,
    experience_level: data.experience_level,
    department: null,
    areas_of_interest: JSON.stringify([]),
    technical_skills: JSON.stringify([]),
    learning_goals: JSON.stringify([]),
    preferred_content_complexity: null,
  };
  console.log("📝 Processing intake submission for user:", sessionId);

  const existing = await fetchUserProfile(sessionId);
  if (existing) {
    const updateMutation = `
      mutation ($session_id: String!, $input: UserProfileInput!) {
        updateUserProfile(session_id: $session_id, input: $input) {
          id
          session_id
          hasCompletedIntake
          userInfo {
            id
            name
            role
            classification_level
          }
        }
      }
    `;
    return (
      await queryGraphQL(updateMutation, { session_id: sessionId, input: payload })
    ).updateUserProfile;
  }

  const createMutation = `
    mutation ($input: UserProfileInput!) {
      createUserProfile(input: $input) {
        id
        session_id
        hasCompletedIntake
        userInfo {
          id
          name
          role
          classification_level
        }
      }
    }
  `;
  return (await queryGraphQL(createMutation, { input: payload })).createUserProfile;
}

function getCommandsList() {
  return (
    `*Available Commands:*\n` +
    `• \`/update-profile\` — Update your role or experience level\n` +
    `• \`/reset\` — Delete your profile and start over\n` +
    `• \`/sync-docs\` — Bulk classify all Drive documents\n` +
    `• \`/classify-docs\` — Change a document's classification level\n` +
    `• Say *help* or *commands* — Show this list`
  );
}

function getIntakeButtonBlocks() {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "👋 Before you can use Keystone Bot, please complete a quick profile setup.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Complete Profile Setup", emoji: true },
          action_id: "open_intake_modal",
          style: "primary",
        },
      ],
    },
  ];
}

// ================ Basic Bot Handlers =====================

app.event("reaction_added", async ({ event, client }) => {
  console.log("User added a reaction");
  await client.chat.postMessage({
    channel: event.item.channel,
    text: `You added a reaction: ${event.reaction}`,
  });
});

app.event("team_join", async ({ event, client }) => {
  try {
    await client.chat.postMessage({
      channel: event.user.id,
      text: "Welcome! Please complete your profile setup to get started.",
      blocks: getIntakeButtonBlocks(),
    });
  } catch (error) {
    console.error("Error DMing new user on team_join:", error);
  }
});

app.message(/^(help|commands)$/i, async ({ say }) => {
  await say({ text: getCommandsList() });
});

// Main handler for questions directed at the bot in channels
app.event("app_mention", async ({ event, say, client }) => {
  const profile = db
    .prepare("SELECT * FROM user_profiles WHERE session_id = ?")
    .get(event.user);

  if (!profile) {
    await client.chat.postEphemeral({
      channel: event.channel,
      user: event.user,
      text: "Please complete your profile setup first.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Please complete your profile setup before asking questions.",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Complete Profile Setup", emoji: true },
              action_id: "open_intake_modal",
              style: "primary",
            },
          ],
        },
      ],
    });
    return;
  }

  const question = event.text.replace(/<@[^>]+>/, "").trim();
  console.log("User asked a question:", question);
  logInteraction(event.user, question, "reactive");
  const response = await answerQuestion(question, event.user);

  if (typeof response === 'string') {
    await say({ text: response });
  } else {
    let messageText = response.answer;

    if (response.followUpQuestions && response.followUpQuestions.length > 0) {
      messageText += "\n\n💡 *You might also want to ask:*\n";
      response.followUpQuestions.forEach((question, index) => {
        messageText += `${index + 1}. ${question}\n`;
      });
    }

    await say({ text: messageText });
  }
});

// ============= DM Handler =============

app.event("message", async ({ event, say, client }) => {
  if (event.bot_id) {
      return;
  }
  const userId = event.user;
  if (event.channel_type !== "im" && event.action !== "app_mention") {
    const preemptiveResponse = await answerQuestion(event.text, event.user, true);
    console.log("Preemptive response:", preemptiveResponse);
    if (preemptiveResponse) {
      logInteraction(userId, event.text, "preemptive");
      await client.chat.postEphemeral({ 
      channel: event.channel,
      user: userId,
      text: preemptiveResponse.answer });
    }
    return;
  }
  console.log(`💬 DM from ${userId}`);

  try {
    const profile = db
      .prepare("SELECT * FROM user_profiles WHERE session_id = ?")
      .get(userId);

    if (!profile) {
      await say({
        text: "Please complete your profile setup to get started.",
        blocks: getIntakeButtonBlocks(),
      });
      return;
    }

    // Profile exists — answer the question directly (no @ needed in DMs)
    logInteraction(userId, event.text, "reactive");
    const response = await answerQuestion(event.text, userId);

    if (typeof response === 'string') {
      await say({ text: response });
    } else {
      let messageText = response.answer;

      if (response.followUpQuestions && response.followUpQuestions.length > 0) {
        messageText += "\n\n💡 *You might also want to ask:*\n";
        response.followUpQuestions.forEach((question, index) => {
          messageText += `${index + 1}. ${question}\n`;
        });
      }

      await say({ text: messageText });
    }
  } catch (error) {
    console.error("Error handling DM:", error);
    await say("Sorry, I encountered an error. Please try again.");
  }
});

// ============= Intake Form Handlers =============

app.action("open_intake_modal", async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: { ...getIntakeModal(), private_metadata: body.channel?.id || body.user.id },
    });
  } catch (error) {
    console.error("Error opening modal:", error);
  }
});

app.view("intake_submission", async ({ ack, body, view, client }) => {
  await ack();
  const userId = body.user.id;
  const values = view.state.values;

  const role = values.role_block.role_select.selected_option.value;
  const experienceLevel = values.experience_block.experience_select.selected_option.value;

  let displayName = "there";
  try {
    const slackUser = await client.users.info({ user: userId });
    displayName = slackUser.user.real_name || slackUser.user.name || "there";
  } catch (_) {}

  console.log("📝 Processing intake submission for user:", userId);

  const channelId = view.private_metadata || userId;

  try {
    await upsertUserProfile(userId, { name: displayName, role, experience_level: experienceLevel });
    console.log("✅ Profile saved successfully for:", userId);

    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `✅ Welcome, ${displayName}! Your profile is set up.\n\n${getCommandsList()}`,
    });
  } catch (error) {
    console.error("❌ Error saving intake:", error);
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "Sorry, there was an error saving your profile. Please try again.",
    });
  }
});

// ============= Slash Commands =============

app.command("/classify-docs", async ({ ack, body, client }) => {
  await ack();
  try {
    const docs = getAllDocumentTags();
    if (docs.length === 0) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "No documents indexed yet. Run /sync-docs first.",
      });
      return;
    }
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "classify_docs_submission",
        private_metadata: body.channel_id,
        title: { type: "plain_text", text: "Classify Document" },
        submit: { type: "plain_text", text: "Submit" },
        blocks: [
          {
            type: "input",
            block_id: "doc_block",
            label: { type: "plain_text", text: "Document" },
            element: {
              type: "static_select",
              action_id: "doc_select",
              placeholder: { type: "plain_text", text: "Select a document" },
              options: docs.map((doc) => ({
                text: { type: "plain_text", text: doc.file_name },
                description: { type: "plain_text", text: `Current: ${doc.classification_level}` },
                value: doc.drive_file_id,
              })),
            },
          },
          {
            type: "input",
            block_id: "level_block",
            label: { type: "plain_text", text: "Classification Level" },
            element: {
              type: "static_select",
              action_id: "level_select",
              placeholder: { type: "plain_text", text: "Select a level" },
              options: [
                { text: { type: "plain_text", text: "public" }, value: "public" },
                { text: { type: "plain_text", text: "internal" }, value: "internal" },
                { text: { type: "plain_text", text: "confidential" }, value: "confidential" },
                { text: { type: "plain_text", text: "restricted" }, value: "restricted" },
              ],
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error("Error opening classify-docs modal:", error);
  }
});

app.view("classify_docs_submission", async ({ ack, body, view, client }) => {
  await ack();
  const userId = body.user.id;
  const channelId = view.private_metadata || userId;
  const fileId = view.state.values.doc_block.doc_select.selected_option.value;
  const level = view.state.values.level_block.level_select.selected_option.value;

  const existing = getDocumentTags(fileId);
  if (!existing) {
    await client.chat.postEphemeral({ channel: channelId, user: userId, text: "Document not found." });
    return;
  }
  upsertDocumentTags(fileId, existing.file_name, level, existing.tags, false);
  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: `✅ *${existing.file_name}* classification updated to *${level}*.`,
  });
});

app.command("/update-profile", async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: { ...getIntakeModal(), private_metadata: body.channel_id },
    });
  } catch (error) {
    console.error("Error opening modal:", error);
  }
});

app.command("/sync-docs", async ({ ack, respond }) => {
  await ack();
  await respond({ text: "Starting document sync... this may take a moment." });

  try {
    const files = await listFiles();
    const annotated = annotateFilesWithClassification(files);
    let synced = 0;
    let skipped = 0;

    for (const file of annotated) {
      const existing = getDocumentTags(file.id);
      if (existing && !existing.auto_classified) {
        skipped++;
        continue;
      }
      const hasMeta = file.tags.length > 0;
      let classification_level, tags;
      if (hasMeta) {
        classification_level = file.classification_level;
        tags = file.tags;
      } else {
        const result = await autoClassifyDocument(file);
        classification_level = result.classification_level;
        tags = result.tags;
      }
      upsertDocumentTags(file.id, file.name, classification_level, tags, !hasMeta);
      synced++;
    }

    await respond({
      text: `Sync complete. ${synced} document(s) classified, ${skipped} skipped (already manually tagged).`,
    });
  } catch (error) {
    console.error("Error during /sync-docs:", error);
    await respond({ text: "Sorry, an error occurred during document sync. Check the server logs." });
  }
});

app.command("/reset", async ({ ack, body, client }) => {
  await ack();
  const userId = body.user_id;
  const channelId = body.channel_id;

  try {
    const profile = db
      .prepare("SELECT * FROM user_profiles WHERE session_id = ?")
      .get(userId);

    if (profile) {
      db.prepare("DELETE FROM user_interactions WHERE profile_id = ?").run(profile.id);
      db.prepare("DELETE FROM user_info WHERE profile_id = ?").run(profile.id);
      db.prepare("DELETE FROM user_profiles WHERE id = ?").run(profile.id);

      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "🔄 Your profile has been reset. Send me a message to set up a new profile.",
      });
      console.log(`✅ Profile reset for user: ${userId}`);
    } else {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "You don't have a profile yet. Send me a message to get started!",
      });
    }
  } catch (error) {
    console.error("Error resetting profile:", error);
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "Sorry, there was an error resetting your profile. Please try again.",
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
        type: "input",
        block_id: "role_block",
        label: { type: "plain_text", text: "Your Role" },
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
            { text: { type: "plain_text", text: "Student" }, value: "student" },
          ],
        },
      },
      {
        type: "input",
        block_id: "experience_block",
        label: { type: "plain_text", text: "Experience Level" },
        element: {
          type: "static_select",
          action_id: "experience_select",
          placeholder: { type: "plain_text", text: "Select your experience level" },
          options: [
            { text: { type: "plain_text", text: "Entry Level (0-2 years)" }, value: "entry" },
            { text: { type: "plain_text", text: "Mid Level (2-5 years)" }, value: "mid" },
            { text: { type: "plain_text", text: "Senior (5-10 years)" }, value: "senior" },
            { text: { type: "plain_text", text: "Expert (10+ years)" }, value: "expert" },
          ],
        },
      },
    ],
  };
}

// ============= Start the Bot =============

(async () => {
  db = initDatabase();
  startGraphQL();
  await app.start();
  console.log("⚡️ Slack bot is running in socket mode!");
})();

process.on("SIGINT", () => {
  if (db) {
    db.close();
  }
  process.exit(0);
});
