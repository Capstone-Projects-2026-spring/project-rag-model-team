# OneDrive API Usage Guide

Quick reference for working with OneDrive in your application.

## Basic Setup

### Importing the Services

```javascript
import OnedriveServiceUser from './microsoft_api/onedriveServiceUser.js';
import * as tokenManager from './microsoft_api/tokenManager.js';
```

## Common Operations

### 1. Get User's Access Token

```javascript
// Get a valid token (automatically refreshes if expired)
const userId = req.user_id; // or event.user from Slack
const accessToken = await tokenManager.getValidAccessToken(userId);

if (!accessToken) {
  // User needs to authenticate
  return res.status(401).json({ error: 'User not authenticated' });
}
```

### 2. Create OneDrive Service Instance

```javascript
const onedrive = new OnedriveServiceUser(accessToken);
```

### 3. List Files

```javascript
// List files in root directory (default: 50 files)
const files = await onedrive.listFiles();

// List with custom page size
const files = await onedrive.listFiles(100);

// List files in a specific folder
const files = await onedrive.listFiles(50, 'folder_id_here');

// Returns: Array of file objects
// Each file contains: id, name, webUrl, lastModifiedDateTime, size, file
```

### 4. Search Files

```javascript
// Search for files by name
const results = await onedrive.searchFiles('project-doc');

// Search with custom page size
const results = await onedrive.searchFiles('budget', 20);

// Returns: Array of matching files
```

### 5. Get File by ID

```javascript
// Download file content as buffer
const buffer = await onedrive.getFile(fileId);

// Get file as text
const text = await onedrive.getFileAsText(fileId);

// Get file as JSON
const json = await onedrive.getFileAsJSON(fileId);
```

### 6. Get File Metadata

```javascript
const metadata = await onedrive.getFileMetadata(fileId);
// Returns: id, name, webUrl, lastModifiedDateTime, size, createdBy, description
```

### 7. List JSON Files

```javascript
// Filter for only .json files
const jsonFiles = await onedrive.listJsonFiles();
```

### 8. Retrieve Document from OneDrive

```javascript
// Search for and retrieve a document
const doc = await onedrive.retrieveFromOneDrive('my-project-doc');
// Returns: Document object with content, id, webUrl, fileId
```

### 9. Create Folder

```javascript
const newFolder = await onedrive.createFolder('My Folder');

// Create in a specific parent folder
const newFolder = await onedrive.createFolder('Subfolder', 'parent_folder_id');
```

### 10. Upload File

```javascript
// Upload file to root directory
const result = await onedrive.uploadFile('document.json', fileContent);

// Upload to a specific folder
const result = await onedrive.uploadFile('document.json', fileContent, 'folder_id');
```

## Slack Integration Examples

### Check OneDrive Status in Command

```javascript
app.command("/drive-status", async ({ ack, respond, user_id }) => {
  await ack();

  try {
    const accessToken = await tokenManager.getValidAccessToken(user_id);
    
    if (!accessToken) {
      await respond("❌ Not authenticated with OneDrive");
      return;
    }

    const onedrive = new OnedriveServiceUser(accessToken);
    const files = await onedrive.listFiles(1);
    
    await respond("✅ OneDrive is connected");
  } catch (error) {
    await respond(`❌ Error: ${error.message}`);
  }
});
```

### List Files in Command

```javascript
app.command("/drive-files", async ({ ack, respond, user_id }) => {
  await ack();

  try {
    const accessToken = await tokenManager.getValidAccessToken(user_id);
    if (!accessToken) {
      await respond("❌ Please authenticate first");
      return;
    }

    const onedrive = new OnedriveServiceUser(accessToken);
    const files = await onedrive.listFiles(20);

    const fileList = files.map(f => `• ${f.name}`).join('\n');
    await respond(`📁 Your OneDrive files:\n\n${fileList}`);
  } catch (error) {
    await respond(`❌ Error: ${error.message}`);
  }
});
```

### Search Files in Command

```javascript
app.command("/drive-search", async ({ ack, body, respond, user_id }) => {
  await ack();

  const query = body.text.trim();
  if (!query) {
    await respond("Please provide a search term");
    return;
  }

  try {
    const accessToken = await tokenManager.getValidAccessToken(user_id);
    if (!accessToken) {
      await respond("❌ Please authenticate first");
      return;
    }

    const onedrive = new OnedriveServiceUser(accessToken);
    const results = await onedrive.searchFiles(query);

    if (results.length === 0) {
      await respond(`No files found matching "${query}"`);
      return;
    }

    const resultsList = results
      .map(f => `• <${f.webUrl}|${f.name}>`)
      .join('\n');
    
    await respond(`🔍 Found ${results.length} file(s):\n\n${resultsList}`);
  } catch (error) {
    await respond(`❌ Error: ${error.message}`);
  }
});
```

## Error Handling

### Common Errors and Solutions

```javascript
try {
  const onedrive = new OnedriveServiceUser(accessToken);
  const files = await onedrive.listFiles();
} catch (error) {
  if (error.message.includes('401')) {
    // Token expired, try to refresh
    const newTokens = await tokenManager.refreshTokens(userId);
    // Retry operation with new token
  } else if (error.message.includes('403')) {
    // Permission denied
    console.error('User does not have permission');
  } else if (error.message.includes('404')) {
    // File or folder not found
    console.error('Resource not found');
  } else {
    // Other error
    console.error('OneDrive error:', error);
  }
}
```

## Token Management

### Check if Token is Valid

```javascript
const isExpired = tokenManager.isTokenExpired(userId);

if (isExpired) {
  // Token needs refresh
  const newTokens = await tokenManager.refreshTokens(userId);
}
```

### Get Token without Auto-Refresh

```javascript
const tokens = tokenManager.getTokens(userId);
if (tokens) {
  const accessToken = tokens.access_token;
}
```

### Save User Tokens

```javascript
// Called during OAuth callback
const tokens = await onedriveAuth.getTokens(authCode);
tokenManager.saveTokens(userId, tokens);
```

### Remove User Tokens

```javascript
// For logout or user removal
tokenManager.removeTokens(userId);
```

## Advanced Patterns

### Batch Operations

```javascript
async function processAllJsonFiles(userId) {
  const accessToken = await tokenManager.getValidAccessToken(userId);
  const onedrive = new OnedriveServiceUser(accessToken);
  
  const files = await onedrive.listJsonFiles();
  
  for (const file of files) {
    try {
      const content = await onedrive.getFileAsJSON(file.id);
      // Process content
      console.log(`Processed: ${file.name}`);
    } catch (error) {
      console.error(`Failed to process ${file.name}:`, error);
    }
  }
}
```

### Search and Process

```javascript
async function findAndProcess(userId, searchQuery) {
  const accessToken = await tokenManager.getValidAccessToken(userId);
  const onedrive = new OnedriveServiceUser(accessToken);
  
  const results = await onedrive.searchFiles(searchQuery);
  
  for (const file of results) {
    if (file.name.endsWith('.json')) {
      const data = await onedrive.getFileAsJSON(file.id);
      // Process data
    }
  }
}
```

### Upload and Share

```javascript
async function uploadAndShare(userId, fileName, content) {
  const accessToken = await tokenManager.getValidAccessToken(userId);
  const onedrive = new OnedriveServiceUser(accessToken);
  
  const uploaded = await onedrive.uploadFile(fileName, content);
  
  return {
    fileName: uploaded.name,
    link: uploaded.webUrl,
    fileId: uploaded.id
  };
}
```

## File Structure

```
microsoft_api/
├── onedriveAuth.js           # OAuth2 setup
├── onedriveService.js        # App-only authentication
├── onedriveServiceUser.js    # User-based service (main)
├── tokenManager.js           # Token management
├── onedriveRoutes.js        # Express routes
└── tokens.json              # User tokens (auto-created)
```

## API Response Examples

### File Object

```javascript
{
  "id": "file_id_123",
  "name": "document.json",
  "webUrl": "https://1drv.ms/...",
  "lastModifiedDateTime": "2026-04-19T10:30:00Z",
  "size": 2048,
  "file": {
    "mimeType": "application/json"
  },
  "createdBy": {
    "user": {
      "displayName": "John Doe",
      "id": "user_id"
    }
  }
}
```

### Search Results

```javascript
[
  {
    "id": "file_id_1",
    "name": "report.json",
    "webUrl": "https://1drv.ms/...",
    "file": { /* ... */ }
  },
  {
    "id": "file_id_2",
    "name": "report-v2.json",
    "webUrl": "https://1drv.ms/...",
    "file": { /* ... */ }
  }
]
```

## Useful Links

- [Microsoft Graph File Operations](https://docs.microsoft.com/en-us/graph/api/resources/driveitem)
- [Search Files Documentation](https://docs.microsoft.com/en-us/graph/api/driveitem-search)
- [Upload Content Documentation](https://docs.microsoft.com/en-us/graph/api/driveitem-put-content)

## Environment Variables Required

```env
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:3001/auth/callback
```

---

For more details, see [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md)
