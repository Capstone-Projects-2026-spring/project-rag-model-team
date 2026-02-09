# Use-Case Descriptions 

---

## 1) New Member Joins Team

### User Story
As a new team member, I want quick access to relevant team knowledge so I can contribute effectively.

### Main Flow
1. A new team member is assigned to a project but lacks familiarity with internal tools, processes, and documentation.
2. The user submits a question to the team chatbot.
3. The chatbot asks clarifying follow-up questions to refine the request.
4. The system searches internal documentation based on the user’s access permissions.
5. If internal sources are insufficient, the system supplements results with vetted external sources.
6. The chatbot presents:
   - relevant documentation,
   - summaries,
   - suggested next steps,
   - recommended follow-up questions.

### Source Selection Logic
- The system prioritizes approved internal documentation.
- External sources are used only if internal content is unavailable or incomplete.
- All external sources are labeled and cited.

### Postconditions
- The user gains a clearer understanding of the topic.
- The user knows what actions to take next.
- Knowledge gaps are reduced.

### Alternate Flow
- If no reliable sources are found, the system notifies the user and suggests contacting a team member.

---

## 2) User Uploads Documentation to the Database

### User Story
As a user, I want to upload documentation so the AI system and the team can use it.

### Main Flow
1. The user navigates to the documentation upload page.
2. The user uploads files from their device or OneDrive.
3. The system validates file format, size, and security.
4. The documentation is marked as **Pending Approval**.
5. A designated reviewer (manager or administrator) is notified.
6. The reviewer approves the document.
7. The system indexes the document for AI retrieval.

### Approval Process
- Approvers: Project Manager or System Administrator
- Review Criteria:
  - Accuracy
  - Relevance
  - Confidentiality compliance

### Rejection Flow
- If rejected:
  - The user receives feedback.
  - The document is returned for revision.
  - The user may resubmit.

### Postconditions
- Approved documents become searchable.
- Knowledge base remains reliable and current.

---

## 3) Experienced Member Is Referred to Help a New User

### User Story
As an experienced member, I want to assist new users when automated help is insufficient.

### Main Flow
1. A new user requests help from the chatbot.
2. The chatbot provides available documentation and summaries.
3. The system identifies relevant subject-matter experts.
4. The chatbot requests user consent to contact an expert.
5. The selected expert is notified.
6. Upon acceptance, a shared chat is created.
7. The expert assists the user.

### Permissions & Consent
- Both users must approve shared communication.
- Experts can decline requests.
- Users may exit shared chats at any time.

### Postconditions
- The user receives personalized guidance.
- Knowledge is shared across team members.
- Future documentation gaps are identified.

### Alternate Flow
- If no expert is available, the chatbot suggests alternative resources.

---

## 4) Experienced Member Accessing the AI Model (External Sources)

### User Story
As an experienced member, I want help with unfamiliar technologies when internal resources are unavailable.

### Main Flow
1. The user submits a technical question.
2. The system searches internal documentation.
3. No relevant internal content is found.
4. The system verifies this by:
   - checking indexed documents,
   - checking tags and keywords,
   - confirming access rights.
5. The chatbot offers curated external resources.
6. The user accepts and views the results.

### External Source Policy
- Sources are filtered for:
  - credibility,
  - recency,
  - relevance.
- Disclaimers are displayed for third-party content.
- Links are monitored for reliability.

### Postconditions
- The user gains new technical knowledge.
- The user can proceed with project tasks.

### Error Handling
- If external sources are unavailable, the system alerts the user and suggests escalation.

---

## 5) Manager Wants Visibility Into AI Model Usage

### User Story
As a manager, I want insight into team knowledge gaps so I can improve performance.

### Main Flow
1. The manager logs into the analytics dashboard.
2. The system displays:
   - popular topics,
   - recurring questions,
   - system usage trends,
   - resolution rates.
3. Individual user data is anonymized.
4. The manager reviews aggregated insights.
5. The manager discusses findings with the team.

### Privacy & Ethics
- Personal identifiers are removed.
- Data is aggregated by default.
- Individual-level data requires special permission.
- Users may opt out of analytics tracking.

### User Data Management
- Users may:
  - request data deletion,
  - review stored information,
  - withdraw consent.

### Postconditions
- Managers identify training needs.
- Process improvements are implemented.
- Team efficiency increases.

### System Failure Handling
- If analytics data is unavailable, the system logs the issue and notifies administrators.
