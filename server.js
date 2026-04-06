const express = require("express");
const appServer = express();

const PORT = process.env.PORT || 3000;

appServer.get("/", (req, res) => {
  res.send("Slack bot is running");
});

appServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});