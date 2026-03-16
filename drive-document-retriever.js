import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEYFILE_PATH = path.join(__dirname, 'service-account-key.json');

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE_PATH,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });

async function listJsonFiles() {
  const res = await drive.files.list({
    q: "mimeType='application/json'",
    fields: 'files(id, name)',
    pageSize: 200,
  });
  return res.data.files || [];
}

async function downloadJsonFile(fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  let body = '';
  for await (const chunk of res.data) {
    body += chunk;
  }
  return JSON.parse(body);
}

export async function retrieveFromDrive(query) {
  const files = await listJsonFiles();
  for (const f of files) {
    const doc = await downloadJsonFile(f.id);
    if (
      doc.name?.toLowerCase().includes(query.toLowerCase()) ||
      doc.id?.toLowerCase().includes(query.toLowerCase())
    ) {
      return doc;
    }
  }
  return null;
}