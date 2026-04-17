import { App } from "@slack/bolt";
import dotenv from "dotenv";
import { queryGraphQL } from "./logic/graphql_setup/graphql_client.js";
import slackHandlers from "./google_api/slack.js";
import { answerQuestion, autoClassifyDocument, NO_INTERNAL_RESULTS, searchWebForTopic } from "./logic/langChain/rag_implementation.js";
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

/**
 * Check if a question is explicitly asking for web search
 * Examples: "search online for", "google", "web search", "find online"
 */
function isExplicitWebSearchRequest(question) {
  const webSearchPatterns = [
    /search\s+online/i,
    /google\s+(for|me)?/i,
    /web\s+search/i,
    /find\s+online/i,
    /search\s+the\s+web/i,
    /look\s+up\s+online/i,
  ];
  
  return webSearchPatterns.some(pattern => pattern.test(question));
}

function isYesNoReply(text) {
  const normalized = String(text || "")
    .replace(/<@[^>]+>/g, "")
    .trim()
    .toLowerCase();
  return normalized === "yes" || normalized === "no";
}

function normalizeYesNoReply(text) {
  return String(text || "")
    .replace(/<@[^>]+>/g, "")
    .trim()
    .toLowerCase();
}

// Tracks recent web-search offers so yes/no replies can be handled without
// requiring channel history scopes in private channels.
const pendingWebSearchOffers = new Map();
const PENDING_WEB_OFFER_TTL_MS = 10 * 60 * 1000;

function setPendingWebSearchOffer(threadTs, userQuestion, userId) {
  if (!threadTs || !userQuestion) {
    return;
  }

  pendingWebSearchOffers.set(threadTs, {
    userQuestion,
    userId,
    createdAt: Date.now(),
  });
}

function getPendingWebSearchOffer(threadTs) {
  if (!threadTs) {
    return null;
  }

  const pending = pendingWebSearchOffers.get(threadTs);
  if (!pending) {
    return null;
  }

  if (Date.now() - pending.createdAt > PENDING_WEB_OFFER_TTL_MS) {
    pendingWebSearchOffers.delete(threadTs);
    return null;
  }

  return pending;
}

function clearPendingWebSearchOffer(threadTs) {
  if (threadTs) {
    pendingWebSearchOffers.delete(threadTs);
  }
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

  const question = event.text.replace(/<@[^>]+>/g, "").trim();
  const replyThreadTs = event.thread_ts || event.ts;
  console.log("User asked a question:", question);
  logInteraction(event.user, question, "reactive");

  if (isYesNoReply(question)) {
    const normalizedReply = normalizeYesNoReply(question);

    // Check if this is a reply to a web search offer
    if (event.thread_ts) {
      try {
        const threadMessages = await client.conversations.replies({
          channel: event.channel,
          ts: event.thread_ts,
          limit: 20,
        });

        let botOfferMessage = null;
        let questionMessage = null;
        
        for (let i = threadMessages.messages.length - 1; i >= 0; i--) {
          const msg = threadMessages.messages[i];
          if (msg.ts >= event.ts) continue;
          
          if (msg.bot_id || msg.username === 'Project_Keystone_Bot') {
            if (msg.text && msg.text.includes('search online')) {
              botOfferMessage = msg;
              for (let j = i - 1; j >= 0; j--) {
                const prevMsg = threadMessages.messages[j];
                if (!prevMsg.bot_id && prevMsg.user) {
                  questionMessage = prevMsg;
                  break;
                }
              }
              break;
            }
          }
        }

        if (botOfferMessage && questionMessage) {
          if (normalizedReply === "yes") {
            const userQuestion = questionMessage.text.replace(/<@[^>]+>/g, "").trim();
            console.log("User accepted web search for:", userQuestion);
            const webResult = await searchWebForTopic(userQuestion);
            await say({ text: webResult.answer, thread_ts: event.thread_ts });
            clearPendingWebSearchOffer(event.thread_ts);
            return;
          } else {
            // User said "no" to web search
            await say({
              text: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
              thread_ts: event.thread_ts,
            });
            clearPendingWebSearchOffer(event.thread_ts);
            return;
          }
        }
      } catch (error) {
        console.error("Error handling yes/no reply:", error);

        if (error?.data?.error === "missing_scope") {
          const pending = getPendingWebSearchOffer(event.thread_ts);
          if (pending) {
            if (normalizedReply === "yes") {
              const webResult = await searchWebForTopic(pending.userQuestion);
              await say({ text: webResult.answer, thread_ts: event.thread_ts });
            } else {
              await say({
                text: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
                thread_ts: event.thread_ts,
              });
            }
            clearPendingWebSearchOffer(event.thread_ts);
            return;
          }
        }
      }

      const pending = getPendingWebSearchOffer(event.thread_ts);
      if (pending) {
        if (normalizedReply === "yes") {
          const webResult = await searchWebForTopic(pending.userQuestion);
          await say({ text: webResult.answer, thread_ts: event.thread_ts });
        } else {
          await say({
            text: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
            thread_ts: event.thread_ts,
          });
        }
        clearPendingWebSearchOffer(event.thread_ts);
        return;
      }
    }

    if (normalizedReply === "no") {
      await say({
        text: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
        thread_ts: event.thread_ts || event.ts,
      });
      return;
    }

    // Fall back to generic message for standalone yes if we can't find context
    await say({
      text: 'Please reply with *"yes"* or *"no"* in the same thread where I offered web search, or ask a full question here.',
      thread_ts: event.thread_ts || event.ts,
    });
    return;
  }
  
  // Check if user is explicitly asking for web search
  if (isExplicitWebSearchRequest(question)) {
    console.log("User explicitly requested web search for:", question);
    const webResult = await searchWebForTopic(question);
    await say({ text: webResult.answer, thread_ts: replyThreadTs });
    return;
  }
  
  const response = await answerQuestion(question, event.user);

  // Handle web search offer when no internal results found
  if (response.answer && typeof response.answer === 'object' && response.answer.offerWeb) {
    const offerText = `Would you like me to search online for information about this? Reply in this thread with *"yes"* or *"no"*.`;
    setPendingWebSearchOffer(replyThreadTs, question, event.user);
    await say({ text: offerText, thread_ts: replyThreadTs });
    return;
  }

  if (typeof response === 'string') {
    await say({ text: response, thread_ts: replyThreadTs });
  } else {
    let messageText = response.answer;

    if (response.followUpQuestions && response.followUpQuestions.length > 0) {
      messageText += "\n\n💡 *You might also want to ask:*\n";
      response.followUpQuestions.forEach((question, index) => {
        messageText += `${index + 1}. ${question}\n`;
      });
    }

    await say({ text: messageText, thread_ts: replyThreadTs });
  }
});

// ============= DM Handler =============

app.event("message", async ({ event, say, client }) => {
  if (event.bot_id) {
      return;
  }
  
  // Skip if this is a reply in a thread (handled by thread listener above)
  // thread_ts is the timestamp of the parent message in a thread
  if (event.thread_ts) {
    return;
  }
  
  const userId = event.user;
  
  // Skip if no user (shouldn't happen, but be safe)
  if (!userId) {
    return;
  }
  
  // Only run preemptive for actual channel messages (not @mentions, not DMs, not threads)
  // Skip if: DM, thread reply, or bot mention in message
  if (event.channel_type === "im" || event.thread_ts || !event.text) {
    return;
  }
  
  // Check if message contains a bot mention (pattern: <@USERID>)
  if (event.text.includes('<@') && event.text.match(/<@U[A-Z0-9]+>/)) {
    return;
  }
  
  if (true) {  // Placeholder for the actual preemptive logic below
    const preemptiveResponse = await answerQuestion(event.text, event.user, true);
    console.log("Preemptive response:", preemptiveResponse);
    if (preemptiveResponse) {
      logInteraction(userId, event.text, "preemptive");
      
      try {
        let answerText = typeof preemptiveResponse.answer === 'string' 
          ? preemptiveResponse.answer 
          : preemptiveResponse.answer;
        
        // Add follow-up questions if they exist
        if (preemptiveResponse.followUpQuestions && preemptiveResponse.followUpQuestions.length > 0) {
          answerText += "\n\n💡 *You might also want to ask:*\n";
          preemptiveResponse.followUpQuestions.forEach((question, index) => {
            answerText += `${index + 1}. ${question}\n`;
          });
        }
        
        await client.chat.postEphemeral({ 
          channel: event.channel,
          user: userId,
          text: answerText
        });
      } catch (error) {
        console.error("Error posting ephemeral:", error);
      }
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
    
    // Check if user is explicitly asking for web search
    if (isExplicitWebSearchRequest(event.text)) {
      console.log("User explicitly requested web search for:", event.text);
      const webResult = await searchWebForTopic(event.text);
      await say({ text: webResult.answer });
      return;
    }
    
    const response = await answerQuestion(event.text, userId);

    // Handle web search offer when no internal results found
    if (response.answer && typeof response.answer === 'object' && response.answer.offerWeb) {
      const offerText = `Would you like me to search online for information about this? Reply in this thread with *"yes"* or *"no"*.`;
      setPendingWebSearchOffer(event.thread_ts || event.ts, event.text, userId);
      await say({ text: offerText, thread_ts: event.thread_ts || event.ts });
      return;
    }

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

// ============= Thread Listener for Web Search =============

app.event("message", async ({ event, say, client }) => {
  // Only handle replies in threads (thread_ts indicates a reply)
  if (!event.thread_ts || event.bot_id) {
    return;
  }

  const messageText = normalizeYesNoReply(event.text);
  
  // Check if user replied to the web search offer
  if (messageText !== "yes" && messageText !== "no") {
    return;
  }

  try {
    const pending = getPendingWebSearchOffer(event.thread_ts);
    if (pending) {
      if (messageText === "yes") {
        console.log("User accepted web search offer for:", pending.userQuestion);
        logInteraction(event.user, `web_search: ${pending.userQuestion}`, "web_search");

        const webResult = await searchWebForTopic(pending.userQuestion);
        await say({
          text: webResult.answer,
          thread_ts: event.thread_ts,
        });
      } else {
        console.log("User declined web search for:", pending.userQuestion);
        logInteraction(event.user, `declined_web_search: ${pending.userQuestion}`, "web_search");

        await say({
          text: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
          thread_ts: event.thread_ts,
        });
      }
      clearPendingWebSearchOffer(event.thread_ts);
      return;
    }

    // Fetch the last few messages in this thread to find the question and verify offer was just made
    const threadMessages = await client.conversations.replies({
      channel: event.channel,
      ts: event.thread_ts,
      limit: 20,  // Get more context to find the bot's last message
    });

    if (!threadMessages.messages || threadMessages.messages.length === 0) {
      return;
    }

    // Find the most recent bot message (the web search offer)
    let botOfferMessage = null;
    let questionMessage = null;
    
    for (let i = threadMessages.messages.length - 1; i >= 0; i--) {
      const msg = threadMessages.messages[i];
      // Skip the current message and any messages after the bot's offer
      if (msg.ts >= event.ts) continue;
      
      if (msg.bot_id || msg.username === 'Project_Keystone_Bot') {
        // Check if this is the web search offer message
        if (msg.text && msg.text.includes('search online')) {
          botOfferMessage = msg;
          // Look for the user's question message before this offer
          for (let j = i - 1; j >= 0; j--) {
            const prevMsg = threadMessages.messages[j];
            if (!prevMsg.bot_id && prevMsg.user) {
              questionMessage = prevMsg;
              break;
            }
          }
          break;
        }
      }
    }

    if (!botOfferMessage || !questionMessage) {
      if (messageText === "no") {
        await say({
          text: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
          thread_ts: event.thread_ts,
        });
      }
      // No recent web search offer found, ignore this response
      return;
    }

    // Clean the question by removing any bot mentions
    const originalQuestion = questionMessage.text.replace(/<@[^>]+>/g, "").trim();

    if (messageText === "yes") {
      // User accepted - perform web search
      console.log("User accepted web search offer for:", originalQuestion);
      logInteraction(event.user, `web_search: ${originalQuestion}`, "web_search");

      // Perform web search
      const webResult = await searchWebForTopic(originalQuestion);

      // Answer already includes sources, just send it directly
      await say({
        text: webResult.answer,
        thread_ts: event.thread_ts,
      });
    } else if (messageText === "no") {
      // User declined - provide the low confidence internal answer
      console.log("User declined web search for:", originalQuestion);
      logInteraction(event.user, `declined_web_search: ${originalQuestion}`, "web_search");

      // Just show the "couldn't find" message with follow-up questions
      const noResultMessage = "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.";
      
      await say({
        text: noResultMessage,
        thread_ts: event.thread_ts,
      });
    }
  } catch (error) {
    console.error("Error handling web search request:", error);

    if (error?.data?.error === "missing_scope") {
      if (messageText === "no") {
        await say({
          text: "Sorry, I couldn't find relevant information in our internal documents. Feel free to try rephrasing your question or ask about something else.",
          thread_ts: event.thread_ts,
        });
      } else {
        await say({
          text: "I couldn't access thread history to confirm context. Please ask your question again or grant the bot the required history scope.",
          thread_ts: event.thread_ts,
        });
      }
      return;
    }

    await say({
      text: "Sorry, I couldn't search online at this time. Please try again.",
      thread_ts: event.thread_ts,
    });
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
