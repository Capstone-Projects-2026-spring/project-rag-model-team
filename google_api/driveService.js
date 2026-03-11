import { google } from "googleapis";
import * as db from "./db.js";

export async function getDriveClient(slackUserId) {
  const tokens = db.getTokens(slackUserId);

  if (!tokens) {
    throw new Error("User not authenticated with Google Drive");
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/oauth2callback"
  );
  auth.setCredentials(tokens);

  return google.drive({ version: "v3", auth });
}

export async function listFiles(slackUserId, pageSize = 10) {
  try {
    const drive = await getDriveClient(slackUserId);

    const res = await drive.files.list({
      pageSize: pageSize,
      fields: "files(id, name, mimeType, webViewLink)",
      q: "mimeType='application/json' and trashed=false"
    });

    return res.data.files || [];
  } catch (error) {
    console.error("Error listing files:", error);
    throw error;
  }
}

export async function getFile(slackUserId, fileId) {
  try {
    const drive = await getDriveClient(slackUserId);

    const file = await drive.files.get(
      {
        fileId: fileId,
        alt: "media"
      },
      { responseType: "stream" }
    );

    return file.data;
  } catch (error) {
    console.error("Error getting file:", error);
    throw error;
  }
}

export async function searchFiles(slackUserId, query) {
  try {
    const drive = await getDriveClient(slackUserId);

    const res = await drive.files.list({
      pageSize: 10,
      fields: "files(id, name, mimeType, webViewLink)",
      q: `name contains '${query}' and mimeType='application/json' and trashed=false`
    });

    return res.data.files || [];
  } catch (error) {
    console.error("Error searching files:", error);
    throw error;
  }
}
