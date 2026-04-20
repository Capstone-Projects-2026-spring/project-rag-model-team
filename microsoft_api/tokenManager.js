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
    allTokens[slackUserId] = {
      ...tokens,
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()
    };
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

export function isTokenExpired(slackUserId) {
  const tokens = getTokens(slackUserId);
  if (!tokens || !tokens.expiresAt) {
    return true;
  }
  return new Date() > new Date(tokens.expiresAt);
}

export async function refreshTokens(slackUserId) {
  try {
    const tokens = getTokens(slackUserId);
    if (!tokens || !tokens.refresh_token) {
      throw new Error("No refresh token available");
    }

    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/.default offline_access'
      }).toString()
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const newTokens = await response.json();
    saveTokens(slackUserId, newTokens);
    return newTokens;
  } catch (error) {
    console.error('Error refreshing tokens:', error);
    throw error;
  }
}

export async function getValidAccessToken(slackUserId) {
  try {
    if (isTokenExpired(slackUserId)) {
      const tokens = await refreshTokens(slackUserId);
      return tokens.access_token;
    }

    const tokens = getTokens(slackUserId);
    return tokens.access_token;
  } catch (error) {
    console.error('Error getting valid access token:', error);
    throw error;
  }
}
