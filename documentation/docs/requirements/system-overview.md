---
sidebar_position: 1
---

# System Overview

## Project Abstract

This project proposes the development of an intelligent chatbot called **Project Keystone** that uses Retrieval-Augmented Generation (RAG) to support employee onboarding and project transitions.

Retrieval-Augmented Generation is a technique in which an AI system retrieves relevant information from existing documents before generating a response. This allows the chatbot to provide more accurate, up-to-date, and context-specific answers instead of relying only on pre-trained knowledge.

The chatbot will assist new employees or team members joining a new project by providing quick access to project documentation, setup guides, and frequently asked questions. For example, a new developer may ask, “How do I set up the development environment?” and receive step-by-step instructions gathered from internal documentation.

The system will retrieve information from approved project resources and, when necessary, supplement responses with publicly available technical references. By centralizing knowledge access, the chatbot aims to reduce the time required for onboarding and improve developer productivity.

System effectiveness will be measured through metrics such as reduced onboarding time, decreased number of repetitive support questions, and improved user satisfaction.

## Conceptual Design

The system will consist of three main components: a user interface, a processing layer, and a knowledge retrieval system.

Users will interact with the chatbot through supported communication platforms such as Slack, Discord, or Microsoft Teams. The interface will accept user questions and display system responses in real time.

The processing layer will interpret user input, manage system logic, and coordinate communication between components. It will be responsible for generating responses based on retrieved information.

The knowledge retrieval system will search approved internal documentation and external technical sources to locate relevant content. Retrieved information will be used to generate accurate and context-aware responses.

User queries and system interactions may be stored to improve system performance, support analytics, and enhance future responses. All stored data will follow organizational privacy and security policies.

## Background and References

In many software organizations, important project information is distributed across multiple platforms such as internal wikis, documentation files, and chat histories. This often leads to knowledge silos, making it difficult for new employees to find relevant information efficiently.

Traditional onboarding processes frequently require extensive involvement from senior team members, resulting in increased training costs and delayed productivity. According to iTacit (2025), manual onboarding can require several hours of direct supervision for each new hire.

Existing commercial solutions such as Stack Overflow for Teams and Glean provide AI-powered knowledge retrieval but often require full organizational adoption or are limited to specific platforms.

Project Keystone differs from these solutions by being:

- **Platform-agnostic:** Operates across multiple messaging platforms  
- **Project-scoped:** Focuses specifically on onboarding and project-related workflows  
- **Customizable:** Allows teams to define which documents are used, adjust response behavior, and configure access permissions  

These characteristics enable the system to better align with individual team needs while maintaining flexibility.

### References

iTacit (2025). *How AI Makes Employee Onboarding Faster: A Manager's Guide.*
