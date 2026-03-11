import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'tokens.json');

function loadTokens() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return {};
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading tokens:', err);
    return {};
  }
}

export function getTokens(slackUserId) {
  const tokens = loadTokens();
  return tokens[slackUserId] || null;
}

export function saveTokens(slackUserId, tokens) {
  try {
    const allTokens = loadTokens();
    allTokens[slackUserId] = tokens;
    fs.writeFileSync(DB_FILE, JSON.stringify(allTokens, null, 2));
  } catch (err) {
    console.error('Error saving tokens:', err);
  }
}

export function removeTokens(slackUserId) {
  try {
    const allTokens = loadTokens();
    delete allTokens[slackUserId];
    fs.writeFileSync(DB_FILE, JSON.stringify(allTokens, null, 2));
  } catch (err) {
    console.error('Error removing tokens:', err);
  }
}
