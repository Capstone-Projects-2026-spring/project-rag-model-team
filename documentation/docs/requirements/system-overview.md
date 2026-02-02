---
sidebar_position: 1
---

# System Overview

## Project Abstract

The project proposes an intelligent chatbot using RAG(Retrieval-Augmented Generation) that will help with streamlining the onboarding process for a new team member in the company, or help an already existing employee join a new project. Through the integration of the chatbot into platforms such as Slack, Discord, and Microsoft Teams, the RagOil Bot will act as an automated knowledge assistance tool for new team members to have access to the project-related information. The chatbot will use a two- tier retrieval approach, where it will first query the local project documentation for relevant data, and second, if it can’t find sufficient data, it will dynamically scale to search the internet for additional information that may be useful to provide a full range of support to new developers. So the RagOil Bot will provide centralized knowledge searching capabilities and automate many commonly asked questions, resulting in less time being spent by new developers before they can become ready to contribute to the development environment. 


## Background and Refrences 

The onboarding process for new team members in software development is usually slowed down by "knowledge silos," where important project information is scattered across different platforms like README files, wikis, and historical chat threads. Traditional manual onboarding typically requires substantial time from both the new hire and senior mentors, often taking between 8 to 11 hours of direct supervision per hire and resulting in a significant "time-to-productivity" lag according to an article by ITACIT. The RagOil Bot addresses these issues by implementing a Retrieval-Augmented Generation (RAG) architecture. 
Commercial solutions like Stack Overflow, and Glean give AI-powered knowledge retrieval for organizational documentation. But, these products are usually platform specific or require enterprise-wide adoption.This chatbot is different by being platform-agnostic (deployable across multiple messaging apps), project-scoped (focused specifically on onboarding workflows rather than general knowledge management), and customizable (allowing teams to tailor the knowledge base and response patterns to their specific project needs).


##### iTacit (2025). "How AI Makes Employee Onboarding Faster: A Manager's Guide."
