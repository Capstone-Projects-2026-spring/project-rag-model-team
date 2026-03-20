// schema.js
import { buildSchema } from 'graphql';

export default buildSchema(`
  type User {
    id: ID!
    created_at: String
  }

  type Profile {
    profile: User
    userInfo: UserInfo
    hasCompletedIntake: Boolean
  }

  type UserInfo {
    id: ID!
    profile_id: ID
  }

  type HealthStatus {
    status: String
    message: String
  }

  type Query {
    health: HealthStatus
    getAllUsers: [User]
    getUserByID(id: ID!): User
  }

  type Mutation {
    createUser(session_id: String!): User
    removeUser(id: ID!): Boolean
  }
`);
