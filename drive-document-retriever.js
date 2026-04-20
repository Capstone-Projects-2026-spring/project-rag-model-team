import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// OneDrive Graph API configuration
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

async function listJsonFilesFromOneDrive(accessToken) {
  try {
    const response = await fetch(
      `${GRAPH_API_BASE}/me/drive/root/children?$filter=file ne null&$top=200`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (data.value || []).filter(f => f.name && f.name.endsWith('.json'));
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
}

async function downloadJsonFileFromOneDrive(fileId, accessToken) {
  try {
    const response = await fetch(
      `${GRAPH_API_BASE}/me/drive/items/${fileId}/content`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    return JSON.parse(body);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

export async function retrieveFromOneDrive(query, accessToken) {
  try {
    const files = await listJsonFilesFromOneDrive(accessToken);
    
    for (const f of files) {
      try {
        const doc = await downloadJsonFileFromOneDrive(f.id, accessToken);
        if (
          doc.name?.toLowerCase().includes(query.toLowerCase()) ||
          doc.id?.toLowerCase().includes(query.toLowerCase())
        ) {
          return {
            ...doc,
            fileId: f.id,
            source: 'onedrive'
          };
        }
      } catch (error) {
        console.warn(`Could not parse file ${f.name}:`, error.message);
      }
    }
    return null;
  } catch (error) {
    console.error('Error retrieving from OneDrive:', error);
    throw error;
  }
}