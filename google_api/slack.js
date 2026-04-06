  
import fs from "fs";
import { logAndUploadFeedback } from "../logic/logAndUploadFeedback.js";
import * as driveService from "./driveService.js";

export default function (app) {
  // Command to check Google Drive connection status
  app.command("/drive-status", async ({ ack, respond }) => {
    await ack();

    try {
      const isConnected = await driveService.isConnected();

      if (!isConnected) {
        await respond({
          text: "❌ *Google Drive Status: Not Connected*",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "Google Drive service account is not configured. Please ensure `service-account-key.json` is in the project root directory."
              }
            }
          ]
        });
        return;
      }

      const files = await driveService.listFiles(1);
      await respond({
        text: "✅ *Google Drive Status: Connected*",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "✅ Service account is properly configured\n✅ Can access Google Drive files\n\nYou can now use `/drive-files` to list your Drive files."
            }
          }
        ]
      });
    } catch (error) {
      await respond({
        text: "❌ *Google Drive Status: Error*",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Error connecting to Drive:\n\`\`\`${error.message}\`\`\``
            }
          }
        ]
      });
    }
  });

  // Command to list Google Drive files
  app.command("/drive-files", async ({ ack, respond }) => {
    await ack();

    try {
      const isConnected = await driveService.isConnected();
      if (!isConnected) {
        await respond("❌ Google Drive not connected. Use `/drive-status` for details.");
        return;
      }

      const files = await driveService.listFiles(20);

      if (files.length === 0) {
        await respond("📁 No JSON files found in your Google Drive.");
        return;
      }

      const fileList = files
        .map((f, i) => `${i + 1}. *${f.name}* - <${f.webViewLink}|View>`)
        .join('\n');

      await respond({
        text: `📁 Found ${files.length} file(s)`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Found ${files.length} file(s) in Google Drive:\n\n${fileList}`
            }
          }
        ]
      });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // Command to search Drive files
  app.command("/drive-search", async ({ ack, body, respond }) => {
    await ack();

    const query = body.text.trim();

    if (!query) {
      await respond("Please provide a search term: `/drive-search project-name`");
      return;
    }

    try {
      const isConnected = await driveService.isConnected();
      if (!isConnected) {
        await respond("❌ Google Drive not connected.");
        return;
      }

      const files = await driveService.searchFiles(query);

      if (files.length === 0) {
        await respond(`🔍 No files found matching: "${query}"`);
        return;
      }

      const fileList = files
        .map((f, i) => `${i + 1}. *${f.name}* - <${f.webViewLink}|View>`)
        .join('\n');

      await respond({
        text: `🔍 Found ${files.length} result(s)`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Search results for "${query}":\n\n${fileList}`
            }
          }
        ]
      });
    } catch (error) {
      await respond(`❌ Search error: ${error.message}`);
    }
  });

  // Command to show help for Drive commands
  app.command("/drive-help", async ({ ack, respond }) => {
    await ack();

    await respond({
      text: "📚 Google Drive Commands",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Available Google Drive Commands:*\n\n`/drive-status` - Check if Drive is connected\n`/drive-files` - List all JSON files\n`/drive-search <term>` - Search for a file\n`/drive-help` - Show this help message"
          }
        }
      ]
    });
  });

  // Command to collect feedback and write to feedback.txt
  app.command("/give-feedback", async ({ ack, body, respond }) => {
    await ack();
    const feedback = body.text?.trim();
    if (!feedback) {
      await respond("Please provide feedback after the command, e.g. `/give-feedback This is my feedback`.");
      return;
    }
    const user = body.user_name || body.user_id || "unknown";
    try {
      await logAndUploadFeedback(user, feedback);
      await respond("✅ Thank you for your feedback! It has been recorded and uploaded to the feedback log.");
    } catch (err) {
      await respond("❌ Failed to record or upload feedback. Please try again later.");
    }
  });
  // Command to get all feedback
  app.command("/get-feedback", async ({ ack, respond }) => {
    await ack();
    try {
      const content = fs.readFileSync("feedback.txt", "utf8");
      if (!content.trim()) {
        await respond("No feedback has been recorded yet.");
      } else {
        // If content is too long for Slack, send only the last 3000 characters
        const maxLen = 3000;
        const display = content.length > maxLen ? content.slice(-maxLen) : content;
        await respond({
          text: `*Feedback log:*\n\n\`\`\`${display}\`\`\``,
          mrkdwn: true
        });
      }
    } catch (err) {
      await respond("❌ Could not read feedback file.");
    }
  });
}
