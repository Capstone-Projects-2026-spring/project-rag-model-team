import { google } from "googleapis";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load service account credentials
const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || path.join(__dirname, '..', 'service-account-key.json');

let auth;
let isInitialized = false;

try {
  if (fs.existsSync(SERVICE_ACCOUNT_KEY_PATH)) {
    const keyFile = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf8'));
    auth = new google.auth.GoogleAuth({
      credentials: keyFile,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    isInitialized = true;
    console.log('✅ Service account loaded successfully');
  } else {
    console.warn('⚠️ Service account key file not found at:', SERVICE_ACCOUNT_KEY_PATH);
  }
} catch (error) {
  console.error('❌ Error loading service account:', error.message);
}

export async function getDriveClient() {
  if (!auth || !isInitialized) {
    throw new Error("Service account not configured. Please add service-account-key.json");
  }

  return google.drive({ version: "v3", auth });
}

export async function isConnected() {
  return isInitialized;
}

const SUPPORTED_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "application/json",
];

const MIME_FILTER = SUPPORTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(" or ");

export async function listFiles(pageSize = 50) {
  try {
    const drive = await getDriveClient();

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const folderClause = folderId ? ` and '${folderId}' in parents` : "";
    const query = `(${MIME_FILTER}) and trashed=false${folderClause}`;

    const res = await drive.files.list({
      pageSize: pageSize,
      fields: "files(id, name, description, mimeType, webViewLink, modifiedTime, size)",
      q: query,
      orderBy: "modifiedTime desc"
    });

    return res.data.files || [];
  } catch (error) {
    console.error("Error listing files:", error.message);
    throw error;
  }
}

export async function getFile(fileId) {
  try {
    const drive = await getDriveClient();

    const file = await drive.files.get(
      {
        fileId: fileId,
        alt: "media"
      },
      { responseType: "stream" }
    );

    return file.data;
  } catch (error) {
    console.error("Error getting file:", error.message);
    throw error;
  }
}

export async function getFileContent(fileId, mimeType) {
  const drive = await getDriveClient();

  if (mimeType === "application/vnd.google-apps.document") {
    const res = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "stream" }
    );
    return { stream: res.data, format: "text" };
  }
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export(
      { fileId, mimeType: "text/csv" },
      { responseType: "stream" }
    );
    return { stream: res.data, format: "text" };
  }

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  return { stream: res.data, format: mimeType };
}

export async function searchFiles(query, pageSize = 20) {
  try {
    const drive = await getDriveClient();

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const folderClause = folderId ? ` and '${folderId}' in parents` : "";
    const searchQuery = `name contains '${query}' and (${MIME_FILTER}) and trashed=false${folderClause}`;

    const res = await drive.files.list({
      pageSize,
      fields: "files(id, name, description, mimeType, webViewLink, modifiedTime)",
      q: searchQuery,
      orderBy: "modifiedTime desc"
    });

    return res.data.files || [];
  } catch (error) {
    console.error("Error searching files:", error.message);
    throw error;
  }
}

export async function getFileMetadata(fileId) {
  try {
    const drive = await getDriveClient();

    const res = await drive.files.get({
      fileId: fileId,
      fields: "id, name, description, mimeType, webViewLink, modifiedTime, size, owners"
    });

    return res.data;
  } catch (error) {
    console.error("Error getting file metadata:", error.message);
    throw error;
  }
}
