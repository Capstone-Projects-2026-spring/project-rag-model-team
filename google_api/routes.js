import { generateAuthUrl, getTokens } from "./googleAuth.js";
import * as db from "./db.js";

export default function (app) {
  // Start OAuth flow
  app.get("/auth/google", (req, res) => {
    const { slackUserId, redirectUrl } = req.query;
    
    if (!slackUserId) {
      return res.status(400).send("Missing slackUserId parameter");
    }

    const url = generateAuthUrl(slackUserId);
    res.redirect(url);
  });

  // OAuth callback
  app.get("/oauth2callback", async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send("Missing code or state parameter");
    }

    try {
      const tokens = await getTokens(code);
      // Save tokens mapped to Slack user ID (state parameter)
      db.saveTokens(state, tokens);

      res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5;">
            <div style="text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #2e7d32;">✓ Success!</h1>
              <p style="color: #666; font-size: 16px;">Google Drive connected successfully!</p>
              <p style="color: #999; font-size: 14px;">You can now close this window and return to Slack.</p>
              <p style="color: #999; font-size: 12px; margin-top: 20px;">Your credentials have been securely stored.</p>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("OAuth error:", error);
      res.status(500).send(`
        <html>
          <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5;">
            <div style="text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #d32f2f;">✗ Error</h1>
              <p style="color: #666; font-size: 16px;">Failed to connect Google Drive.</p>
              <p style="color: #999; font-size: 14px;">${error.message}</p>
            </div>
          </body>
        </html>
      `);
    }
  });
}
