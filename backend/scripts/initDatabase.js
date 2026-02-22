const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'users.db');
const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

async function initDatabase() {
  // Create database directory if it doesn't exist
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Initialize SQL.js
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Read and execute schema
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.run(schema);

  // Save database to file
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);

  console.log('Database initialized successfully at:', dbPath);
  console.log('Tables created:');
  console.log('  - user_profiles');
  console.log('  - user_info');
  console.log('  - user_interactions');
}

initDatabase().catch(err => {
  console.error('Error initializing database:', err);
  process.exit(1);
});
