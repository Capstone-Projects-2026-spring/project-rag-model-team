// graphql_implementation.js
import express from 'express';
import { createHandler } from 'graphql-http/lib/use/express.js';
import schema from './schema.js';
import { root } from './resolvers.js';
import { initDatabase } from '../database/sqlite.js';

const app = express();

export function startGraphQL() {
  try {
    initDatabase();
    console.log('✅ GraphQL database initialized');

    app.get('/graphql', (req, res) => {
      res.type('html');
      res.end(`<!DOCTYPE html>
<html>
  <head>
    <title>GraphiQL</title>
    <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
  </head>
  <body style="margin: 0;">
    <div id="graphiql" style="height: 100vh;"></div>
    <script src="https://unpkg.com/react/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/graphiql/graphiql.min.js"></script>
    <script>
      ReactDOM.render(
        React.createElement(GraphiQL, { fetcher: GraphiQL.createFetcher({ url: '/graphql' }) }),
        document.getElementById('graphiql')
      );
    </script>
  </body>
</html>`);
    });

    app.use('/graphql', createHandler({ schema, rootValue: root }));

    app.listen(4000, () => console.log('GraphQL running on http://localhost:4000/graphql'));
  } catch (error) {
    console.error('❌ Failed to initialize GraphQL database:', error);
    process.exit(1);
  }
}

export default app;
