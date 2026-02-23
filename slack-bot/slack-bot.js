require('dotenv').config();
const { App } = require('@slack/bolt');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3002
});

// Database setup
const dbPath = path.join(__dirname, '..', 'backend', 'database', 'users.db');
let db;

// Initialize SQL.js database
async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
    const schema = fs.readFileSync(path.join(__dirname, '..', 'backend', 'database', 'schema.sql'), 'utf8');
    db.run(schema);
    saveDatabase();
  }
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(dbPath, buffer);
}

function getOne(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  } catch (error) {
    console.error('Error in getOne:', error);
    return null;
  }
}

function runQuery(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();

    // Get last insert ID before saving
    const lastIdResult = db.exec('SELECT last_insert_rowid() as id');
    const lastInsertRowid = lastIdResult[0]?.values[0]?.[0] || null;

    saveDatabase();
    return { lastInsertRowid };
  } catch (error) {
    console.error('Error in runQuery:', error);
    throw error;
  }
}

// ============= Slack Bot Handlers =============

// Listen for app mentions or direct messages
app.event('app_mention', async ({ event, client, say }) => {
  await handleMessage(event, client, say);
});

app.event('message', async ({ event, client, say }) => {
  console.log('📨 Message event received:', event);
  // Only respond to direct messages (not in channels)
  if (event.channel_type === 'im') {
    console.log('💬 Direct message detected, handling...');
    await handleMessage(event, client, say);
  } else {
    console.log('⏭️ Skipping non-DM message');
  }
});

async function handleMessage(event, client, say) {
  const userId = event.user;
  const text = event.text.toLowerCase();

  console.log(`👤 Handling message from user ${userId}: "${text}"`);

  try {
    // Check if user has completed intake
    const profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [userId]);
    const userInfo = profile ? getOne('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]) : null;

    console.log('🔍 Profile lookup:', { profile: profile?.id, hasUserInfo: !!userInfo });

    if (!userInfo) {
      // User hasn't completed intake - show the intake modal
      console.log('📋 Showing intake button for new user');
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
                text: {
                  type: "plain_text",
                  text: "Complete Profile Setup",
                  emoji: true
                },
                action_id: "open_intake_modal",
                style: "primary"
              }
            ]
          }
        ]
      });
    } else {
      // User has profile - provide personalized response
      const role = userInfo.role;
      const experienceLevel = userInfo.experience_level;

      // Generate response based on their message and profile
      const response = await generatePersonalizedResponse(text, role, experienceLevel);

      await say(response);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    await say("Sorry, I encountered an error. Please try again.");
  }
}

// Handle button click to open intake modal
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

// Handle intake modal submission
app.view('intake_submission', async ({ ack, body, view, client }) => {
  await ack();

  const userId = body.user.id;
  const values = view.state.values;

  // Extract form values
  const name = values.name_block?.name_input?.value || '';
  const email = values.email_block?.email_input?.value || '';
  const role = values.role_block?.role_select?.selected_option?.value;
  const experienceLevel = values.experience_block?.experience_select?.selected_option?.value;
  const department = values.department_block?.department_input?.value || '';
  const interests = values.interests_block?.interests_select?.selected_options?.map(opt => opt.value) || [];
  const complexity = values.complexity_block?.complexity_select?.selected_option?.value || '';

  console.log('📝 Processing intake submission for user:', userId);
  console.log('Form values:', { name, email, role, experienceLevel, department, interests, complexity });

  try {
    // Get or create profile using Slack User ID
    let profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [userId]);
    console.log('Existing profile:', profile);

    if (!profile) {
      console.log('Creating new profile...');
      const result = runQuery('INSERT INTO user_profiles (session_id) VALUES (?)', [userId]);
      console.log('Insert result:', result);
      profile = getOne('SELECT * FROM user_profiles WHERE id = ?', [result.lastInsertRowid]);
      console.log('New profile:', profile);
    }

    // Check if user info exists
    const existingInfo = getOne('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]);
    console.log('Existing info:', existingInfo);

    if (existingInfo) {
      // Update
      console.log('Updating existing user info...');
      runQuery(`
        UPDATE user_info SET
          name = ?, email = ?, role = ?, experience_level = ?, department = ?,
          areas_of_interest = ?, preferred_content_complexity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE profile_id = ?
      `, [name, email, role, experienceLevel, department, JSON.stringify(interests), complexity, profile.id]);
    } else {
      // Insert
      console.log('Inserting new user info...');
      runQuery(`
        INSERT INTO user_info (
          profile_id, name, email, role, experience_level, department,
          areas_of_interest, technical_skills, learning_goals, preferred_content_complexity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [profile.id, name, email, role, experienceLevel, department,
          JSON.stringify(interests), '[]', '[]', complexity]);
    }

    console.log('✅ Profile saved successfully');

    // Send confirmation message
    await client.chat.postMessage({
      channel: userId,
      text: `✅ Profile setup complete! I'll now tailor my responses for ${getRoleLabel(role)} with ${getExperienceLabel(experienceLevel)} experience. Feel free to ask me anything!`
    });

  } catch (error) {
    console.error('❌ Error saving intake:', error);
    console.error('Error stack:', error.stack);
    await client.chat.postMessage({
      channel: userId,
      text: "Sorry, there was an error saving your profile. Please try again."
    });
  }
});

// Handle update profile command
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

// Handle reset profile command
app.command('/reset', async ({ ack, body, client }) => {
  await ack();

  const userId = body.user_id;

  try {
    // Check if profile exists
    const profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [userId]);

    if (profile) {
      // Delete user info and profile
      runQuery('DELETE FROM user_interactions WHERE profile_id = ?', [profile.id]);
      runQuery('DELETE FROM user_info WHERE profile_id = ?', [profile.id]);
      runQuery('DELETE FROM user_profiles WHERE id = ?', [profile.id]);

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

// ============= Helper Functions =============

function getIntakeModal() {
  return {
    type: "modal",
    callback_id: "intake_submission",
    title: {
      type: "plain_text",
      text: "Profile Setup"
    },
    submit: {
      type: "plain_text",
      text: "Submit"
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Let's personalize your experience!*\nThis helps me provide you with the most relevant documentation and guidance."
        }
      },
      {
        type: "divider"
      },
      {
        type: "input",
        block_id: "name_block",
        element: {
          type: "plain_text_input",
          action_id: "name_input",
          placeholder: {
            type: "plain_text",
            text: "Your name"
          }
        },
        label: {
          type: "plain_text",
          text: "Name *"
        }
      },
      {
        type: "input",
        block_id: "email_block",
        element: {
          type: "plain_text_input",
          action_id: "email_input",
          placeholder: {
            type: "plain_text",
            text: "your.email@company.com"
          }
        },
        label: {
          type: "plain_text",
          text: "Email *"
        }
      },
      {
        type: "input",
        block_id: "role_block",
        element: {
          type: "static_select",
          action_id: "role_select",
          placeholder: {
            type: "plain_text",
            text: "Select your role"
          },
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
        label: {
          type: "plain_text",
          text: "Your Role *"
        }
      },
      {
        type: "input",
        block_id: "experience_block",
        element: {
          type: "static_select",
          action_id: "experience_select",
          placeholder: {
            type: "plain_text",
            text: "Select your experience level"
          },
          options: [
            { text: { type: "plain_text", text: "Entry Level (0-2 years)" }, value: "entry" },
            { text: { type: "plain_text", text: "Mid Level (2-5 years)" }, value: "mid" },
            { text: { type: "plain_text", text: "Senior (5-10 years)" }, value: "senior" },
            { text: { type: "plain_text", text: "Expert (10+ years)" }, value: "expert" }
          ]
        },
        label: {
          type: "plain_text",
          text: "Experience Level *"
        }
      },
      {
        type: "input",
        block_id: "department_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "department_input",
          placeholder: {
            type: "plain_text",
            text: "e.g., Engineering, Product"
          }
        },
        label: {
          type: "plain_text",
          text: "Department"
        }
      },
      {
        type: "input",
        block_id: "interests_block",
        optional: true,
        element: {
          type: "multi_static_select",
          action_id: "interests_select",
          placeholder: {
            type: "plain_text",
            text: "Select your areas of interest"
          },
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
        label: {
          type: "plain_text",
          text: "Areas of Interest"
        }
      },
      {
        type: "input",
        block_id: "complexity_block",
        optional: true,
        element: {
          type: "static_select",
          action_id: "complexity_select",
          placeholder: {
            type: "plain_text",
            text: "Let me decide"
          },
          options: [
            { text: { type: "plain_text", text: "Beginner - Simple explanations" }, value: "beginner" },
            { text: { type: "plain_text", text: "Intermediate - Balanced detail" }, value: "intermediate" },
            { text: { type: "plain_text", text: "Advanced - Technical depth" }, value: "advanced" }
          ]
        },
        label: {
          type: "plain_text",
          text: "Preferred Content Complexity"
        }
      }
    ]
  };
}

function getRoleLabel(role) {
  const labels = {
    'junior_dev': 'Junior Developer',
    'mid_dev': 'Mid-Level Developer',
    'senior_dev': 'Senior Developer',
    'manager': 'Manager/Team Lead',
    'designer': 'Designer',
    'qa': 'QA Engineer',
    'devops': 'DevOps Engineer',
    'student': 'Student'
  };
  return labels[role] || role;
}

function getExperienceLabel(level) {
  const labels = {
    'entry': 'Entry Level',
    'mid': 'Mid Level',
    'senior': 'Senior',
    'expert': 'Expert'
  };
  return labels[level] || level;
}

async function generatePersonalizedResponse(message, role, experienceLevel) {
  // This is where your RAG model integration would go
  // For now, we'll return a personalized response based on role and experience

  const roleGuidance = {
    'junior_dev': {
      prefix: "As a junior developer, let me explain this in a beginner-friendly way:\n\n",
      linkSuggestion: "\n\n💡 *Helpful resources:*\n• Getting Started Guide: [Link]\n• Tutorial Basics: [Link]"
    },
    'mid_dev': {
      prefix: "Here's a practical explanation:\n\n",
      linkSuggestion: "\n\n📚 *Related docs:*\n• System Architecture: [Link]\n• API Specification: [Link]"
    },
    'senior_dev': {
      prefix: "Here's the technical deep-dive:\n\n",
      linkSuggestion: "\n\n🔧 *Advanced topics:*\n• Architecture Design: [Link]\n• API Design Principles: [Link]"
    },
    'manager': {
      prefix: "Here's a high-level overview:\n\n",
      linkSuggestion: "\n\n📊 *Management resources:*\n• System Overview: [Link]\n• Requirements: [Link]"
    },
    'designer': {
      prefix: "From a design perspective:\n\n",
      linkSuggestion: "\n\n🎨 *Design docs:*\n• System Diagrams: [Link]\n• Use Cases: [Link]"
    }
  };

  const guidance = roleGuidance[role] || roleGuidance['mid_dev'];

  // TODO: Integrate with your RAG model here
  // const ragResponse = await yourRAGModel.query(message, { role, experienceLevel });

  // For now, return a template response
  return `${guidance.prefix}I understand you're asking about: "${message}"\n\n[Your RAG model response would go here]${guidance.linkSuggestion}\n\n_💬 Tip: You can update your profile anytime with \`/update-profile\`_`;
}

// ============= Start the Bot =============

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

(async () => {
  try {
    await initDatabase();
    await app.start();
    console.log('⚡️ Slack bot is running!');
    console.log(`📊 Database: ${dbPath}`);
    console.log('👤 Bot will prompt users for profile on first interaction');
  } catch (error) {
    console.error('Unable to start the bot:', error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', () => {
  if (db) {
    saveDatabase();
  }
  process.exit(0);
});
