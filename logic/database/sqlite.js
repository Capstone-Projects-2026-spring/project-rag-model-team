import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getClassificationForRole } from '../security/access_control.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'db', 'users.db');
let db;

export function initDatabase() {
  if (db) {
    return db;
  }
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

function runMigrations() {
  try {
    console.log('Checking for database migrations...');

    const tables = getAll("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Existing tables:', tables.map((table) => table.name));

    const columns = db.pragma('table_info(user_info)');
    const hasSessionId = columns.some((column) => column.name === 'session_id');
    const hasClassificationLevel = columns.some(
      (column) => column.name === 'classification_level',
    );

    if (!hasSessionId) {
      console.log('Adding session_id column to user_info table...');
      db.prepare("ALTER TABLE user_info ADD COLUMN session_id TEXT UNIQUE").run();
      console.log('Migration completed: session_id column added');
    }
    if (!hasClassificationLevel) {
      console.log('Adding classification_level column to user_info table...');
      db.prepare(
        "ALTER TABLE user_info ADD COLUMN classification_level TEXT NOT NULL DEFAULT 'internal'",
      ).run();

      const existingUsers = getAll('SELECT id, role FROM user_info');
      const updateClassification = db.prepare(
        'UPDATE user_info SET classification_level = ? WHERE id = ?',
      );

      for (const user of existingUsers) {
        updateClassification.run(getClassificationForRole(user.role), user.id);
      }

      console.log('Migration completed: classification_level column added');
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
  }
}
export function getOne(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function getAll(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function runQuery(sql, params = []) {
  return db.prepare(sql).run(...params);
}
