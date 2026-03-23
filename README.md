<div align="center">

# The Keystone Project
[![Report Issue on Jira](https://img.shields.io/badge/Report%20Issues-Jira-0052CC?style=flat&logo=jira-software)](https://temple-cis-projects-in-cs.atlassian.net/jira/software/c/projects/DT/issues)
[![Deploy Docs](https://github.com/ApplebaumIan/tu-cis-4398-docs-template/actions/workflows/deploy.yml/badge.svg)](https://github.com/ApplebaumIan/tu-cis-4398-docs-template/actions/workflows/deploy.yml)
[![Documentation Website Link](https://img.shields.io/badge/-Documentation%20Website-brightgreen)](https://capstone-projects-2026-spring.github.io/project-rag-model-team/)


</div>


## Keywords

Section #, as well as any words that quickly give your peers insights into the application like programming language, development platform, type of application, etc.

## Project Abstract

This document proposes a novel application of a RAG Model applied in a work software context. It will support new team members by giving them tools and offer information that may speed up the process of adapting to a new team. For experienced members of the group, it can help build connection with the new members. For team leads, it will keep them up to date on the current stages of their work the team members are working on. 

## High Level Requirement

Describe the requirements – i.e., what the product does and how it does it from a user point of view – at a high level.

## Conceptual Design

Describe the initial design concept: Hardware/software architecture, programming language, operating system, etc.

## Background

The background will contain a more detailed description of the product and a comparison to existing similar projects/products. A literature search should be conducted and the results listed. Proper citation of sources is required. If there are similar open-source products, you should state whether existing source will be used and to what extent. If there are similar closed-source/proprietary products, you should state how the proposed product will be similar and different.

## Required Resources
To develop and run this project locally, the following hardware, operating system, software tools, and external services are required.
-	A personal computer or laptop capable of running Node.js applications
-	The project supports the following operating systems:
	•	Windows 10 or later
	•	macOS (Ventura or later recommended)
	•	Linux (Ubuntu 20.04+ recommended)
-	Internet connection (required for Slack API and LLM API access)
-	Core Runtime Environment
	•	Node.js (v18 or newer recommended)
	•	npm (comes bundled with Node.js)

## Starting the Slack Bot

```bash
cd slack-bot
npm install
copy .env.example .env
# Edit .env and add your:
Get these from api.slack.com → Your App → OAuth & Permissions
SLACK_BOT_TOKEN = starting with xoxb-
SLACK_APP_TOKEN =starting with xapp-
LLM API KEY

-npm run init-db (Run only first time to initialize the database)
-npm start

If npm start fails, run each of the below individual scripts in a separate terminal to identify the issue.
npm run sql-db    # Database only
npm run graph     # GraphQL only
npm run bot       # Bot only
npm test          # Run tests
```

## Collaborators

<div align="center">

[//]: # (Replace with your collaborators)
[William Sims](https://github.com/wSimsT)
[Kidus Adamte](https://github.com/kidham3207)
[Billy Nguyen](https://github.com/bnguye04)
[Andrew Kelley](https://github.com/andrewkelley-1)
[Saniyah Davis](https://github.com/Saniyah-Davis)

</div>
