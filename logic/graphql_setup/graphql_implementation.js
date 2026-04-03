// graphql_implementation.js
import express from 'express';
import { graphqlHTTP } from 'express-graphql';
import schema from './schema.js';
import { root } from './resolvers.js';
import { initDatabase } from '../database/sqlite.js';

const app = express();

export function startGraphQL() {
  try {
    initDatabase();
    console.log('✅ GraphQL database initialized');

    app.use('/graphql', graphqlHTTP({
      schema,
      rootValue: root,
      graphiql: true
    }));

    app.listen(4000, () => console.log('GraphQL running on http://localhost:4000/graphql'));
  } catch (error) {
    console.error('❌ Failed to initialize GraphQL database:', error);
    process.exit(1);
  }
}

export default app;
