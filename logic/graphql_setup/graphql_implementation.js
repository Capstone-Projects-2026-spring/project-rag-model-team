// graphql_implementation.js
import express from 'express';
import { graphqlHTTP } from 'express-graphql';
import schema from './schema.js';
import { root } from './resolvers.js';
import { initDatabase } from '../../backend/server-sqljs.js';

const app = express();

// Make sure DB is ready before accepting requests
await initDatabase();

app.use('/graphql', graphqlHTTP({
  schema,
  rootValue: root,
  graphiql: true
}));

app.listen(4000, () => console.log('GraphQL running on http://localhost:4000/graphql'));

export default app;
