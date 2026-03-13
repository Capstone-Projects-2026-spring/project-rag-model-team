import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/oauth2callback"
);

export function generateAuthUrl(slackUserId) {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file"
    ],
    state: slackUserId
  });
}

export async function getTokens(code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export { oauth2Client };
