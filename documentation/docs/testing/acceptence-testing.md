---
sidebar_position: 3
---

# Acceptance Tests

## Functional Requirements

| Test ID | Action | Expected Result |
|---------|--------|-----------------|
| F-1 | Ask the chatbot a question related to company policies via Slack. Example: "What is the onboarding process for new developers?" | The chatbot returns relevant documentation chunks from internal company sources including project documentation and technical guides |
| F-2 | Ask a question for which no internal documentation exists. Example: "How do I use this third party library?" | The chatbot supplements the response with vetted external sources, clearly labeled as external |
| F-3 | As a new employee, ask the chatbot to generate an onboarding guide. Example: "Create a quick start guide for Project X for someone with 2 years of React experience" | The chatbot generates a personalized onboarding guide tailored to the user's experience level based on available documentation |
| F-4 | After receiving a chatbot response, observe the follow-up suggestions displayed | The chatbot presents 2-3 relevant follow-up questions to help the user navigate unfamiliar topics and discover related project context |
| F-5 | Ask a question that returns documentation authored by a team member | The chatbot response includes a Slack @mention or direct message link to the author of the referenced documentation or message |
| F-6 | As a user, navigate to the documentation upload page and upload a valid file | The document is marked as Pending Approval and the designated administrator is notified for review |
| F-7 | As a manager, log into the analytics dashboard | The dashboard displays topics queried, knowledge gaps, and time-to-productivity indicators. Individual conversation content is not visible |

---

## Non-Functional Requirements

| Test ID | Action | Expected Result |
|---------|--------|-----------------|
| NF-1 | Open the application in a web browser and connect to a Slack workspace | The system loads successfully in the browser and integrates with the Slack workspace without errors |
| NF-2 | As two different users, open separate conversation threads simultaneously and send different questions | Each conversation thread returns independently relevant results with no cross-contamination between threads |
| NF-3 | As a user without access to a restricted Slack channel, ask a question whose answer exists only in that channel | The system does not return any content from channels the querying user does not have access to |
| NF-4 | As an unauthorized user, attempt to query confidential documentation | The system does not return confidential content and displays an appropriate access denied message |
