import { Client } from "@microsoft/microsoft-graph-client";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// For service account (daemon app) authentication
const SERVICE_ACCOUNT_KEY_PATH = process.env.MICROSOFT_SERVICE_ACCOUNT_KEY_PATH || path.join(__dirname, '..', 'service-account-key.json');

let graphClient;
let isInitialized = false;

async function initializeGraphClient() {
  if (graphClient) return graphClient;

  const tokenProvider = async () => {
    // Get token for service account or user
    const token = await getAccessToken();
    return token;
  };

  graphClient = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: tokenProvider
    }
  });

  isInitialized = true;
  return graphClient;
}

async function getAccessToken() {
  // This should use MSAL or your token storage to get a valid access token
  // For service account authentication, you'd need to implement app-only auth flow
  try {
    // Implementation depends on your auth strategy
    // This is a placeholder that should be filled based on your auth setup
    throw new Error("Token provider not implemented. Use onedriveServiceUser.js for user-based auth");
  } catch (error) {
    console.error("Error getting access token:", error);
    throw error;
  }
}

export async function getGraphClient() {
  if (!isInitialized) {
    await initializeGraphClient();
  }
  return graphClient;
}

export async function isConnected() {
  try {
    const client = await getGraphClient();
    const result = await client.api('/me').get();
    return !!result;
  } catch (error) {
    console.error("Error checking connection:", error);
    return false;
  }
}

export async function listFiles(pageSize = 50, folderId = null) {
  try {
    const client = await getGraphClient();

    let endpoint = "/me/drive/root/children";
    
    if (folderId) {
      endpoint = `/me/drive/items/${folderId}/children`;
    }

    const res = await client.api(endpoint)
      .filter("file ne null")
      .top(pageSize)
      .orderby("lastModifiedDateTime desc")
      .get();

    return res.value || [];
  } catch (error) {
    console.error("Error listing files:", error.message);
    throw error;
  }
}

export async function getFile(fileId) {
  try {
    const client = await getGraphClient();

    const file = await client
      .api(`/me/drive/items/${fileId}/content`)
      .get();

    return file;
  } catch (error) {
    console.error("Error getting file:", error.message);
    throw error;
  }
}

export async function searchFiles(query, pageSize = 20) {
  try {
    const client = await getGraphClient();

    // OneDrive search uses the /me/drive/root/search endpoint
    const res = await client
      .api("/me/drive/root/search(q='{query}')")
      .get();

    return (res.value || []).slice(0, pageSize);
  } catch (error) {
    console.error("Error searching files:", error.message);
    throw error;
  }
}

export async function getFileMetadata(fileId) {
  try {
    const client = await getGraphClient();

    const res = await client
      .api(`/me/drive/items/${fileId}`)
      .select("id,name,description,file,webUrl,lastModifiedDateTime,size,createdBy")
      .get();

    return res;
  } catch (error) {
    console.error("Error getting file metadata:", error.message);
    throw error;
  }
}

export async function createFolder(folderName, parentFolderId = null) {
  try {
    const client = await getGraphClient();

    let parentPath = "/me/drive/root";
    if (parentFolderId) {
      parentPath = `/me/drive/items/${parentFolderId}`;
    }

    const newFolder = await client
      .api(`${parentPath}/children`)
      .post({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename"
      });

    return newFolder;
  } catch (error) {
    console.error("Error creating folder:", error.message);
    throw error;
  }
}

export async function uploadFile(fileName, fileContent, parentFolderId = null) {
  try {
    const client = await getGraphClient();

    let parentPath = "/me/drive/root";
    if (parentFolderId) {
      parentPath = `/me/drive/items/${parentFolderId}`;
    }

    const uploadSession = await client
      .api(`${parentPath}:/${fileName}:/createUploadSession`)
      .post({});

    // Upload file using upload session
    const result = await client
      .api(uploadSession.uploadUrl)
      .put(fileContent);

    return result;
  } catch (error) {
    console.error("Error uploading file:", error.message);
    throw error;
  }
}
