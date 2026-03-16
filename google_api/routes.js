// Service Account Routes - No OAuth needed

export default function (app) {
  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "Slack bot is running with service account" });
  });

  // Status endpoint
  app.get("/drive-status", (req, res) => {
    res.json({ 
      status: "ready",
      message: "Google Drive service account is configured",
      timestamp: new Date().toISOString()
    });
  });
}
