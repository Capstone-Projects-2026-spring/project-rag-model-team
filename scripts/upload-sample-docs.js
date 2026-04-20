import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_ACCOUNT_KEY_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
  path.join(__dirname, "..", "service-account-key.json");

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const keyFile = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_KEY_PATH, "utf8"));
const auth = new google.auth.GoogleAuth({
  credentials: keyFile,
  scopes: ["https://www.googleapis.com/auth/drive"],
});
const drive = google.drive({ version: "v3", auth });

async function fileExists(name) {
  const folderId = FOLDER_ID;
  const q = folderId
    ? `name='${name}' and '${folderId}' in parents and trashed=false`
    : `name='${name}' and trashed=false`;
  const res = await drive.files.list({ q, fields: "files(id,name)" });
  return res.data.files.length > 0;
}

async function createGoogleDoc(name, description, textContent) {
  if (await fileExists(name)) {
    console.log(`⏭️  Skipping "${name}" (already exists)`);
    return;
  }
  const requestBody = { name, mimeType: "application/vnd.google-apps.document", description };
  if (FOLDER_ID) requestBody.parents = [FOLDER_ID];

  await drive.files.create({
    requestBody,
    media: { mimeType: "text/plain", body: textContent },
  });
  console.log(`✅ Created Google Doc: ${name}`);
}

async function createGoogleSheet(name, description, csvContent) {
  if (await fileExists(name)) {
    console.log(`⏭️  Skipping "${name}" (already exists)`);
    return;
  }
  const requestBody = { name, mimeType: "application/vnd.google-apps.spreadsheet", description };
  if (FOLDER_ID) requestBody.parents = [FOLDER_ID];

  await drive.files.create({
    requestBody,
    media: { mimeType: "text/csv", body: csvContent },
  });
  console.log(`✅ Created Google Sheet: ${name}`);
}

// ─── Document Content ────────────────────────────────────────────────────────

const docs = [
  {
    name: "Onboarding Guide",
    type: "doc",
    description: "classification: internal | tags: onboarding, process, getting-started",
    content: `Onboarding Guide
================

Welcome to the team! This guide will help you get up and running in your first two weeks.

Week 1: Setup
-------------
Day 1
- Complete HR paperwork and badge access request
- Set up your laptop using the IT setup checklist (request from IT helpdesk)
- Join required Slack channels: #general, #engineering, #announcements, #onboarding
- Attend the new hire orientation at 10am

Day 2-3
- Complete security training modules (link sent to your email)
- Request access to GitHub org from your team lead
- Clone the main repositories and follow the local setup guides
- Schedule 30-min intro calls with your team members

Day 4-5
- Shadow a team member on a live task or bug fix
- Read the Engineering Handbook
- Attend your first team standup

Week 2: Ramp-Up
---------------
- Pick up your first ticket (labeled "good first issue")
- Pair program with a senior engineer for at least two sessions
- Review the Architecture Overview document
- Complete your 30-day goals form with your manager

Key Contacts
------------
HR: hr@company.com
IT helpdesk: it@company.com
Your manager: [set by your team lead]
Buddy program: buddy@company.com

FAQ
---
Q: How do I request software?
A: Submit a request via the IT portal.

Q: When do I get added to meetings?
A: Your manager will add you to recurring meetings in Week 1.

Q: Who do I ask if I'm stuck?
A: Ask in #engineering first, then ping your buddy.
`,
  },
  {
    name: "Engineering Handbook",
    type: "doc",
    description: "classification: internal | tags: process, engineering, standards",
    content: `Engineering Handbook
====================

Code Standards
--------------
- All code must pass lint checks before opening a PR
- PRs require at least one approval from a senior engineer
- Test coverage must not drop below 80% on changed files
- Commit messages follow Conventional Commits format: feat:, fix:, chore:, docs:

Branching Strategy
------------------
- main: production-ready code only
- feature/<ticket-number>-short-description: feature branches
- hotfix/<ticket-number>-short-description: urgent fixes

Deployment Process
------------------
1. Open PR against main
2. CI must pass (lint, tests, build)
3. Get required approvals
4. Merge — deploy is automatic via CI/CD pipeline
5. Monitor error rates in Grafana for 15 minutes post-deploy

Incident Response
-----------------
- P0 (site down): page on-call engineer immediately via PagerDuty
- P1 (major feature broken): post in #incidents within 15 minutes
- P2/P3: create ticket and schedule fix in next sprint

On-Call Rotation
----------------
- Rotation is weekly, starting Monday
- Schedule is posted in #on-call each Friday
- On-call engineers are expected to respond within 15 minutes during business hours

Tools We Use
------------
- Version control: GitHub
- CI/CD: GitHub Actions
- Monitoring: Grafana + Prometheus
- Error tracking: Sentry
- Project management: Linear
- Communication: Slack
`,
  },
  {
    name: "API Reference",
    type: "doc",
    description: "classification: confidential | tags: api, technical, integration",
    content: `Internal API Reference
======================

Base URL: https://api.internal.company.com/v2

Authentication
--------------
All requests require a Bearer token in the Authorization header:
  Authorization: Bearer <token>

Tokens are issued by the auth service. Contact the platform team for service-to-service tokens.

Endpoints
---------

GET /users
  Returns a paginated list of users.
  Query params: page (int), limit (int, max 100), role (string)
  Response: { data: [User], meta: { total, page, limit } }

GET /users/:id
  Returns a single user by ID.
  Response: { data: User }

POST /users
  Creates a new user.
  Body: { name, email, role, department }
  Response: 201 Created, { data: User }

PATCH /users/:id
  Updates fields on an existing user.
  Body: partial User object
  Response: { data: User }

GET /projects
  Returns all active projects the caller has access to.
  Response: { data: [Project] }

GET /projects/:id/members
  Returns members of a project.
  Response: { data: [ProjectMember] }

POST /interactions
  Logs a user interaction event.
  Body: { user_id, event_type, metadata }
  Response: 202 Accepted

Error Codes
-----------
400 Bad Request - Invalid input
401 Unauthorized - Missing or invalid token
403 Forbidden - Insufficient permissions
404 Not Found - Resource does not exist
429 Too Many Requests - Rate limit exceeded (100 req/min per token)
500 Internal Server Error - Contact platform team

Rate Limits
-----------
Default: 100 requests per minute per token
Bulk endpoints: 10 requests per minute
Contact platform team for increased limits.
`,
  },
  {
    name: "Architecture Overview",
    type: "doc",
    description: "classification: confidential | tags: architecture, technical, design",
    content: `System Architecture Overview
============================

High-Level Architecture
-----------------------
Our system follows a microservices architecture deployed on AWS. Services communicate via REST APIs and an internal event bus (Kafka).

Core Services
-------------
1. Auth Service
   - Handles authentication and token issuance
   - Tech: Node.js, Redis (session store), PostgreSQL (user store)
   - Repo: github.com/company/auth-service

2. API Gateway
   - Single entry point for all client traffic
   - Handles routing, rate limiting, and auth validation
   - Tech: Kong Gateway

3. User Service
   - Manages user profiles and permissions
   - Tech: Node.js, PostgreSQL
   - Repo: github.com/company/user-service

4. Notification Service
   - Sends email, push, and in-app notifications
   - Tech: Python, Redis (queue), SendGrid (email), Firebase (push)
   - Repo: github.com/company/notification-service

5. Analytics Service
   - Processes and stores interaction events
   - Tech: Python, Kafka consumer, BigQuery
   - Repo: github.com/company/analytics-service

Data Flow
---------
Client → API Gateway → Auth validation → Target service → Database
                                       ↘ Event bus (async side effects)

Infrastructure
--------------
- Cloud: AWS (us-east-1 primary, us-west-2 failover)
- Containers: Docker + Kubernetes (EKS)
- CI/CD: GitHub Actions → ECR → EKS rolling deploy
- Secrets: AWS Secrets Manager
- Monitoring: CloudWatch + Grafana

Database Strategy
-----------------
- Transactional data: PostgreSQL (RDS, Multi-AZ)
- Cache: Redis (ElastiCache)
- Analytics: BigQuery
- Search: OpenSearch

Known Constraints
-----------------
- Auth service is a single point of failure — failover is manual (known issue, tracked in Linear)
- BigQuery export has 1-hour latency — not suitable for real-time dashboards
`,
  },
  {
    name: "Security Policy",
    type: "doc",
    description: "classification: restricted | tags: security, compliance, policy",
    content: `Security Policy (Restricted)
============================

Access Control
--------------
- Principle of least privilege applies to all systems
- Access is role-based (RBAC); roles are assigned by managers and approved by Security
- Privileged access (production databases, secrets) requires MFA and is logged
- Access reviews are conducted quarterly; unused access is revoked

Data Classification
-------------------
Level 0 - Public: Marketing materials, public docs
Level 1 - Internal: General company info, processes
Level 2 - Confidential: Customer data, source code, API keys
Level 3 - Restricted: Financial data, PII, security configurations

Handling Restricted Data
------------------------
- Must be encrypted at rest (AES-256) and in transit (TLS 1.2+)
- Must not be stored in personal devices or personal cloud accounts
- Access must be logged and auditable
- Must not be shared externally without legal approval

Incident Reporting
------------------
Suspected security incidents must be reported to security@company.com within 1 hour of discovery.
Do not attempt to investigate or remediate on your own — notify the security team first.

Password Policy
---------------
- Minimum 16 characters
- Must include uppercase, lowercase, number, and special character
- Cannot reuse last 12 passwords
- Must be changed every 90 days for privileged accounts

Third-Party Vendors
-------------------
All third-party vendors with access to company data must:
- Complete the vendor security questionnaire
- Sign the data processing agreement
- Be reviewed annually by Security

Penalties
---------
Violations of this policy may result in disciplinary action up to and including termination and legal action.
`,
  },
  {
    name: "Sprint Process",
    type: "doc",
    description: "classification: internal | tags: process, agile, planning",
    content: `Sprint Process Guide
====================

Overview
--------
We run 2-week sprints. Each sprint starts on Monday and ends on Friday two weeks later.

Sprint Ceremonies
-----------------
Sprint Planning (Monday, Week 1 — 2 hours)
- Team reviews the prioritized backlog
- Engineers estimate tickets using story points (Fibonacci: 1, 2, 3, 5, 8, 13)
- Team commits to sprint goal and selects tickets

Daily Standup (Monday–Friday, 9:30am — 15 minutes)
- What did I do yesterday?
- What am I doing today?
- Any blockers?
- Async option: post in #standup by 9:30am if you can't attend

Sprint Review (Friday, Week 2 — 1 hour)
- Demo completed work to stakeholders
- Gather feedback
- Update ticket statuses

Sprint Retrospective (Friday, Week 2 — 45 minutes)
- What went well?
- What could be improved?
- Action items for next sprint

Ticket Lifecycle
----------------
Backlog → Ready → In Progress → In Review → Done

Definition of Done
------------------
- Code reviewed and approved
- Tests written and passing
- Deployed to staging and verified
- Documentation updated (if applicable)
- Ticket closed in Linear

Story Points Reference
----------------------
1 pt: Trivial change, no unknowns (< 1 hour)
2 pt: Small, well-understood task (< half day)
3 pt: Medium task with some complexity (half to full day)
5 pt: Large task or some unknowns (1-2 days)
8 pt: Complex task with significant unknowns (3-4 days)
13 pt: Should be broken down further
`,
  },
];

const sheets = [
  {
    name: "Team Directory",
    type: "sheet",
    description: "classification: internal | tags: team, contacts, org-chart",
    csv: `Name,Role,Email,Department,GitHub Username,Slack Handle,Location,Start Date
Sarah Johnson,Engineering Manager,sarah.johnson@company.com,Engineering,sarahj,@sarah,New York,2021-03-15
Alex Rodriguez,Senior Engineer,alex.rodriguez@company.com,Engineering,alexr,@alex,Remote,2020-08-01
David Kim,Senior Engineer,david.kim@company.com,Engineering,davidk,@david,San Francisco,2021-01-10
Emma Watson,Product Manager,emma.watson@company.com,Product,emmaw,@emma,New York,2020-11-20
Jessica Lee,Product Manager,jessica.lee@company.com,Product,jessical,@jessica,Remote,2022-02-14
Mike Chen,Engineering Manager,mike.chen@company.com,Engineering,mikec,@mike,San Francisco,2019-06-01
Priya Patel,Designer,priya.patel@company.com,Design,priyap,@priya,Remote,2022-05-09
Jordan Smith,Junior Engineer,jordan.smith@company.com,Engineering,jordans,@jordan,New York,2023-09-01
Taylor Brown,QA Engineer,taylor.brown@company.com,Engineering,taylorb,@taylor,Remote,2022-08-15
Chris Lee,DevOps Engineer,chris.lee@company.com,Infrastructure,chrisl,@chris,San Francisco,2021-07-20
`,
  },
  {
    name: "Project Budgets",
    type: "sheet",
    description: "classification: restricted | tags: finance, budget, planning",
    csv: `Project,Q1 Budget,Q1 Actual,Q2 Budget,Q2 Actual,Q3 Budget,Q3 Forecast,Annual Budget,Status
Project Alpha,125000,118000,130000,142000,135000,128000,520000,On Track
Project Beta,80000,79500,85000,84000,90000,92000,340000,Slightly Over
Project Gamma,60000,58000,65000,61000,70000,68000,260000,On Track
Infrastructure,200000,195000,210000,205000,220000,215000,840000,On Track
Security & Compliance,50000,48000,55000,53000,60000,58000,220000,On Track
R&D,100000,95000,110000,108000,120000,115000,440000,On Track
Total,615000,593500,655000,653000,695000,676000,2620000,On Track
`,
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Uploading sample documents to Google Drive...\n");

  for (const doc of docs) {
    await createGoogleDoc(doc.name, doc.description, doc.content);
  }

  for (const sheet of sheets) {
    await createGoogleSheet(sheet.name, sheet.description, sheet.csv);
  }

  console.log("\nDone! Run /sync-docs in Slack to classify and index the new documents.");
}

main().catch(console.error);
