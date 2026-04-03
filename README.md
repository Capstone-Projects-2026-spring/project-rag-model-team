<div align="center">

# The Keystone Project

[![Report Issue on Jira](https://img.shields.io/badge/Report%20Issues-Jira-0052CC?style=flat&logo=jira-software)](https://temple-cis-projects-in-cs.atlassian.net/jira/software/c/projects/DT/issues)
[![Deploy Docs](https://github.com/ApplebaumIan/tu-cis-4398-docs-template/actions/workflows/deploy.yml/badge.svg)](https://github.com/ApplebaumIan/tu-cis-4398-docs-template/actions/workflows/deploy.yml)
[![Documentation Website Link](https://img.shields.io/badge/-Documentation%20Website-brightgreen)](https://capstone-projects-2026-spring.github.io/project-rag-model-team/)

</div>

## Keywords

Retrieval-Augmented Generation, Slack bot, onboarding assistant, Node.js, Slack Bolt, GraphQL, SQL.js, Google Drive, Groq, documentation assistant, project knowledge base

## Project Abstract

The Keystone Project is a Slack-based onboarding and knowledge assistant for software teams. It uses a Retrieval-Augmented Generation(RAG) workflow to answer questions about project documentation, suggest people who may be helpful for a topic, and surface information stored in team data sources. The system is designed to reduce onboarding time for new contributors, lower the number of repetitive support questions, and make project knowledge easier to access from within Slack.

## High Level Requirement

At a high level, the system should let a user ask project-related questions from Slack and receive a relevant answer without manually searching multiple documents or asking teammates directly. From the user perspective, the bot should be able to respond to direct Slack interactions, identify whether a question is about people or documentation, and use the appropriate backend source to produce a useful reply. The system should also support profile and onboarding information so the bot can be extended to give more personalized help over time.

## Conceptual Design

The project is built as a Node.js application using Slack Bolt for the bot interface. A GraphQL layer provides access to stored user and profile information, while a SQLite database stores user profiles and interaction-related data. For document retrieval, the bot can access JSON-based documentation stored in Google Drive through a service account. For answer generation and routing, the project uses LangChain prompt pipelines with a Groq-hosted LLM. Documentation for the project is maintained separately in a Docusaurus site.

## Background

Many teams store onboarding and project knowledge across chat threads, internal docs, shared folders, and informal team memory. That makes it difficult for new contributors to find the right answers quickly and often increases the support burden on more experienced teammates. Keystone addresses that problem by bringing question answering into Slack, where users already work, and routing questions toward structured team profile data or project documents. Unlike a general-purpose chatbot, it is intended to answer with information grounded in team-specific data sources such as Google Drive documents and stored user profiles.

## Required Resources

To develop and run this project locally, the following hardware, operating system, software tools, and external services are required.

- A personal computer capable of running Node.js applications
- Node.js 18 or newer
- npm
- Internet access for Slack, Groq, and Google Drive integrations
- A Slack app with bot token and app token configured for Socket Mode
- A Groq API key
- Optional Google service account credentials if you want Drive-backed document retrieval
- Supported operating systems:
  - Windows 10 or later
  - macOS
  - Linux

## Starting the Slack Bot

```bash
git clone https://github.com/Capstone-Projects-2026-spring/project-rag-model-team.git
cd project-rag-model-team
npm install
cp .env.example .env
```

After copying `.env.example` to `.env`, open `.env` and fill in the required values.

### 1. Slack App Setup

Go to the Slack developer portal:

- https://api.slack.com/apps

Create and configure the Slack app:

1. Click `Create New App`.
2. Choose `From scratch`.
3. Enter an app name and select the Slack workspace where you want to install it.
4. In the app settings, open `Socket Mode` and turn on `Enable Socket Mode`.
5. In `Basic Information`, create an app-level token with the `connections:write` scope.
   Save the generated token that starts with `xapp-` as `SLACK_APP_TOKEN`.
6. Open `OAuth & Permissions`.
7. Under `Bot Token Scopes`, add the scopes your app needs. Based on this project's current implementation, the bot may need scopes such as:
   - `app_mentions:read`
   - `channels:read`
   - `channels:history`
   - `chat:write`
   - `chat:write.public`
   - `commands`
   - `im:history`
   - `im:write`
   - `reactions:read`
   - `users:read`
8. Click `Install App to Workspace`.
9. After installation, copy the bot token that starts with `xoxb-` and save it as `SLACK_BOT_TOKEN`.

Put the Slack values into `.env`:

- `SLACK_BOT_TOKEN` from your Slack app OAuth settings
- `SLACK_APP_TOKEN` from your Slack app Socket Mode settings

### 2. Groq API Key Setup

Go to the Groq console:

- https://console.groq.com/

Create the API key:

1. Sign in or create an account.
2. Open the API keys area in the Groq console.
3. Create a new API key.
4. Copy the key and place it in `.env` as `GROQ_API_KEY`.

If you want Google Drive document retrieval to work, also make sure:

### 3. Optional Google Drive Service Account Setup

This step is only needed if you want the bot to read project documents from Google Drive.

Use the Google Cloud Console:

- https://console.cloud.google.com/

Create and configure the service account:

1. Create or select a Google Cloud project.
2. Enable the Google Drive API for that project.
3. Go to `IAM & Admin` -> `Service Accounts`.
4. Create a service account for the project.
5. Open that service account and create a JSON key.
6. Download the JSON key file.
7. Place the file in the project root, or another secure local path.
8. Set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` in `.env` to that file path.
9. If you only want the bot to search a specific Drive folder, set `GOOGLE_DRIVE_FOLDER_ID`.
10. Share the target Drive folder or files with the service account email so it can read them.

Your `.env` should contain at least:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
GROQ_API_KEY=your-groq-api-key
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json
GOOGLE_DRIVE_FOLDER_ID=
```

Start everything with a single command:

```bash
npm start
```

This starts both the Slack bot and the GraphQL server in a single process. You should see:

```
✅ GraphQL database initialized
GraphQL running on http://localhost:4000/graphql
⚡️ Slack bot is running in socket mode!
```

Optional verification:

```bash
npm test
```

Notes:

- The main bot entry point is the root `index.js`.
- Database initialization and migrations run automatically on startup.
- If Google Drive credentials are missing, the bot can still start, but Drive-backed document retrieval will not work.

### Slash Commands

Register the following slash commands in your Slack app under **Slash Commands**. Set the Request URL to any valid URL (Socket Mode does not use it). Reinstall the app after adding commands.

| Command | Description |
|---|---|
| `/update-profile` | Update your role or experience level |
| `/reset` | Delete your profile and start over |
| `/sync-docs` | Bulk classify all Google Drive documents using LLM auto-tagging |
| `/classify-docs` | Change a specific document's classification level via a dropdown modal |

You can also type `help` or `commands` in any channel to see this list from the bot.

### User Flow

1. When a new user joins the workspace or DMs the bot, they are prompted to complete a profile setup (role + experience level).
2. Until the profile is set up, the bot will not answer questions.
3. Once set up, users can ask questions by mentioning the bot in a channel (`@BotName what is project alpha?`) or by sending a direct message without any mention.
4. All bot responses and command confirmations are ephemeral (only visible to the user who triggered them).

### Document Classification

Documents in Google Drive can be assigned a classification level that controls who can access them:

| Level | Roles with access |
|---|---|
| `public` | Everyone |
| `internal` | Junior Dev, Mid Dev, Designer, QA (and above) |
| `confidential` | Senior Dev, DevOps (and above) |
| `restricted` | Manager only |

Run `/sync-docs` to auto-classify all Drive documents, or `/classify-docs` to manually set a document's level.

## Collaborators

<div align="center">

[//]: # "Replace with your collaborators"

[William Sims](https://github.com/wSimsT)
[Kidus Adamte](https://github.com/kidham3207)
[Billy Nguyen](https://github.com/bnguye04)
[Andrew Kelley](https://github.com/andrewkelley-1)
[Saniyah Davis](https://github.com/Saniyah-Davis)

</div>
