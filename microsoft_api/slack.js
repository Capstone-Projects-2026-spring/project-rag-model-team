import OnedriveServiceUser from "./onedriveServiceUser.js";
import * as tokenManager from "./tokenManager.js";

export default function (app) {
  // Command to check OneDrive connection status
  app.command("/drive-status", async ({ ack, respond, user_id }) => {
    await ack();

    try {
      const accessToken = await tokenManager.getValidAccessToken(user_id);
      
      if (!accessToken) {
        await respond({
          text: "❌ *OneDrive Status: Not Connected*",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "You need to authenticate with OneDrive first. Please use the authentication link provided during setup."
              }
            }
          ]
        });
        return;
      }

      const onedrive = new OnedriveServiceUser(accessToken);
      const files = await onedrive.listFiles(1);
      
      await respond({
        text: "✅ *OneDrive Status: Connected*",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "✅ You are authenticated with OneDrive\n✅ Can access your OneDrive files\n\nYou can now use `/drive-files` to list your files."
            }
          }
        ]
      });
    } catch (error) {
      await respond({
        text: "❌ *OneDrive Status: Error*",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Error connecting to OneDrive:\n\`\`\`${error.message}\`\`\``
            }
          }
        ]
      });
    }
  });

  // Command to list OneDrive files
  app.command("/drive-files", async ({ ack, respond, user_id }) => {
    await ack();

    try {
      const accessToken = await tokenManager.getValidAccessToken(user_id);
      
      if (!accessToken) {
        await respond("❌ OneDrive not authenticated. Please authenticate first.");
        return;
      }

      const onedrive = new OnedriveServiceUser(accessToken);
      const files = await onedrive.listFiles(20);

      if (files.length === 0) {
        await respond("📁 No files found in your OneDrive.");
        return;
      }

      const fileList = files
        .map((f, i) => `${i + 1}. *${f.name}* - <${f.webUrl}|View>`)
        .join('\n');

      await respond({
        text: `📁 Found ${files.length} file(s)`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Found ${files.length} file(s) in OneDrive:\n\n${fileList}`
            }
          }
        ]
      });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // Command to search OneDrive files
  app.command("/drive-search", async ({ ack, body, respond, user_id }) => {
    await ack();

    const query = body.text.trim();

    if (!query) {
      await respond("Please provide a search term: `/drive-search project-name`");
      return;
    }

    try {
      const accessToken = await tokenManager.getValidAccessToken(user_id);
      
      if (!accessToken) {
        await respond("❌ OneDrive not authenticated.");
        return;
      }

      const onedrive = new OnedriveServiceUser(accessToken);
      const files = await onedrive.searchFiles(query);

      if (files.length === 0) {
        await respond(`🔍 No files found matching: "${query}"`);
        return;
      }

      const fileList = files
        .map((f, i) => `${i + 1}. *${f.name}* - <${f.webUrl}|View>`)
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

  // Command to show help for OneDrive commands
  app.command("/drive-help", async ({ ack, respond }) => {
    await ack();

    await respond({
      text: "📚 OneDrive Commands",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Available OneDrive Commands:*\n\n`/drive-status` - Check if OneDrive is connected\n`/drive-files` - List your OneDrive files\n`/drive-search <term>` - Search for a file\n`/drive-help` - Show this help message"
          }
        }
      ]
    });
  });
}
