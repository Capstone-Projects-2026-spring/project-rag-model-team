import { PublicClientApplication } from "@azure/msal-node";

const msalConfig = {
  auth: {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    authority: "https://login.microsoftonline.com/common",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message) {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: "Info",
    },
  },
};

const pca = new PublicClientApplication(msalConfig);

const redirectUri = process.env.MICROSOFT_REDIRECT_URI || "http://localhost:3001/auth/callback";

export function generateAuthUrl(slackUserId) {
  const authCodeUrlParameters = {
    scopes: [
      "https://graph.microsoft.com/.default",
      "offline_access"
    ],
    redirectUri: redirectUri,
    state: slackUserId,
    prompt: "select_account"
  };

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.MICROSOFT_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(authCodeUrlParameters.scopes.join(' '))}&state=${slackUserId}`;
}

export async function getTokens(code) {
  const scopes = [
    "https://graph.microsoft.com/.default",
    "offline_access"
  ];

  try {
    // Using msal-node's confidential client application
    const response = await new Promise((resolve, reject) => {
      const axios = require('axios');
      axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: scopes.join(' ')
      }).then(resolve).catch(reject);
    });

    return response.data;
  } catch (error) {
    console.error("Error getting tokens:", error);
    throw error;
  }
}

export { pca };
