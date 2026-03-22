import { GraphQLClient } from 'graphql-request';

const client = new GraphQLClient(process.env.GRAPHQL_URL || 'http://localhost:4000/graphql');

export async function queryGraphQL(query, variables = {}) {
  try {
    return await client.request(query, variables);
  } catch (error) {
    console.error('GraphQL error:', error);
    throw error;
  }
}
