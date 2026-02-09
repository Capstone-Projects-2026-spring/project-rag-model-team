# Use-case Descriptions

## 1) New Member Joins Team
*As a new member, I am unaware of the current state of the team and out of the loop on many commonly known topics.*

1. A new team member is assigned a project but lacks familiarity with commonly used team knowledge and tools.
2. The user submits a prompt to the team-associated chatbot.
3. The chatbot asks follow-up questions to clarify the user’s request.
4. The chatbot provides relevant information from the following sources:
   - the internal team database (based on user clearance),
   - and references to senior team members with relevant expertise,
   - external sources (web) (if no sufficient information could be found in the previous two sources).

---

## 2) User Uploads Documentation to the Database
*As a user, I want to upload documentation to the AI model so it can be referenced in the future.*

1. The user navigates to the designated documentation upload page.
2. The user uploads documentation from their computer or OneDrive.
3. The documentation is marked as pending approval by an administrator on the team (usually a manager).
   - If rejected, then the user is notified
4. Once approved, the documentation becomes available for team-wide use by the AI model.

---

## 3) Experienced Member Is Referred to Help a New User
*As an experienced user, I can help a new user with questions about a project I worked on.*

1. A new user asks the chatbot for help understanding a specific part of a team project.
2. The chatbot returns relevant documentation along with:
   - a brief summary,
   - suggested follow-up questions.
3. One suggested action is to contact experienced team members associated with the documentation.
4. The selected experienced member is notified and can be added to a shared chat with the new user and the chatbot pending the approval of the users.
   - In situations where not all of the users want to join the group, the rest will be notified and the process will not proceed.
5. The experienced member answers the question and any additional follow-up questions.

---

## 4) Experienced Member Accessing the AI Model
*As an experienced member, I handle common tasks but need help when working with unfamiliar technologies or concepts.*

1. An experienced user is assigned a project involving a new tech stack or unfamiliar concept.
2. The user asks the chatbot for assistance.
3. The chatbot determines no relevant internal documentation exists through conferring with the LLM.
4. The chatbot offers curated external sources from the web, which will be labeled as such.
5. The user accepts and receives relevant external documentation and references.

---

## 5) Manager Wants Visibility Into AI Model Usage
*As a manager, I want insight into my team’s questions and areas of concern.*

1. The manager wants to identify common pain points and recurring questions within the team
   - Data will be anonymized when shown in order to protect confidentiality of user information.
   - When the user leaves the frontend organization (Slack, MS Teams, etc...) then the user data will be removed from the database as it is no longer prevalent.
2. The manager accesses a dashboard displaying:
   - frequently asked topics,
   - common areas of confusion,
   - overall AI model usage trends.
3. The manager reviews key insights and areas of concern.
4. The manager discusses findings with the team to address gaps and clear misunderstandings.
