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
    github_username: String
    active_github_repo: String
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

  type DocumentTag {
    id: ID!
    drive_file_id: String!
    file_name: String!
    classification_level: String!
    tags: String
    auto_classified: Boolean
    created_at: String
    updated_at: String
  }

  type Query {
    health: HealthStatus
    getAllUsers: [User]
    getAllUserProfiles: [Profile]
    getUserByID(id: ID!): User
    getUserProfile(session_id: String!): Profile
    getInteractionRecords(session_id: String!): [Interaction]
    getAllInteractionRecords: [Interaction]
  }

  type Interaction {
    id: ID!
    profile_id: ID
    interaction_type: String
    message: String
    created_at: String
  }

  type Mutation {
    createUser(session_id: String!): User
    createUserProfile(input: UserProfileInput!): Profile
    updateUserProfile(session_id: String!, input: UserProfileInput!): Profile
    removeUser(id: ID!): Boolean
    createInteractionRecord(session_id: String!, interactionType: String!, message: String!): Interaction
    removeInteractionRecord(id: ID!): Boolean
  }

  input UserProfileInput {
    session_id: String!
    name: String
    email: String
    github_username: String
    active_github_repo: String
    role: String!
    experience_level: String!
    department: String
    areas_of_interest: String
    technical_skills: String
    learning_goals: String
    preferred_content_complexity: String
  }
`);
