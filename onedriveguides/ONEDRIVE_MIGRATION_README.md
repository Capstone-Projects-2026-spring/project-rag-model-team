# OneDrive Migration - Complete Guide

## 🎯 Overview

This project has been successfully migrated from **Google Drive API** to **Microsoft OneDrive/Graph API**. All file operations now use OneDrive for accessing and managing documents.

## 📚 Documentation

Start with one of these guides based on your role:

### 👤 For Users
- **[QUICKSTART.md](./QUICKSTART.md)** - Get up and running in 5 minutes
- **[ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md)** - Detailed setup instructions

### 👨‍💻 For Developers
- **[ONEDRIVE_API_USAGE.md](./ONEDRIVE_API_USAGE.md)** - Code examples and API reference
- **[MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md)** - What changed and why

### 🚀 For DevOps/Deployment
- **[DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)** - Pre-deployment verification

## 🚀 Quick Start (5 minutes)

### Step 1: Create Azure App
1. Go to [Azure Portal](https://portal.azure.com)
2. Create **App Registration**
3. Grant permissions: `Files.Read.All`, `Files.ReadWrite.All`, `offline_access`
4. Copy Client ID and create Client Secret

### Step 2: Configure Environment
```bash
# Create .env file
cat > .env << 'EOF'
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:3001/auth/callback
SLACK_BOT_TOKEN=your_slack_token
SLACK_APP_TOKEN=your_app_token
EOF
```

### Step 3: Install & Run
```bash
npm install
npm start
```

### Step 4: Test in Slack
```
/drive-status        # Check connection
/drive-files         # List files
/drive-search docs   # Search
```

## 📋 What Changed

### New Modules (5 files)
✨ **`microsoft_api/`** directory:
- `onedriveAuth.js` - OAuth2 authentication
- `onedriveService.js` - Service-based access
- `onedriveServiceUser.js` - User-based access
- `tokenManager.js` - Token management
- `onedriveRoutes.js` - Express routes

### Updated Files (6 files)
🔄 Core files updated for OneDrive:
- `index.js` - Bot main logic
- `document-retriever.js` - Document retrieval
- `drive-document-retriever.js` - File operations
- `google_api/slack.js` - Slack commands
- `package.json` - Dependencies
- `.env.example` - Configuration

### Legacy Files (3 files)
📦 No longer used but kept for reference:
- `google_api/googleAuth.js`
- `google_api/driveService.js`
- `google_api/db.js`

## 🔑 Key Features

### ✅ User Authentication
- OAuth2 flow with Microsoft Identity
- Per-user token management
- Automatic token refresh
- Secure token storage

### ✅ File Operations
- List files from OneDrive
- Search files by name
- Download file content
- Upload new files
- Create folders

### ✅ Slack Integration
- `/drive-status` - Check authentication
- `/drive-files` - List files
- `/drive-search` - Search files
- `/drive-help` - Show commands

### ✅ Document Management
- Auto-classify documents
- Tag documents
- Sync from OneDrive
- JSON file parsing

## 📦 Dependencies Added

```json
"@microsoft/microsoft-graph-client": "^3.0.8",
"@microsoft/microsoft-graph-types": "^2.42.0",
"msal-node": "^1.18.4"
```

## 🔄 API Comparison

### File Listing
```javascript
// Google Drive
drive.files.list({ q: "...", fields: "files(id, name)" })

// OneDrive
fetch('/me/drive/root/children', { headers: { Authorization: `Bearer ${token}` } })
```

### File Search
```javascript
// Google Drive
drive.files.list({ q: `name contains '${query}'` })

// OneDrive
fetch(`/me/drive/root/search(q='${query}')`, { headers })
```

### File Download
```javascript
// Google Drive
drive.files.get({ fileId, alt: 'media' })

// OneDrive
fetch(`/me/drive/items/${fileId}/content`, { headers })
```

## 🛡️ Security

### Token Management
- Tokens stored with expiration time
- Auto-refresh before expiration
- Secure token removal on logout
- Per-user token isolation

### API Permissions
- Minimal required permissions
- User-specific file access
- No service account needed
- Configurable scopes

### Authentication
- Microsoft OAuth2
- Encrypted communication (HTTPS)
- Token validation
- Error handling

## 🧪 Testing Commands

```bash
# Check connection
/drive-status

# List files
/drive-files

# Search files
/drive-search project-doc

# List commands
/drive-help

# Sync documents
/sync-docs

# View all available commands
help
commands
```

## ⚙️ Configuration

### Required Environment Variables
```env
MICROSOFT_CLIENT_ID=<Azure App ID>
MICROSOFT_CLIENT_SECRET=<Azure Secret>
MICROSOFT_REDIRECT_URI=<Callback URL>
SLACK_BOT_TOKEN=<Slack Token>
SLACK_APP_TOKEN=<Slack App Token>
```

### Optional Variables
```env
ONEDRIVE_FOLDER_ID=<Specific folder>
LOG_LEVEL=info
NODE_ENV=development
PORT=3001
```

## 📊 File Structure

```
project-root/
├── microsoft_api/           ← NEW
│   ├── onedriveAuth.js
│   ├── onedriveService.js
│   ├── onedriveServiceUser.js
│   ├── tokenManager.js
│   ├── onedriveRoutes.js
│   └── tokens.json
├── logic/
│   ├── graphql_setup/
│   ├── langChain/
│   ├── security/
│   ├── github/
│   └── database/
├── google_api/              ← UPDATED
│   └── slack.js
├── document-retriever.js    ← UPDATED
├── drive-document-retriever.js ← UPDATED
├── index.js                 ← UPDATED
├── package.json             ← UPDATED
├── .env.example             ← UPDATED
├── QUICKSTART.md            ← NEW
├── ONEDRIVE_SETUP.md       ← NEW
├── MIGRATION_SUMMARY.md    ← NEW
├── ONEDRIVE_API_USAGE.md   ← NEW
└── DEPLOYMENT_CHECKLIST.md ← NEW
```

## 🚨 Common Issues

### "User not authenticated"
**Solution**: Complete OAuth flow by authenticating with Microsoft

### "HTTP 401 Unauthorized"
**Solution**: Check token validity; token refresh should handle this automatically

### "HTTP 403 Forbidden"
**Solution**: Verify API permissions in Azure app registration

### "Files not loading"
**Solution**: 
1. Verify user is authenticated: `/drive-status`
2. Check OneDrive has files
3. Verify file access permissions

See [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md) for more troubleshooting.

## 📖 Documentation Links

| Document | Purpose |
|----------|---------|
| [QUICKSTART.md](./QUICKSTART.md) | 5-minute setup guide |
| [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md) | Detailed setup instructions |
| [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md) | Migration details and changes |
| [ONEDRIVE_API_USAGE.md](./ONEDRIVE_API_USAGE.md) | Developer API reference |
| [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) | Production deployment guide |

## ✅ Verification Steps

After setup, verify everything works:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
# Edit .env with your Microsoft credentials

# 3. Start application
npm start

# 4. Test Slack commands
/drive-status        # Should show connected ✅
/drive-files         # Should list files ✅
/drive-search test   # Should find matches ✅
```

## 🤝 Support

### Documentation
- Setup issues: See [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md)
- API usage: See [ONEDRIVE_API_USAGE.md](./ONEDRIVE_API_USAGE.md)
- Deployment: See [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)

### Debugging
1. Check error logs: `console` output
2. Verify `.env` configuration
3. Confirm Azure app permissions
4. Check `microsoft_api/tokens.json` for user tokens
5. Review [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md) troubleshooting

## 📚 Additional Resources

- [Microsoft Graph API](https://docs.microsoft.com/graph/)
- [OneDrive API Reference](https://docs.microsoft.com/onedrive/developer/)
- [Azure Portal](https://portal.azure.com)
- [MSAL Documentation](https://github.com/AzureAD/microsoft-authentication-library-for-js)

## ✨ Migration Benefits

✅ **User-based access** - No service account needed
✅ **Auto token refresh** - Handles expiration automatically
✅ **Better security** - User-specific permissions
✅ **Per-user isolation** - Each user has separate access
✅ **Enterprise ready** - Uses Microsoft Graph API
✅ **Scalable** - Supports multiple users natively

## 📝 Next Steps

1. **Setup**: Follow [QUICKSTART.md](./QUICKSTART.md) (5 min)
2. **Configure**: Create Azure app and `.env` file
3. **Install**: Run `npm install`
4. **Test**: Start bot and test Slack commands
5. **Deploy**: Follow [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)

---

**Migration Completed** ✅ April 2026

For questions or issues, refer to the documentation above or check the troubleshooting sections.
