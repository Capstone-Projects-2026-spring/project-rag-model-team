# API Specification

## Overview

The **Slack Bot GraphQL API** provides structured access to application data through a single GraphQL endpoint. Clients can query specific fields, reducing over-fetching and under-fetching of data.

The API supports:

- Queries for retrieving data
- Mutations for creating or modifying data

All data is exchanged in JSON format.

---

## Base URL

http://localhost:4000/graphql

---

## Authentication

The Slack bot interacts internally with the API, authentication is handled via environment-based secrets.

---

## GraphQL Schema

```graphql
type User {
    id: ID!
    email: String!
    username: String!
    is_active: Boolean!
    created_at: String!
  }

  type Query {
    users: [User]
    user(id: ID!): User
  }

  type Mutation {
    createUser(email: String!, username: String!, password: String!): User
    login(email: String!, password: String!): String
  }
```

---

## Headers

All requests must include: Content-Type: application/json

---

## Queries

---

Example HTTP Request:

```
POST /graphql
Content-Type: application/json

{
  "query": //Query
}
```

### Get All Users
Returns a list of all the users in the organization

Query:
```
query {
  users {
    id
    email
    username
  }
}
```

Example Response:
```
{
  "data": {
    "users": [
      {
        "id": "1",
        "email": "user1@example.com",
        "username": "user1"
      }
    ]
  }
}
```

### Get User by ID
Returns the information about a specific user

Query:
```
query {
  user(id: "1") {
    id
    email
    username
  }
}
```

Example Response:
```
{
  "data": {
    "user":{
        "id": "1",
        "email": "user1@example.com",
        "username": "user1"
    }
  }
}
```

### Create User
Creates a user in the database

Query:
```
mutation{
  createUser(
    email: "test@example.com",
    username: "testuser",
    password: "securepassword"
  ) {
    id
    email
    username
  }
}
```

Example Response:
```
{
  "data": {
    "createUser": {
      "id": "2",
      "email": "test@example.com",
      "username": "testuser"
    }
  }
}
```

### Login
Returns a validation message that approves a user access into the system

Query:
```
mutation{
  login(
    email: "test@example.com",
    password: "securepassword"
  ) {
    String
  }
}
```

Example Response:
```
{
  "data": {
    "login": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

## Error Handling

GraphQL returns errors in the following format:
```
{
  "errors": [
    {
      "message": "User not found",
      "extensions": {
        "code": "NOT_FOUND"
      }
    }
  ]
}
```

Common Error Codes include:
- UNAUTHENTICATED
- FORBIDDEN
- NOT_FOUND
- INTERNAL_SERVER_ERROR

## Versioning

Current Version: v1

Future updates will maintain backward compatibility.

## Architecture Notes

This API is consumed internally by a Slack bot built using Slack Bolt. 
The bot triggers GraphQL queries and mutations in response to Slack events.
