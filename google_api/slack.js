import * as driveService from "./driveService.js";
import axios from "axios";
import fs from "fs";

export default function (app) {
  // Listen for file_shared events
  app.event('file_shared', async ({ event, client, logger }) => {
    try {
      // Get file info
      const fileId = event.file_id;
      const fileInfo = await client.files.info({ file: fileId });
      const file = fileInfo.file;

      // Get download URL and file name
      const url = file.url_private_download;
      const fileName = file.name;



      // Download the file as a stream from Slack
      const response = await axios.get(url, {
        responseType: 'stream',
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
      });

      // Upload the stream directly to Google Drive
      const { uploadStreamToDrive } = await import('./driveService.js');
      const driveRes = await uploadStreamToDrive(response.data, fileName);

      // Notify user in the channel
      await client.chat.postMessage({
        channel: file.user,
        text: `:inbox_tray: Your file *${fileName}* was uploaded to Google Drive!\n<${driveRes.webViewLink}|View in Drive>`
      });
    } catch (error) {
      logger.error('Error uploading file to Drive:', error);
    }
  });

   // Also handle files sent as part of a message (e.g., in DMs or channels)
  app.event('message', async ({ event, client, logger }) => {
    try {
      // Ignore bot messages and messages without files
      if (event.subtype === 'bot_message' || !event.files || !Array.isArray(event.files)) return;

      for (const file of event.files) {
        // Only handle files that are not already handled by file_shared
        if (!file.url_private_download || !file.name) continue;

        const url = file.url_private_download;
        const fileName = file.name;

        // Download the file as a stream from Slack
        const response = await axios.get(url, {
          responseType: 'stream',
          headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
        });

        // Upload the stream directly to Google Drive
        const { uploadStreamToDrive } = await import('./driveService.js');
        const driveRes = await uploadStreamToDrive(response.data, fileName);

        // Notify user in the channel or DM
        await client.chat.postMessage({
          channel: event.channel,
          text: `:inbox_tray: Your file *${fileName}* was uploaded to Google Drive!\n<${driveRes.webViewLink}|View in Drive>`
        });
      }
    } catch (error) {
      logger.error('Error uploading file from message to Drive:', error);
    }
  });

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

  // ============= Google Upload =============
  app.event("message", async ({ event }) => {
    if (!event.files) return;

    for (const file of event.files) {
      const url = file.url_private;
      // Use direct streaming method instead (handled above)
    }
  });
}
