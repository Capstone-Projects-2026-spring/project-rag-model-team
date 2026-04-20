// Service Account Routes - For OneDrive with Microsoft Graph API

export default function (app) {
  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "Slack bot is running with OneDrive service account" });
  });

  // Status endpoint
  app.get("/onedrive-status", (req, res) => {
    res.json({ 
      status: "ready",
      message: "OneDrive service account is configured",
      timestamp: new Date().toISOString()
    });
  });

  // OAuth2 callback endpoint
  app.get("/auth/callback", async (req, res) => {
    try {
      const code = req.query.code;
      const state = req.query.state; // slackUserId

      if (!code) {
        return res.status(400).json({ error: "No authorization code provided" });
      }

      // Import token management
      const tokenManager = await import('./tokenManager.js');
      const onedriveAuth = await import('./onedriveAuth.js');

      // Exchange code for tokens
      const tokens = await onedriveAuth.getTokens(code);

      // Save tokens for the user
      tokenManager.saveTokens(state, tokens);

      res.json({
        status: "success",
        message: "Successfully authenticated with OneDrive",
        userId: state
      });
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // List files endpoint
  app.get("/api/onedrive/files", async (req, res) => {
    try {
      const userId = req.query.userId;
      
      if (!userId) {
        return res.status(400).json({ error: "userId query parameter required" });
      }

      const tokenManager = await import('./tokenManager.js');
      const OnedriveServiceUser = await import('./onedriveServiceUser.js');

      const tokens = tokenManager.getTokens(userId);
      if (!tokens) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const onedrive = new OnedriveServiceUser.default(tokens.access_token);
      const files = await onedrive.listFiles();

      res.json({ files });
    } catch (error) {
      console.error("Error listing files:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Search files endpoint
  app.get("/api/onedrive/search", async (req, res) => {
    try {
      const userId = req.query.userId;
      const query = req.query.q;

      if (!userId || !query) {
        return res.status(400).json({ error: "userId and q query parameters required" });
      }

      const tokenManager = await import('./tokenManager.js');
      const OnedriveServiceUser = await import('./onedriveServiceUser.js');

      const tokens = tokenManager.getTokens(userId);
      if (!tokens) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const onedrive = new OnedriveServiceUser.default(tokens.access_token);
      const files = await onedrive.searchFiles(query);

      res.json({ files });
    } catch (error) {
      console.error("Error searching files:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get file endpoint
  app.get("/api/onedrive/file/:fileId", async (req, res) => {
    try {
      const userId = req.query.userId;
      const fileId = req.params.fileId;

      if (!userId) {
        return res.status(400).json({ error: "userId query parameter required" });
      }

      const tokenManager = await import('./tokenManager.js');
      const OnedriveServiceUser = await import('./onedriveServiceUser.js');

      const tokens = tokenManager.getTokens(userId);
      if (!tokens) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const onedrive = new OnedriveServiceUser.default(tokens.access_token);
      const file = await onedrive.getFile(fileId);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(file);
    } catch (error) {
      console.error("Error getting file:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
