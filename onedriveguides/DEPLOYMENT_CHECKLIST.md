# Deployment & Integration Checklist

Complete this checklist before deploying your OneDrive-integrated application to production.

## Pre-Deployment Setup

### Azure Configuration
- [ ] Azure subscription created and active
- [ ] App Registration created in Azure AD
- [ ] Client ID obtained and documented
- [ ] Client Secret created and stored securely
- [ ] Redirect URI set correctly (`http://localhost:3001/auth/callback` for dev, your domain for prod)
- [ ] API Permissions granted:
  - [ ] Files.Read.All
  - [ ] Files.ReadWrite.All
  - [ ] offline_access
- [ ] Admin consent granted (if required)
- [ ] App roles assigned (if needed)

### Local Development Setup
- [ ] Node.js v16+ installed
- [ ] Git repository initialized
- [ ] `.env` file created with correct values
- [ ] `npm install` completed successfully
- [ ] All Microsoft Graph packages installed
- [ ] Bot tested locally with `/drive-status` command
- [ ] Token refresh tested (wait for token to expire)
- [ ] File upload/download tested

### Code Review
- [ ] All imports are correct (no Google Drive references)
- [ ] No hardcoded credentials in code
- [ ] Error handling in place for all API calls
- [ ] Token expiration logic working
- [ ] Slack command handlers updated
- [ ] Document retrieval functions using OneDrive
- [ ] Legacy Google Drive code removed from production paths

## Pre-Production Verification

### Functionality Testing
- [ ] `/drive-status` - Returns authenticated status
- [ ] `/drive-files` - Lists files from OneDrive
- [ ] `/drive-search <term>` - Finds files by name
- [ ] `/drive-help` - Shows command help
- [ ] `/sync-docs` - Classifies documents from OneDrive
- [ ] Document retrieval works correctly
- [ ] JSON file parsing successful
- [ ] File metadata accessible

### Token Management Testing
- [ ] Initial authentication flow works
- [ ] Tokens saved to `tokens.json`
- [ ] Token refresh works (wait or mock expiration)
- [ ] Multiple users can authenticate separately
- [ ] Token removal works on logout
- [ ] Expired tokens auto-refresh
- [ ] Refresh token error handling works

### Error Handling Testing
- [ ] 401 Unauthorized handled gracefully
- [ ] 403 Forbidden handled gracefully
- [ ] Network timeout handled
- [ ] Invalid token handled
- [ ] Missing file handled
- [ ] Empty search results handled
- [ ] Rate limiting handled

### Security Review
- [ ] No credentials in logs
- [ ] No credentials in error messages
- [ ] Tokens encrypted in storage (optional: implement)
- [ ] HTTPS enforced in production
- [ ] CORS properly configured
- [ ] No exposed sensitive environment variables
- [ ] OAuth redirect URI validated
- [ ] API scopes minimal necessary

### Performance Testing
- [ ] File listing performance acceptable (<2s)
- [ ] Search performance acceptable (<3s)
- [ ] Large file handling works
- [ ] Batch operations work
- [ ] Memory usage stable over time
- [ ] No token leaks on repeated calls

## Production Deployment

### Environment Configuration
- [ ] Production `.env` created (never commit)
- [ ] MICROSOFT_CLIENT_ID set to production app ID
- [ ] MICROSOFT_CLIENT_SECRET set securely (use secrets manager)
- [ ] MICROSOFT_REDIRECT_URI set to production domain
- [ ] SLACK_BOT_TOKEN verified
- [ ] SLACK_APP_TOKEN verified
- [ ] LOG_LEVEL set appropriately
- [ ] NODE_ENV set to 'production'

### Infrastructure Setup
- [ ] Web server configured (Express/Node.js)
- [ ] HTTPS certificate installed
- [ ] SSL/TLS configured
- [ ] Reverse proxy configured (if needed)
- [ ] Load balancer configured (if needed)
- [ ] Firewall rules for port 3001 (or production port)
- [ ] Database backups configured
- [ ] Monitoring tools set up
- [ ] Logging aggregation configured
- [ ] Error tracking configured

### Deployment Steps
- [ ] Code deployed to production server
- [ ] Dependencies installed: `npm install --production`
- [ ] Environment variables loaded
- [ ] Application started
- [ ] Health check passes
- [ ] Logs show no errors
- [ ] Slack bot responds
- [ ] OneDrive commands work

## Post-Deployment

### Monitoring
- [ ] Application uptime monitoring active
- [ ] Error rate monitoring active
- [ ] Token refresh rate monitored
- [ ] API response times monitored
- [ ] Database performance monitored
- [ ] User authentication success rate monitored
- [ ] File operation success rate monitored

### Maintenance
- [ ] Daily log review scheduled
- [ ] Weekly token rotation review
- [ ] Monthly security audit scheduled
- [ ] Quarterly dependency updates
- [ ] Backup procedures tested
- [ ] Disaster recovery plan documented

### User Communication
- [ ] Users notified of OneDrive migration
- [ ] Documentation updated for users
- [ ] Help desk trained on new system
- [ ] FAQ prepared for common issues
- [ ] Support channel established
- [ ] Feedback mechanism created

### Rollback Preparation
- [ ] Previous version backed up
- [ ] Rollback procedure documented
- [ ] Rollback testing completed
- [ ] Team trained on rollback
- [ ] Rollback decision criteria defined
- [ ] Communication plan for rollback

## Ongoing Operations

### Weekly Tasks
- [ ] Check error logs for issues
- [ ] Verify all Slack commands working
- [ ] Monitor token refresh operations
- [ ] Check user authentication success rate
- [ ] Review performance metrics

### Monthly Tasks
- [ ] Full system test
- [ ] Security audit
- [ ] Backup verification
- [ ] User feedback review
- [ ] Update dependencies (patch versions)

### Quarterly Tasks
- [ ] Major dependency updates
- [ ] Performance optimization review
- [ ] Security penetration testing
- [ ] Capacity planning
- [ ] Documentation update

## Integration Checklist

### Slack Bot Integration
- [ ] Bot mentions work in channels
- [ ] DM commands work
- [ ] Thread replies work
- [ ] Modal forms work (if used)
- [ ] Interactive buttons work
- [ ] Message reactions handled
- [ ] Rate limiting respected
- [ ] Command parsing correct

### GraphQL Integration (if used)
- [ ] GraphQL queries work with OneDrive data
- [ ] Mutations update correctly
- [ ] Subscriptions functioning
- [ ] Schema updated for OneDrive fields
- [ ] Resolvers properly implemented

### Database Integration
- [ ] Document tags saved correctly
- [ ] Classification stored properly
- [ ] Query performance acceptable
- [ ] Backup procedures working
- [ ] Data integrity checks passing

### GitHub Integration (if used)
- [ ] GitHub service still functioning
- [ ] Repository syncing working
- [ ] Contributor data accurate
- [ ] Integration with OneDrive data working

## Documentation

### User Documentation
- [ ] Setup guide written
- [ ] Command reference completed
- [ ] Troubleshooting guide ready
- [ ] FAQ written
- [ ] Video tutorials created (optional)

### Developer Documentation
- [ ] API documentation updated
- [ ] Architecture diagram created
- [ ] Integration guide written
- [ ] Code examples provided
- [ ] Test procedures documented

### Operations Documentation
- [ ] Deployment guide written
- [ ] Configuration guide written
- [ ] Monitoring guide written
- [ ] Backup procedures documented
- [ ] Emergency procedures documented

## Sign-Off

- [ ] Development team sign-off
- [ ] QA team sign-off
- [ ] Security team sign-off
- [ ] DevOps team sign-off
- [ ] Product owner sign-off
- [ ] Legal/Compliance sign-off (if required)

## Contact & Support

**Primary Contact**: [Name]
**Backup Contact**: [Name]
**Support Email**: [Email]
**Incident Response**: [Procedure]
**Escalation Path**: [Contacts]

---

**Deployment Date**: _______________
**Deployed By**: _______________
**Approved By**: _______________
**Sign-Off Date**: _______________

---

## Quick Reference: Environment Variables

```env
# Microsoft Configuration
MICROSOFT_CLIENT_ID=<from Azure App Registration>
MICROSOFT_CLIENT_SECRET=<from Azure App Registration>
MICROSOFT_REDIRECT_URI=<your production domain>/auth/callback

# Slack Configuration
SLACK_BOT_TOKEN=<from Slack App Configuration>
SLACK_APP_TOKEN=<from Slack App Configuration>

# Application
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
```

## Quick Reference: Important Files

| File | Purpose | Deployment |
|------|---------|-----------|
| `microsoft_api/onedriveAuth.js` | OAuth2 setup | Deploy |
| `microsoft_api/onedriveServiceUser.js` | User-based API | Deploy |
| `microsoft_api/tokenManager.js` | Token management | Deploy |
| `microsoft_api/tokens.json` | Stored tokens | Create on first run |
| `google_api/slack.js` | Slack commands | Deploy |
| `index.js` | Main bot file | Deploy |
| `.env` | Config file | Do NOT deploy |

See [ONEDRIVE_SETUP.md](./ONEDRIVE_SETUP.md) for detailed configuration instructions.
