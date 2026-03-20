---
sidebar_position: 1
---
# Unit tests
For each method, one or more test cases.

A test case consists of input parameter values and expected results.

All external classes should be stubbed using mock objects.

## Our Testing Framework: Jest

Jest is a robust, widely adopted testing framework that integrates seamlessly with Node.js and our development environment.

## Why Jest?

- **Mocking Capabilities:** As a server-side RAG pipeline that interacts heavily with external APIs and services, the ability to mock these dependencies is a necessity. Jest provides an intuitive mocking system (`jest.mock()`, `jest.fn()`). We will use this to mock external dependencies like the LangChain retriever, Slack API, and vector store clients to test logic in isolated units without live API calls or credentials.

- **Node.js Native Support & Ecosystem:** Jest is built for the Node.js ecosystem with minimal configuration required. It has broad community support and integrates naturally with CommonJS modules used throughout this project.

## Suitability for the RAG Slack Bot

This project takes questions from Slack, retrieves relevant chunks from project documentation, and passes them to an LLM to generate an answer. Jest is an ideal choice to perform testing because of it's powerful mocking, native Node.js support, and a mature ecosystem. This ensures the bot can be a dependable and maintainable tool for the team.
