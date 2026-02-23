import { gql } from 'apollo-server-express';
import { hash as _hash, compare } from 'bcrypt';
import { getAllUsers } from './user.service';

const typeDefs = gql`
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
`;

const resolvers = {
  Query: {
    users: () => getAllUsers(),
    user: (id) => getUserByID(id)
  },
};

export default { typeDefs, resolvers };
