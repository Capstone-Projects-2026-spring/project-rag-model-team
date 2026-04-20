import { App } from "@slack/bolt";
import dotenv from "dotenv";
import { queryGraphQL } from "./logic/graphql_setup/graphql_client.js";
import slackHandlers from "./google_api/slack.js";
import {
  answerQuestion,
  autoClassifyDocument,
  searchWebForTopic,
} from "./logic/langChain/rag_implementation.js";
import { startGraphQL } from "./logic/graphql_setup/graphql_implementation.js";
import { initDatabase, getOne, runQuery } from "./logic/database/sqlite.js";
import { listFiles } from "./google_api/driveService.js";
import { annotateFilesWithClassification, getClassificationForRole } from "./logic/security/access_control.js";
import {
  upsertDocumentTags,
  getDocumentTags,
  getAllDocumentTags,
} from "./logic/database/documentTagService.js";
import {
  clearAllSyncedGitHubData,
  getSyncedGitHubRepositories,
  getSyncedGitHubRepository,
  parseGitHubRepository,
  normalizeGitHubUsername,
  syncGitHubRepository,
} from "./logic/github/githubService.js";

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
  try {
    const profile = getOne(`SELECT id FROM user_profiles WHERE session_id = ?`, [userId]);
    if (profile) {
      runQuery(
        `INSERT INTO user_interactions (profile_id, interaction_type, message) VALUES (?, ?, ?)`,
        [profile.id, type || "reactive", message]
      );
    }
  } catch (err) {
    console.warn("Interaction logging failed:", err.message);
  }
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


function fetchUserProfileDirect(sessionId) {
  const profile = getOne(
    `SELECT id, session_id, created_at FROM user_profiles WHERE session_id = ?`,
    [sessionId],
  );
  if (!profile) return null;
  const userInfo = getOne(`SELECT * FROM user_info WHERE profile_id = ?`, [
    profile.id,
  ]);
  return {
    id: profile.id,
    session_id: profile.session_id,
    userInfo: userInfo || null,
    hasCompletedIntake: !!userInfo,
  };
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
          github_username
          active_github_repo
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

function upsertUserProfile(sessionId, data) {
  const existing = fetchUserProfileDirect(sessionId);
  const existingInfo = existing?.userInfo || {};
  const classificationLevel = getClassificationForRole(
    data.role ?? existingInfo.role,
  );
  const merged = {
    name: data.name ?? existingInfo.name ?? null,
    email: data.email ?? existingInfo.email ?? null,
    github_username: data.github_username ?? existingInfo.github_username ?? null,
    active_github_repo: data.active_github_repo ?? existingInfo.active_github_repo ?? null,
    role: data.role ?? existingInfo.role,
    classification_level: classificationLevel,
    experience_level: data.experience_level ?? existingInfo.experience_level,
    department: data.department ?? existingInfo.department ?? null,
    areas_of_interest: data.areas_of_interest ?? existingInfo.areas_of_interest ?? "[]",
    technical_skills: data.technical_skills ?? existingInfo.technical_skills ?? "[]",
    learning_goals: data.learning_goals ?? existingInfo.learning_goals ?? "[]",
    preferred_content_complexity: data.preferred_content_complexity ?? existingInfo.preferred_content_complexity ?? null,
  };

  if (existing) {
    runQuery(
      `UPDATE user_info SET
        name=?, email=?, github_username=?, active_github_repo=?, role=?,
        classification_level=?, experience_level=?, department=?,
        areas_of_interest=?, technical_skills=?, learning_goals=?,
        preferred_content_complexity=?, updated_at=CURRENT_TIMESTAMP
       WHERE profile_id=?`,
      [
        merged.name, merged.email, merged.github_username, merged.active_github_repo,
        merged.role, merged.classification_level, merged.experience_level, merged.department,
        merged.areas_of_interest, merged.technical_skills, merged.learning_goals,
        merged.preferred_content_complexity, existing.id,
      ],
    );
  } else {
    runQuery(`INSERT INTO user_profiles (session_id) VALUES (?)`, [sessionId]);
    const profile = getOne(
      `SELECT id FROM user_profiles WHERE session_id = ?`,
      [sessionId],
    );
    runQuery(
      `INSERT INTO user_info (
        profile_id, session_id, name, email, github_username, active_github_repo,
        role, classification_level, experience_level, department,
        areas_of_interest, technical_skills, learning_goals, preferred_content_complexity
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        profile.id, sessionId, merged.name, merged.email, merged.github_username,
        merged.active_github_repo, merged.role, merged.classification_level,
        merged.experience_level, merged.department, merged.areas_of_interest,
        merged.technical_skills, merged.learning_goals, merged.preferred_content_complexity,
      ],
    );
  }

  return fetchUserProfileDirect(sessionId);
}

function getCommandsList() {
  return (
    `*Available Commands:*\n` +
    `• \`/update-profile\` — Update your role or experience level\n` +
    `• \`/link-username\` — Link your GitHub username for repo-based recommendations\n` +
    `• \`/list-repos\` — Show all synced GitHub repos you can scope against\n` +
    `• \`/set-active-repo\` — Choose which synced GitHub repo analytics should use\n` +
    `• \`/active-repo\` — Show your current active GitHub repo\n` +
    `• \`/reset\` — Delete your profile and start over\n` +
    `• \`/sync-docs\` — Bulk classify all Drive documents\n` +
    `• \`/sync-repo\` — Sync a GitHub repo's contributor activity\n` +
    `• \`/reset-repos\` — Clear all synced GitHub repo analytics\n` +
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
          text: {
            type: "plain_text",
            text: "Complete Profile Setup",
            emoji: true,
          },
          action_id: "open_intake_modal",
          style: "primary",
        },
      ],
    },
  ];
}

function getThreadTs(event) {
  return event.thread_ts || event.ts;
}

function normalizeSlackName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getSlackNameCandidates(user) {
  const profile = user?.profile || {};
  return Array.from(
    new Set(
      [
        user?.name,
        profile?.display_name,
        profile?.display_name_normalized,
        profile?.real_name,
        profile?.real_name_normalized,
      ]
        .map(normalizeSlackName)
        .filter(Boolean),
    ),
  );
}

async function resolveSuggestedUsersForChannel(
  client,
  channelId,
  suggestedUsers,
  requesterId,
) {
  if (
    !channelId ||
    !Array.isArray(suggestedUsers) ||
    suggestedUsers.length === 0
  ) {
    return suggestedUsers;
  }

  try {
    const allMemberIds = [];
    let cursor;

    do {
      const page = await client.conversations.members({
        channel: channelId,
        cursor,
        limit: 200,
      });
      allMemberIds.push(...(page.members || []));
      cursor = page.response_metadata?.next_cursor || "";
    } while (cursor);

    const memberProfiles = await Promise.all(
      allMemberIds.map(async (memberId) => {
        try {
          const result = await client.users.info({ user: memberId });
          return result.user || null;
        } catch (error) {
          console.warn(`Unable to load Slack user ${memberId}:`, error.message);
          return null;
        }
      }),
    );

    const usersByName = new Map();
    for (const user of memberProfiles.filter(Boolean)) {
      if (user.is_bot || user.id === requesterId) {
        continue;
      }

      for (const candidateName of getSlackNameCandidates(user)) {
        if (!usersByName.has(candidateName)) {
          usersByName.set(candidateName, user.id);
        }
      }
    }

    return suggestedUsers.map((user) => {
      if (user.session_id) {
        return user;
      }

      const matchedSessionId = usersByName.get(normalizeSlackName(user.name));
      if (!matchedSessionId) {
        return user;
      }

      return {
        ...user,
        session_id: matchedSessionId,
      };
    });
  } catch (error) {
    console.warn(
      "Unable to match GitHub suggestions to Slack channel members:",
      error.message,
    );
    return suggestedUsers;
  }
}

function buildSyncNowAccessory(syncContext, question) {
  if (!syncContext?.repoFullName || !question) {
    return null;
  }

  return {
    type: "button",
    text: { type: "plain_text", text: "Sync now", emoji: true },
    action_id: "sync_github_repo_now",
    value: JSON.stringify({
      repoFullName: syncContext.repoFullName,
      question,
    }),
  };
}

function buildUserSuggestionBlocks(
  answer,
  suggestedUsers,
  { question = null, syncContext = null } = {},
) {
  const answerBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: answer,
    },
  };
  const syncNowAccessory = buildSyncNowAccessory(syncContext, question);
  if (syncNowAccessory) {
    answerBlock.accessory = syncNowAccessory;
  }

  const blocks = [answerBlock];
  console.log("Building user suggestion blocks for:", suggestedUsers);
  if (Array.isArray(suggestedUsers) && suggestedUsers.length > 0) {
    blocks.push({ type: "divider" });

    suggestedUsers.slice(0, 5).forEach((user) => {
      const labelParts = [user.role, user.department].filter(Boolean);
      if (user.github_username) {
        const githubUsername = String(user.github_username).replace(/^@/, "");
        labelParts.push(
          `GitHub: <https://github.com/${githubUsername}|@${githubUsername}>`,
        );
      }
      const whyLines =
        Array.isArray(user.why) && user.why.length > 0
          ? `\n*Why:*\n${user.why.map((entry) => `• ${entry}`).join("\n")}`
          : user.reason
            ? `\n_Why: ${user.reason}_`
            : "";
      const block = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${user.name}*${labelParts.length ? ` • ${labelParts.join(" • ")}` : ""}${whyLines}`,
        },
      };

      if (user.session_id) {
        block.accessory = {
          type: "button",
          text: { type: "plain_text", text: "Start group chat", emoji: true },
          action_id: "start_groupchat",
          value: JSON.stringify({
            targetSessionId: user.session_id,
            topic: user.reason || "a topic you asked about",
          }),
        };
      }

      blocks.push(block);
    });
  }
  console.log("Constructed blocks:", JSON.stringify(blocks, null, 2));
  return blocks;
}

function appendFollowUpQuestions(blocks, followUpQuestions) {
  if (!Array.isArray(followUpQuestions) || followUpQuestions.length === 0) return blocks;
  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*You might also want to ask:*" },
  });
  followUpQuestions.slice(0, 5).forEach((q, i) => {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: q },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Ask" },
        action_id: `ask_followup_question_${i}`,
        value: q.slice(0, 2000),
      },
    });
  });
  return blocks;
}

function buildWebSearchOfferBlocks(messageText, question) {
  return [
    { type: "section", text: { type: "mrkdwn", text: messageText } },
    { type: "section", text: { type: "mrkdwn", text: "Would you like me to search the web for more information?" } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Yes, search the web" },
          action_id: "web_search_yes",
          value: question.slice(0, 2000),
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "No thanks" },
          action_id: "web_search_no",
          value: question.slice(0, 2000),
        },
      ],
    },
  ];
}

function buildTextResponseMessage(response, shouldShowGitHubReminder = false) {
  if (!response || typeof response === "string") {
    return response || "I apologize, I was not able to answer this.";
  }

  // offerWeb case: answer is an object with {internal, offerWeb, query}
  const rawAnswer = response.answer;
  let messageText;
  if (rawAnswer && typeof rawAnswer === "object" && rawAnswer.offerWeb) {
    messageText = rawAnswer.internal || "I couldn't find relevant information in our internal documents.";
  } else {
    messageText = rawAnswer || "I apologize, I was not able to answer this.";
  }
  if (shouldShowGitHubReminder) {
    messageText =
      "Tip: link your GitHub username with `/link-username your_username` to improve teammate recommendations and help others find you for relevant repo work.\n\n" +
      messageText;
  }
  return messageText;
}

async function buildSuggestionBlocksForResponse(
  client,
  channelId,
  requesterId,
  question,
  response,
) {
  const suggestedUsers =
    channelId && channelId.startsWith("D")
      ? response.suggestedUsers
      : await resolveSuggestedUsersForChannel(
          client,
          channelId,
          response.suggestedUsers,
          requesterId,
        );

  return appendFollowUpQuestions(
    buildUserSuggestionBlocks(response.answer, suggestedUsers, {
      question,
      syncContext: response.githubSyncContext,
    }),
    response.followUpQuestions,
  );
}

function getGitHubLinkReminderBlocks() {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Tip: link your GitHub username with `/link-username your_username` to improve teammate recommendations and help others find you for relevant repo work.",
      },
    },
    { type: "divider" },
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
  const isInThread = !!event.thread_ts;
  let threadHistory = [];
  if (isInThread) {
    const result = await client.conversations.replies({
      channel: event.channel,
      ts: event.thread_ts,
      limit: 5,
    });
    threadHistory = result.messages.map((m) => ({
      role: m.bot_id ? "assistant" : "user",
      content: m.text,
    }));
  }

  const profile = db
    .prepare("SELECT * FROM user_profiles WHERE session_id = ?")
    .get(event.user);
  console.log(`[app_mention] user=${event.user} profile=${JSON.stringify(profile)}`);

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
              text: {
                type: "plain_text",
                text: "Complete Profile Setup",
                emoji: true,
              },
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

  try {
    const response = await answerQuestion(question, event.user, false, threadHistory);
    const messageText = buildTextResponseMessage(response);
    const isOfferWeb = response?.answer?.offerWeb;

    if (isOfferWeb) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: replyThreadTs,
        text: messageText,
        blocks: buildWebSearchOfferBlocks(messageText, question),
      });
    } else if (Array.isArray(response.suggestedUsers) && response.suggestedUsers.length > 0) {
      const blocks = await buildSuggestionBlocksForResponse(
        client,
        event.channel,
        event.user,
        question,
        response,
      );
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: replyThreadTs,
        text: messageText,
        blocks,
      });
    } else {
      const blocks = appendFollowUpQuestions(
        [{ type: "section", text: { type: "mrkdwn", text: messageText } }],
        response.followUpQuestions,
      );
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: replyThreadTs,
        text: messageText,
        blocks,
      });
    }
  } catch (err) {
    console.error("Error in app_mention handler:", err);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: replyThreadTs,
      text: "Sorry, I ran into an error. Please try again.",
    });
  }
});

// ============= DM Handler =============

app.event("message", async ({ event, say, client, context }) => {
  if (event.bot_id) {
    return;
  }

  // Skip if this is a reply in a thread (handled by thread listener above)
  if (event.thread_ts) {
    return;
  }

  // Skip app mentions — the app_mention handler covers these
  if (context.botUserId && event.text?.includes(`<@${context.botUserId}>`)) {
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
    console.log(`[dm_handler] user=${userId} profile=${JSON.stringify(profile)}`);

    if (!profile) {
      await say({
        text: "Please complete your profile setup to get started.",
        blocks: getIntakeButtonBlocks(),
      });
      return;
    }

    // Profile exists — answer the question directly (no @ needed in DMs)
    logInteraction(userId, event.text, "reactive");
    const dmThreadTs = event.thread_ts || event.ts;
    const response = await answerQuestion(event.text, userId);
    const messageText = buildTextResponseMessage(response);
    const isOfferWeb = response?.answer?.offerWeb;

    if (isOfferWeb) {
      await say({
        text: messageText,
        blocks: buildWebSearchOfferBlocks(messageText, event.text),
        thread_ts: dmThreadTs,
      });
      return;
    }

    if (Array.isArray(response.suggestedUsers) && response.suggestedUsers.length > 0) {
      const blocks = await buildSuggestionBlocksForResponse(
        client,
        event.channel,
        userId,
        event.text,
        response,
      );
      await say({ blocks, text: messageText });
      return;
    } else {
      const blocks = appendFollowUpQuestions(
        [{ type: "section", text: { type: "mrkdwn", text: messageText } }],
        response.followUpQuestions,
      );
      await say({ text: messageText, blocks });
      return;
    }
  } catch (error) {
    console.error("Error handling DM:", error);
    await say("Sorry, I encountered an error. Please try again.");
    return;
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
      view: {
        ...getIntakeModal(),
        private_metadata: body.channel?.id || body.user.id,
      },
    });
  } catch (error) {
    console.error("Error opening modal:", error);
  }
});

app.action("start_groupchat", async ({ ack, body, client }) => {
  await ack();
  console.log("Starting group chat with action value:", body.actions[0].value);
  const channelOrDM = body.channel?.id || body.user.id; // ✅ handles DMs

  let payload;
  try {
    payload = JSON.parse(body.actions[0].value);
  } catch (error) {
    console.error("Failed to parse group chat action value:", error);
    await client.chat.postEphemeral({
      channel: channelOrDM,
      user: body.user.id,
      text: "Sorry, I couldn't start the group chat due to an internal error.",
    });
    return;
  }

  const requesterId = body.user.id;
  const targetSessionId = payload.targetSessionId;
  const topic = payload.topic || "a topic you asked about";

  if (!targetSessionId || targetSessionId === requesterId) {
    await client.chat.postEphemeral({
      channel: channelOrDM,
      user: requesterId,
      text: "I couldn't start the group chat because the selected user is invalid.",
    });
    return;
  }

  try {
    const openResult = await client.conversations.open({
      users: `${requesterId},${targetSessionId}`,
    });

    const gcChannelId = openResult.channel?.id;
    if (!gcChannelId)
      throw new Error("No channel returned from conversations.open");

    await client.chat.postMessage({
      channel: gcChannelId,
      text: `Hi <@${targetSessionId}> and <@${requesterId}>! I created this group chat to connect you via Keystone Bot about ${topic}.`,
    });

    await client.chat.postEphemeral({
      channel: channelOrDM, // ✅ fixed
      user: requesterId,
      text: `✅ Group chat created with <@${targetSessionId}>.`,
    });
  } catch (error) {
    console.error("Error creating group chat:", error);
    await client.chat.postEphemeral({
      channel: channelOrDM, // ✅ fixed
      user: requesterId,
      text: "Sorry, I couldn't create the group chat. Please try again.",
    });
  }
});

app.action("sync_github_repo_now", async ({ ack, body, client }) => {
  await ack();

  const channelId = body.channel?.id;
  const messageTs = body.message?.ts;
  const requesterId = body.user.id;

  let payload;
  try {
    payload = JSON.parse(body.actions?.[0]?.value || "{}");
  } catch (error) {
    console.error("Failed to parse sync-now action payload:", error);
    if (channelId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: requesterId,
        text: "Sorry, I couldn't refresh that GitHub analytics view due to an internal error.",
      });
    }
    return;
  }

  const repoFullName = parseGitHubRepository(payload.repoFullName);
  const question = String(payload.question || "").trim();

  if (!channelId || !messageTs || !repoFullName || !question) {
    if (channelId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: requesterId,
        text: "Sorry, I couldn't determine which repo or question to refresh.",
      });
    }
    return;
  }

  try {
    await syncGitHubRepository(repoFullName);

    const response = await answerQuestion(question, requesterId, false, []);
    const requesterProfile = await fetchUserProfile(requesterId);
    const shouldShowGitHubReminder =
      !body.message?.thread_ts &&
      !normalizeGitHubUsername(requesterProfile?.userInfo?.github_username);

    if (
      response &&
      Array.isArray(response.suggestedUsers) &&
      response.suggestedUsers.length > 0
    ) {
      let blocks = await buildSuggestionBlocksForResponse(
        client,
        channelId,
        requesterId,
        question,
        response,
      );
      if (shouldShowGitHubReminder) {
        blocks = [...getGitHubLinkReminderBlocks(), ...blocks];
      }

      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: response.answer || "I apologize, I was not able to answer this",
        blocks,
      });
    } else {
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: buildTextResponseMessage(response, shouldShowGitHubReminder),
        blocks: [],
      });
    }
  } catch (error) {
    console.error("Error refreshing GitHub analytics from button:", error);
    await client.chat.postEphemeral({
      channel: channelId,
      user: requesterId,
      text: `Sorry, I couldn't refresh *${repoFullName}* right now. ${error.message}`,
    });
  }
});

app.view("intake_submission", async ({ ack, body, view, client }) => {
  await ack();
  const userId = body.user.id;
  const values = view.state.values;

  const role = values.role_block.role_select.selected_option.value;
  const experienceLevel =
    values.experience_block.experience_select.selected_option.value;
  const githubUsernameInput = values.github_block?.github_input?.value || "";
  const githubUsername = normalizeGitHubUsername(githubUsernameInput);

  let displayName = "there";
  try {
    const slackUser = await client.users.info({ user: userId });
    displayName = slackUser.user.real_name || slackUser.user.name || "there";
  } catch (_) {}

  console.log("📝 Processing intake submission for user:", userId);

  const channelId = view.private_metadata || userId;

  try {
    const result = upsertUserProfile(userId, {
      name: displayName,
      role,
      experience_level: experienceLevel,
      github_username: githubUsername || undefined,
    });
    console.log("✅ Profile saved for:", userId);

    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `✅ Welcome, ${displayName}! Your profile is set up.\n\n${getCommandsList()}`,
    });
  } catch (error) {
    console.log("❌ INTAKE ERROR:", error.message, error.stack);
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
                description: {
                  type: "plain_text",
                  text: `Current: ${doc.classification_level}`,
                },
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
                {
                  text: { type: "plain_text", text: "public" },
                  value: "public",
                },
                {
                  text: { type: "plain_text", text: "internal" },
                  value: "internal",
                },
                {
                  text: { type: "plain_text", text: "confidential" },
                  value: "confidential",
                },
                {
                  text: { type: "plain_text", text: "restricted" },
                  value: "restricted",
                },
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
  const level =
    view.state.values.level_block.level_select.selected_option.value;

  const existing = getDocumentTags(fileId);
  if (!existing) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "Document not found.",
    });
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
      upsertDocumentTags(
        file.id,
        file.name,
        classification_level,
        tags,
        !hasMeta,
      );
      synced++;
    }

    await respond({
      text: `Sync complete. ${synced} document(s) classified, ${skipped} skipped (already manually tagged).`,
    });
  } catch (error) {
    console.error("Error during /sync-docs:", error);
    await respond({
      text: "Sorry, an error occurred during document sync. Check the server logs.",
    });
  }
});

app.command("/link-username", async ({ ack, body, client }) => {
  await ack();

  const githubUsername = normalizeGitHubUsername(body.text);
  if (!githubUsername) {
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Provide a GitHub username, for example `/link-username octocat`.",
    });
    return;
  }

  try {
    const existing = await fetchUserProfile(body.user_id);
    if (!existing?.hasCompletedIntake || !existing?.userInfo) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "Complete your profile setup first, then link your GitHub username.",
      });
      return;
    }

    await upsertUserProfile(body.user_id, {
      name: existing.userInfo.name,
      github_username: githubUsername,
      active_github_repo: existing.userInfo.active_github_repo,
      role: existing.userInfo.role,
      experience_level: existing.userInfo.experience_level,
    });

    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: `✅ Linked your profile to GitHub username *@${githubUsername}*.`,
    });
  } catch (error) {
    console.error("Error linking GitHub username:", error);
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Sorry, I couldn't link your GitHub username right now.",
    });
  }
});

app.command("/list-repos", async ({ ack, body, client }) => {
  await ack();

  try {
    const syncedRepos = getSyncedGitHubRepositories();
    const existing = await fetchUserProfile(body.user_id);
    const activeRepo = existing?.userInfo?.active_github_repo || null;

    if (syncedRepos.length === 0) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "I don't have any synced GitHub repos yet. Run `/sync-repo owner/repo` first.",
      });
      return;
    }

    const repoLines = syncedRepos.map((repo) =>
      repo === activeRepo ? `• *${repo}* (active)` : `• ${repo}`,
    );

    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text:
        `Here are the ${syncedRepos.length} synced GitHub repo${syncedRepos.length === 1 ? "" : "s"} I can scope against:\n` +
        `${repoLines.join("\n")}\n\n` +
        "You can copy any repo name from this list and paste it into `/set-active-repo owner/repo` to choose one.",
    });
  } catch (error) {
    console.error("Error listing synced GitHub repos:", error);
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Sorry, I couldn't load the synced GitHub repos right now.",
    });
  }
});

app.command("/set-active-repo", async ({ ack, body, client }) => {
  await ack();

  const repoInput = body.text?.trim();
  if (!repoInput) {
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Provide a synced repository like `/set-active-repo owner/repo`.",
    });
    return;
  }

  const existing = await fetchUserProfile(body.user_id);
  if (!existing?.hasCompletedIntake || !existing?.userInfo) {
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Complete your profile setup first, then choose an active GitHub repo.",
    });
    return;
  }

  const normalizedRepo = parseGitHubRepository(repoInput);
  if (!normalizedRepo) {
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Use a repo like `owner/repo` or paste a full GitHub URL.",
    });
    return;
  }

  const syncedRepo = getSyncedGitHubRepository(normalizedRepo);
  if (!syncedRepo) {
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: `I don't have analytics for *${normalizedRepo}* yet. Run \`/sync-repo ${normalizedRepo}\` first. You can also use \`/list-repos\` to see everything that's already synced.`,
    });
    return;
  }

  try {
    await upsertUserProfile(body.user_id, {
      name: existing.userInfo.name,
      github_username: existing.userInfo.github_username,
      active_github_repo: normalizedRepo,
      role: existing.userInfo.role,
      experience_level: existing.userInfo.experience_level,
    });

    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: `✅ Your active GitHub repo is now *${normalizedRepo}*. Repo-based recommendations will use this analytics scope.`,
    });
  } catch (error) {
    console.error("Error setting active GitHub repo:", error);
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Sorry, I couldn't save your active GitHub repo right now.",
    });
  }
});

app.command("/active-repo", async ({ ack, body, client }) => {
  await ack();

  try {
    const existing = await fetchUserProfile(body.user_id);
    if (!existing?.hasCompletedIntake || !existing?.userInfo) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "Complete your profile setup first, then choose an active GitHub repo.",
      });
      return;
    }

    const activeRepo = existing.userInfo.active_github_repo;
    if (!activeRepo) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "You do not have an active GitHub repo yet. Use `/list-repos` to see synced repos, then `/set-active-repo owner/repo` to choose one.",
      });
      return;
    }

    const syncedRepo = getSyncedGitHubRepository(activeRepo);
    const suffix = syncedRepo
      ? "Analytics questions will use this repo."
      : "That repo is no longer synced locally, so repo analytics may not return results until you sync it again.";

    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: `Your active GitHub repo is *${activeRepo}*. ${suffix}`,
    });
  } catch (error) {
    console.error("Error showing active GitHub repo:", error);
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Sorry, I couldn't load your active GitHub repo right now.",
    });
  }
});

app.command("/sync-repo", async ({ ack, body, respond }) => {
  await ack();

  const repoInput = body.text?.trim() || process.env.GITHUB_REPO;
  if (!repoInput) {
    await respond({
      text: "Provide a repository like `/sync-repo owner/repo`, or set `GITHUB_REPO` in your environment.",
    });
    return;
  }

  await respond({
    text: `Starting GitHub sync for *${repoInput}*... this may take a moment.`,
  });

  try {
    const result = await syncGitHubRepository(repoInput);
    await respond({
      text: `GitHub sync complete for *${result.repository}*. Indexed ${result.synced_commits} recent commit(s) across ${result.contributors} contributor(s).`,
    });
  } catch (error) {
    console.error("Error during /sync-repo:", error);
    await respond({
      text: `Sorry, I couldn't sync that GitHub repository. ${error.message}`,
    });
  }
});

app.command("/reset-repos", async ({ ack, body, client }) => {
  await ack();

  try {
    const result = clearAllSyncedGitHubData();
    const message =
      result.repositories_cleared > 0
        ? `🧹 Cleared ${result.repositories_cleared} synced GitHub repo(s) and ${result.contributors_cleared} contributor record(s). Active repo selections were also reset.`
        : "There were no synced GitHub repos to clear.";

    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: message,
    });
  } catch (error) {
    console.error("Error during /reset-repos:", error);
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "Sorry, I couldn't clear the synced GitHub repos right now.",
    });
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
      db.prepare("DELETE FROM user_interactions WHERE profile_id = ?").run(
        profile.id,
      );
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
            {
              text: { type: "plain_text", text: "Junior Developer" },
              value: "junior_dev",
            },
            {
              text: { type: "plain_text", text: "Mid-Level Developer" },
              value: "mid_dev",
            },
            {
              text: { type: "plain_text", text: "Senior Developer" },
              value: "senior_dev",
            },
            {
              text: { type: "plain_text", text: "Manager/Team Lead" },
              value: "manager",
            },
            {
              text: { type: "plain_text", text: "Designer" },
              value: "designer",
            },
            { text: { type: "plain_text", text: "QA Engineer" }, value: "qa" },
            {
              text: { type: "plain_text", text: "DevOps Engineer" },
              value: "devops",
            },
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
          placeholder: {
            type: "plain_text",
            text: "Select your experience level",
          },
          options: [
            {
              text: { type: "plain_text", text: "Entry Level (0-2 years)" },
              value: "entry",
            },
            {
              text: { type: "plain_text", text: "Mid Level (2-5 years)" },
              value: "mid",
            },
            {
              text: { type: "plain_text", text: "Senior (5-10 years)" },
              value: "senior",
            },
            {
              text: { type: "plain_text", text: "Expert (10+ years)" },
              value: "expert",
            },
          ],
        },
      },
      {
        type: "input",
        block_id: "github_block",
        optional: true,
        label: { type: "plain_text", text: "GitHub Username" },
        element: {
          type: "plain_text_input",
          action_id: "github_input",
          placeholder: {
            type: "plain_text",
            text: "Enter your GitHub username without @",
          },
        },
      },
    ],
  };
}

// ============= Follow-up Question Button Handler =============

app.action(/^ask_followup_question_\d+$/, async ({ ack, body, client }) => {
  await ack();
  const question = body.actions[0].value;
  const userId = body.user.id;
  const channelId = body.channel?.id || userId;
  const threadTs = body.message?.thread_ts || body.container?.thread_ts || body.message?.ts;
  console.log("Follow-up thread_ts:", threadTs, "| message.thread_ts:", body.message?.thread_ts, "| container.thread_ts:", body.container?.thread_ts);

  try {
    logInteraction(userId, question);
    const response = await answerQuestion(question, userId);
    const text = buildTextResponseMessage(response);
    const blocks = appendFollowUpQuestions(
      [{ type: "section", text: { type: "mrkdwn", text } }],
      response.followUpQuestions,
    );
    await client.chat.postEphemeral({ channel: channelId, user: userId, text, blocks, thread_ts: threadTs });
  } catch (err) {
    console.error("Error handling follow-up question button:", err);
  }
});

// ============= Web Search Yes/No Button Handlers =============

app.action("web_search_yes", async ({ ack, body, client }) => {
  await ack();
  const question = body.actions[0].value;
  const userId = body.user.id;
  const channelId = body.channel?.id || userId;
  const threadTs = body.message?.thread_ts || body.container?.thread_ts || body.message?.ts;

  try {
    logInteraction(userId, `web_search: ${question}`, "web_search");
    const webResult = await searchWebForTopic(question);
    await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: webResult.answer });
  } catch (err) {
    console.error("Error handling web search yes:", err);
  }
});

app.action("web_search_no", async ({ ack, body, client }) => {
  await ack();
  const userId = body.user.id;
  const channelId = body.channel?.id || userId;
  const threadTs = body.message?.thread_ts || body.container?.thread_ts || body.message?.ts;

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    thread_ts: threadTs,
    text: "No problem! Feel free to ask something else.",
  });
});

// ============= Start the Bot =============
let BOT_USER_ID;
(async () => {
  db = initDatabase();
  startGraphQL();
  await app.start();
  const auth = await app.client.auth.test();
  BOT_USER_ID = auth.user_id;
  console.log("⚡️ Slack bot is running in socket mode!");
})();

process.on("SIGINT", () => {
  if (db) {
    db.close();
  }
  process.exit(0);
});
