# Quick Start: OneDrive Migration

## What Changed?

Your app now uses **Microsoft OneDrive** instead of Google Drive. Here's what you need to do:

## 1️⃣ Setup Azure App (5 minutes)

1. Go to [Azure Portal](https://portal.azure.com)
2. Create new **App Registration**
3. Copy **Client ID** and create **Client Secret**
4. Add **API Permissions**: `Files.Read.All`, `Files.ReadWrite.All`, `offline_access`
5. Set **Redirect URI**: `http://localhost:3001/auth/callback`

## 2️⃣ Update Configuration (2 minutes)

Create `.env` file:
```env
MICROSOFT_CLIENT_ID=your_client_id_here
MICROSOFT_CLIENT_SECRET=your_client_secret_here
MICROSOFT_REDIRECT_URI=http://localhost:3001/auth/callback
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_APP_TOKEN=xapp-your-token
```

## 3️⃣ Install & Run (3 minutes)

```bash
npm install
npm start
```

## 4️⃣ Test in Slack

```
/drive-status    # Check if authenticated
/drive-files     # List your OneDrive files
/drive-search doc-name   # Search for files
/drive-help      # Show all commands
```

## 📋 Files Changed

### New Files (4 new modules)
- ✨ `microsoft_api/onedriveAuth.js` - Authentication
- ✨ `microsoft_api/onedriveService.js` - Service (app-only)
- ✨ `microsoft_api/onedriveServiceUser.js` - Service (user-based)
- ✨ `microsoft_api/tokenManager.js` - Token management
- ✨ `microsoft_api/onedriveRoutes.js` - API routes

### Updated Files (5 files)
- 🔄 `package.json` - New Microsoft dependencies
- 🔄 `index.js` - Uses OneDrive now
- 🔄 `document-retriever.js` - OneDrive integration
- 🔄 `drive-document-retriever.js` - Microsoft Graph API
- 🔄 `google_api/slack.js` - OneDrive commands
- 🔄 `.env.example` - Microsoft config

### Documentation
- 📖 `ONEDRIVE_SETUP.md` - Full setup guide
- 📖 `MIGRATION_SUMMARY.md` - What changed
- 📖 `ONEDRIVE_API_USAGE.md` - Developer guide
- 📖 `QUICKSTART.md` - This file

## 🆘 Troubleshooting

### Error: "User not authenticated"
- User hasn't completed OAuth flow
- Check if tokens are saved in `microsoft_api/tokens.json`

### Error: "HTTP 401 Unauthorized"
- Access token expired
- Token auto-refresh should handle it
- Try restarting the bot

### Error: "HTTP 403 Forbidden"
- Missing API permissions in Azure
- Go to Azure Portal → API permissions → Grant admin consent

### Files Not Loading
- Verify user is authenticated: `/drive-status`
- Check OneDrive has files
- Ensure user has file access permissions

## 📁 File Structure

```
project/
├── microsoft_api/          [NEW]
│   ├── onedriveAuth.js
│   ├── onedriveService.js
│   ├── onedriveServiceUser.js
│   ├── tokenManager.js
│   ├── onedriveRoutes.js
│   └── tokens.json         (auto-created)
├── google_api/            (some files deprecated)
├── document-retriever.js   [UPDATED]
├── drive-document-retriever.js [UPDATED]
├── index.js                [UPDATED]
├── package.json            [UPDATED]
├── .env.example            [UPDATED]
└── ONEDRIVE_SETUP.md      [NEW]
```

## 🔑 Key Differences

| Google Drive | OneDrive |
|-------------|----------|
| Service Account | User Authentication |
| Predefined access | User-specific access |
| No token refresh | Auto token refresh |
| No session mgmt | Per-user session |

## 📚 Documentation

- **Setup Details**: See [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md)
- **Full Migration Info**: See [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md)
- **API Usage**: See [ONEDRIVE_API_USAGE.md](./ONEDRIVE_API_USAGE.md)

## ✅ Checklist

- [ ] Azure App Registration created
- [ ] Client ID and Secret copied
- [ ] API permissions granted
- [ ] `.env` updated with Microsoft config
- [ ] `npm install` completed
- [ ] Bot started successfully
- [ ] `/drive-status` works
- [ ] Files visible with `/drive-files`
- [ ] Search works with `/drive-search`

## 🎯 Next Steps

1. **Setup**: Follow steps 1-4 above
2. **Test**: Run commands in Slack
3. **Troubleshoot**: Check logs if issues
4. **Deploy**: Update your production environment
5. **Monitor**: Watch token refresh operations

## 💡 Tips

- First user authentication may take 30 seconds
- Tokens auto-refresh automatically - no manual action needed
- Check `microsoft_api/tokens.json` to see stored tokens
- Use `/drive-search` for quick file finding
- Commands work per-user - each Slack user has separate access

## 🆘 Need Help?

1. Check error logs in terminal
2. Verify `.env` configuration
3. Confirm Azure app permissions
4. See troubleshooting section above
5. Review full setup guide

---

**You're ready to go!** 🚀

See [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md) for detailed setup instructions.
