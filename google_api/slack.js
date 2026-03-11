import { generateAuthUrl } from "./googleAuth.js";
import * as driveService from "./driveService.js";
import * as db from "./db.js";

export default function (app) {
  // Command to connect Google Drive
  app.command("/connect-drive", async ({ ack, body, respond, client }) => {
    await ack();

    const slackUserId = body.user_id;
    const authUrl = generateAuthUrl(slackUserId);
    const redirectUrl = `${process.env.SERVER_URL || "http://localhost:3001"}${authUrl}`;

    try {
      await respond({
        text: "🔐 *Connect Your Google Drive*",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Click the button below to authorize access to your Google Drive. This allows me to fetch your project documentation from Drive."
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Connect Google Drive",
                  emoji: true
                },
                url: redirectUrl,
                action_id: "connect_google_drive"
              }
            ]
          }
        ]
      });
    } catch (error) {
      await respond(`Error: ${error.message}`);
    }
  });

  // Command to list Google Drive files
  app.command("/drive-files", async ({ ack, body, respond }) => {
    await ack();

    const slackUserId = body.user_id;

    try {
      const files = await driveService.listFiles(slackUserId);

      if (files.length === 0) {
        await respond("No JSON files found in your Google Drive.");
        return;
      }

      const fileList = files.map(f => `• *${f.name}* - <${f.webViewLink}|View on Drive>`).join('\n');

      await respond({
        text: "📁 *Your Google Drive Files*",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Found ${files.length} file(s):\n\n${fileList}`
            }
          }
        ]
      });
    } catch (error) {
      if (error.message.includes("not authenticated")) {
        await respond("❌ Please connect your Google Drive first using `/connect-drive`");
      } else {
        await respond(`Error: ${error.message}`);
      }
    }
  });

  // Command to disconnect Google Drive
  app.command("/disconnect-drive", async ({ ack, body, respond }) => {
    await ack();

    const slackUserId = body.user_id;

    try {
      db.removeTokens(slackUserId);
      await respond("✓ Google Drive disconnected successfully.");
    } catch (error) {
      await respond(`Error: ${error.message}`);
    }
  });
}
