# Google Drive to OneDrive Migration Summary

## Overview
Your application has been successfully migrated from Google Drive API to Microsoft OneDrive/Microsoft Graph API. All file operations now use OneDrive instead of Google Drive.

## Changes Made

### 1. Dependencies Updated
**package.json**
- ❌ Removed: `googleapis` (Google API client)
- ✅ Added: 
  - `@microsoft/microsoft-graph-client` - Microsoft Graph API client
  - `@microsoft/microsoft-graph-types` - TypeScript types for Microsoft Graph
  - `msal-node` - Microsoft Authentication Library

### 2. New Files Created

#### Microsoft API Modules
- **`microsoft_api/onedriveAuth.js`**
  - OAuth2 authentication with Microsoft Identity
  - Generates authorization URLs
  - Exchanges authorization codes for tokens

- **`microsoft_api/onedriveService.js`**
  - High-level OneDrive service for app-only authentication
  - Lists files, searches, downloads, uploads
  - For daemon/service account scenarios

- **`microsoft_api/onedriveServiceUser.js`**
  - OneDrive service for user-based authentication
  - Makes authenticated requests using user's access token
  - Can retrieve files as JSON, text, or binary
  - Implements search and list operations

- **`microsoft_api/tokenManager.js`**
  - Stores and manages user tokens in `tokens.json`
  - Handles token expiration checking
  - Automatic token refresh using refresh tokens
  - Gets valid access tokens for authenticated requests

- **`microsoft_api/onedriveRoutes.js`**
  - Express routes for OAuth2 callback handling
  - REST endpoints for file operations
  - OAuth callback receives authorization code and exchanges for tokens

### 3. Modified Files

#### Core Application
- **`index.js`**
  - ❌ Removed import: `{ listFiles } from "./google_api/driveService.js"`
  - ✅ Added imports: `tokenManager`, `OnedriveServiceUser`
  - Updated `/sync-docs` command to use OneDrive via access tokens

#### Document Retrieval
- **`document-retriever.js`**
  - ❌ Removed: Google Drive service import
  - ✅ Added: OneDrive service and token manager imports
  - Updated `retrieveDocumentFromDrive()` → `retrieveDocumentFromOneDrive()`
  - Now handles user authentication and token validation

- **`drive-document-retriever.js`**
  - ❌ Removed: All Google Drive API code
  - ✅ Added: Microsoft Graph API client using fetch
  - New functions: `retrieveFromOneDrive()`, `listJsonFilesFromOneDrive()`, `downloadJsonFileFromOneDrive()`
  - Connects directly to Microsoft Graph API endpoint

#### Slack Integration
- **`google_api/slack.js`**
  - ❌ Removed: Google Drive service commands
  - ✅ Added: OneDrive service commands
  - Commands updated:
    - `/drive-status` - Check OneDrive authentication
    - `/drive-files` - List OneDrive files
    - `/drive-search` - Search OneDrive files
    - `/drive-help` - Show OneDrive commands
  - Now uses user's access token for operations

#### Configuration
- **`.env.example`**
  - ❌ Removed: Google Drive configuration
  - ✅ Added: Microsoft configuration
    - `MICROSOFT_CLIENT_ID`
    - `MICROSOFT_CLIENT_SECRET`
    - `MICROSOFT_REDIRECT_URI`

### 4. File Structure

New directory structure:
```
project-root/
├── microsoft_api/
│   ├── onedriveAuth.js           (OAuth2 setup)
│   ├── onedriveService.js        (App-only auth service)
│   ├── onedriveServiceUser.js    (User-based service)
│   ├── tokenManager.js            (Token storage/refresh)
│   ├── onedriveRoutes.js         (Express routes)
│   └── tokens.json               (User tokens - auto-generated)
├── google_api/
│   ├── slack.js                  (Updated for OneDrive)
│   ├── routes.js                 (Can be kept for other APIs)
│   ├── db.js                     (Legacy - can be removed)
│   ├── googleAuth.js             (Legacy - no longer used)
│   └── driveService.js           (Legacy - no longer used)
├── document-retriever.js         (Updated)
├── drive-document-retriever.js   (Updated)
├── index.js                      (Updated)
├── .env.example                  (Updated)
└── ONEDRIVE_SETUP.md            (New - setup guide)
```

## Authentication Flow

### Old Google Drive Flow
```
Service Account → Google OAuth2 → Access Google Drive
```

### New OneDrive Flow
```
User → Microsoft OAuth2 → Get Access Token → Access OneDrive
                                ↓
                         Token Refresh Logic
                                ↓
                         Token Storage (tokens.json)
```

## Key Differences

| Aspect | Google Drive | OneDrive |
|--------|-------------|----------|
| **Auth Method** | Service Account | User-Based OAuth2 |
| **API Client** | googleapis | @microsoft/microsoft-graph-client |
| **Token Storage** | None (service account) | JSON file (with refresh tokens) |
| **Token Expiration** | N/A | Yes (auto-refresh) |
| **User Session** | Not applicable | Required per user |
| **API Endpoint** | `drive.files.list()` | `/me/drive/root/children` |
| **Permissions** | Predefined scopes | Configurable scopes |

## API Mappings

### File Listing
```javascript
// Google Drive
const files = await drive.files.list({ q: "...", fields: "files(id, name)" });

// OneDrive
const response = await fetch('/me/drive/root/children', { headers: { Authorization: `Bearer ${token}` } });
```

### File Download
```javascript
// Google Drive
const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });

// OneDrive
const res = await fetch(`/me/drive/items/${fileId}/content`, { headers: { Authorization: `Bearer ${token}` } });
```

### File Search
```javascript
// Google Drive
const res = await drive.files.list({ q: `name contains '${query}'` });

// OneDrive
const res = await fetch(`/me/drive/root/search(q='${query}')`, { headers: { Authorization: `Bearer ${token}` } });
```

## Environment Setup Required

Before running the application, you must:

1. **Create Microsoft Azure App Registration**
   - Go to Azure Portal
   - Create app with redirect URI: `http://localhost:3001/auth/callback`
   - Get Client ID and Client Secret

2. **Grant API Permissions**
   - Files.Read.All
   - Files.ReadWrite.All
   - offline_access

3. **Update .env File**
   ```env
   MICROSOFT_CLIENT_ID=your_id
   MICROSOFT_CLIENT_SECRET=your_secret
   MICROSOFT_REDIRECT_URI=http://localhost:3001/auth/callback
   ```

4. **Install Dependencies**
   ```bash
   npm install
   ```

See [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md) for detailed setup instructions.

## Slack Commands Updated

### New Command Structure
All commands now require user to be authenticated with OneDrive first.

- `/drive-status` - Shows authentication status
- `/drive-files` - Lists files from user's OneDrive
- `/drive-search <query>` - Searches OneDrive files
- `/drive-help` - Shows help for OneDrive commands

### Commands Behavior
Commands now work per-user:
- Each user's access token is managed separately
- Tokens auto-refresh when expired
- User authentication required before operations

## Legacy Files

The following files are no longer actively used but kept for reference:
- `google_api/googleAuth.js`
- `google_api/driveService.js`
- `google_api/db.js`

These can be safely removed after confirming all functionality works.

## Token Management

### Token Storage
Tokens stored in `microsoft_api/tokens.json`:
```json
{
  "slack_user_id": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 3600,
    "expiresAt": "ISO-datetime",
    "savedAt": "ISO-datetime"
  }
}
```

### Automatic Refresh
- Tokens are checked before each operation
- Expired tokens are automatically refreshed
- Refresh tokens enable long-term access without re-authentication

### Manual Token Refresh
```javascript
import * as tokenManager from './microsoft_api/tokenManager.js';

// Get valid token (auto-refreshes if needed)
const token = await tokenManager.getValidAccessToken(userId);

// Manual refresh
const newTokens = await tokenManager.refreshTokens(userId);
```

## Error Handling

### Common Issues

1. **"User not authenticated"**
   - User needs to complete OAuth flow
   - Check tokens.json exists and has user entry

2. **"HTTP 401 Unauthorized"**
   - Token may be invalid or expired
   - Try manual refresh: `/api/onedrive/refresh`

3. **"HTTP 403 Forbidden"**
   - Missing API permissions in Azure app
   - Grant additional scopes in Azure Portal

## Testing the Migration

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables in .env
MICROSOFT_CLIENT_ID=your_id
MICROSOFT_CLIENT_SECRET=your_secret
MICROSOFT_REDIRECT_URI=http://localhost:3001/auth/callback

# 3. Start application
npm start

# 4. In Slack, test commands
/drive-status        # Check connection
/drive-files         # List files
/drive-search test   # Search files
/sync-docs          # Sync and classify documents
```

## Rollback Instructions

To revert to Google Drive:
1. Restore original files from git history
2. Restore `package.json` dependencies
3. Remove `microsoft_api/` directory
4. Update imports in `index.js`, `document-retriever.js`, etc.
5. Update `.env` with Google Drive config
6. Run `npm install`

## Next Steps

1. ✅ Review and test all functionality
2. ✅ Update deployment configurations
3. ✅ Test OAuth flow with real users
4. ✅ Monitor token refresh operations
5. ✅ Update documentation for end users
6. ✅ Set up token refresh error alerts

## Support & Documentation

- [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md) - Detailed setup guide
- [Microsoft Graph API Docs](https://docs.microsoft.com/graph/)
- [OneDrive API Reference](https://docs.microsoft.com/onedrive/developer/)
- [Azure Portal](https://portal.azure.com)

---

**Migration Date**: April 2026
**Status**: ✅ Complete
