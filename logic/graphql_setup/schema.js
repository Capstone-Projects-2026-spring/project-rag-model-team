// schema.js
import { buildSchema } from 'graphql';

export default buildSchema(`
  type User {
    id: ID!
    session_id: String
    created_at: String
  }

  type Profile {
    id: ID!
    session_id: String!
    userInfo: UserInfo
    hasCompletedIntake: Boolean!
  }

  type UserInfo {
    id: ID!
    session_id: String
    profile_id: ID
    name: String
    email: String
    role: String
    classification_level: String
    experience_level: String
    department: String
    areas_of_interest: String
    technical_skills: String
    learning_goals: String
    preferred_content_complexity: String
    created_at: String
    updated_at: String
  }

  type HealthStatus {
    status: String
    message: String
  }

  type Query {
    health: HealthStatus
    getAllUsers: [User]
    getAllUserProfiles: [Profile]
    getUserByID(id: ID!): User
    getUserProfile(session_id: String!): Profile
  }

  type Interaction {
    id: ID!
    profile_id: ID
    interaction_type: String
    content_id: String
    content_title: String
    metadata: String
    created_at: String
  }

  type Mutation {
    createUser(session_id: String!): User
    createUserProfile(input: UserProfileInput!): Profile
    updateUserProfile(session_id: String!, input: UserProfileInput!): Profile
    removeUser(id: ID!): Boolean
    createInteraction(session_id: String!, interactionType: String!, contentId: String!, contentTitle: String!, metadata: String): Boolean
  }

  input UserProfileInput {
    session_id: String!
    name: String
    email: String
    role: String!
    experience_level: String!
    department: String
    areas_of_interest: String
    technical_skills: String
    learning_goals: String
    preferred_content_complexity: String
  }
`);
