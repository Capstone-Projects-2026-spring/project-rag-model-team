import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'db', 'users.db');
let db;

// Initializes the SQLite database
export function initDatabase() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(dbPath);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  runMigrations();
  console.log(`📊 Database initialized: ${dbPath}`);
  return db;
}

// Run database migrations
// Makes sure that if we update the database schema in the future, 
// we can run necessary migrations to keep existing data intact. 
// For example, if we add new columns to user_info, we can check 
// if they exist and add them if not.
function runMigrations() {
  try {
    console.log('Checking for database migrations...');

    // Check if tables exist
    const tables = getAll("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Existing tables:', tables.map(t => t.name));

    const columns = db.pragma('table_info(user_info)');
    const hasSessionId = columns.some(col => col.name === 'session_id');

    if (!hasSessionId) {
      console.log('Adding session_id column to user_info table...');
      db.prepare("ALTER TABLE user_info ADD COLUMN session_id TEXT UNIQUE").run();
      console.log('Migration completed: session_id column added');
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
  }
}

// Helper functions for database operations
export async function getOne(sql, params = []) {
  return await db.prepare(sql).get(...params);
}

export async function getAll(sql, params = []) {
  return await db.prepare(sql).all(...params);
}

export async function runQuery(sql, params = []) {
  return await db.prepare(sql).run(...params);
}

