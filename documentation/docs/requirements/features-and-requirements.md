---
sidebar_position: 4
---

# Features and Requirements

## Functional Requirements
- The chatbot must allow the user to ask questions and receive relevant documentation such as company policies, project documentation, and technical guides related to the question directly from company slack channels
- The system shall allow employees to upload documentation subject to administrator approval
- The chatbot must be able to generate personalized onboarding guides for user based on documentation and users experience level (e.g., 'Project X Quick Start')
- Managers shall be able to view metrics on team onboarding progress, including: topics queried, knowledge gaps, and time-to-productivity indicators. Individual conversation content shall remain private unless explicitly shared by individual.
- The chatbot must be able to suggest followup questions based on user response to to help new employees navigate unfamiliar topics and discover relevant project context
- The system shall provide Slack @mentions or direct message links to the authors of referenced documentation or messages
- The system must be able to incorporate external sources from the internet when no relevant documentation is found




## Nonfunctional Requirements
- The system must be able to be accessed via web browser and integrate with Slack workspaces
- It must be able to hold several different conversation threads and only retrieve information from channels querying user can access
- The system shall prevent confidential information from appearing in responses to unauthorized users
