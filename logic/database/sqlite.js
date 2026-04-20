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
  db.pragma('journal_mode = WAL');
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
    const hasGitHubUsername = columns.some(
      (column) => column.name === 'github_username',
    );
    const hasActiveGitHubRepo = columns.some(
      (column) => column.name === 'active_github_repo',
    );
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
    if (!hasGitHubUsername) {
      console.log('Adding github_username column to user_info table...');
      db.prepare("ALTER TABLE user_info ADD COLUMN github_username TEXT").run();
      console.log('Migration completed: github_username column added');
    }
    if (!hasActiveGitHubRepo) {
      console.log('Adding active_github_repo column to user_info table...');
      db.prepare("ALTER TABLE user_info ADD COLUMN active_github_repo TEXT").run();
      console.log('Migration completed: active_github_repo column added');
    }
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_user_info_github_username ON user_info(github_username)',
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_user_info_active_github_repo ON user_info(active_github_repo)',
    ).run();

    const interactionColumns = db.pragma('table_info(user_interactions)');
    const hasMessageColumn = interactionColumns.some((col) => col.name === 'message');
    if (!hasMessageColumn) {
      console.log('Adding message column to user_interactions table...');
      db.prepare("ALTER TABLE user_interactions ADD COLUMN message TEXT NOT NULL DEFAULT ''").run();
      console.log('Migration completed: message column added to user_interactions');
    }

    const docTagsExists = tables.some((t) => t.name === 'document_tags');
    if (!docTagsExists) {
      console.log('Creating document_tags table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS document_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          drive_file_id TEXT UNIQUE NOT NULL,
          file_name TEXT NOT NULL,
          classification_level TEXT NOT NULL DEFAULT 'internal',
          tags TEXT NOT NULL DEFAULT '[]',
          auto_classified INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_doc_tags_file_id ON document_tags(drive_file_id);
        CREATE INDEX IF NOT EXISTS idx_doc_tags_classification ON document_tags(classification_level);
      `);
      console.log('Migration completed: document_tags table created');
    }

    const githubReposExists = tables.some((t) => t.name === 'github_repositories');
    if (!githubReposExists) {
      console.log('Creating github_repositories table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS github_repositories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT UNIQUE NOT NULL,
          owner TEXT NOT NULL,
          name TEXT NOT NULL,
          default_branch TEXT,
          synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_github_repositories_full_name ON github_repositories(full_name);
      `);
      console.log('Migration completed: github_repositories table created');
    }

    const githubContributorsExists = tables.some((t) => t.name === 'github_contributors');
    if (!githubContributorsExists) {
      console.log('Creating github_contributors table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS github_contributors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repo_id INTEGER NOT NULL,
          github_login TEXT NOT NULL,
          github_name TEXT,
          total_commits INTEGER NOT NULL DEFAULT 0,
          commits_last_15_days INTEGER NOT NULL DEFAULT 0,
          commits_last_30_days INTEGER NOT NULL DEFAULT 0,
          commits_last_90_days INTEGER NOT NULL DEFAULT 0,
          commits_last_180_days INTEGER NOT NULL DEFAULT 0,
          recent_commits INTEGER NOT NULL DEFAULT 0,
          last_commit_at DATETIME,
          touched_files TEXT NOT NULL DEFAULT '[]',
          recent_messages TEXT NOT NULL DEFAULT '[]',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(repo_id, github_login),
          FOREIGN KEY (repo_id) REFERENCES github_repositories(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_github_contributors_repo_id ON github_contributors(repo_id);
        CREATE INDEX IF NOT EXISTS idx_github_contributors_login ON github_contributors(github_login);
      `);
      console.log('Migration completed: github_contributors table created');
    }

    const githubContributorColumns = db.pragma('table_info(github_contributors)');
    const timeWindowColumns = [
      ['commits_last_15_days', '0'],
      ['commits_last_30_days', '0'],
      ['commits_last_90_days', '0'],
      ['commits_last_180_days', '0'],
    ];

    for (const [columnName, defaultValue] of timeWindowColumns) {
      const hasColumn = githubContributorColumns.some((column) => column.name === columnName);
      if (!hasColumn) {
        console.log(`Adding ${columnName} column to github_contributors table...`);
        db.prepare(
          `ALTER TABLE github_contributors ADD COLUMN ${columnName} INTEGER NOT NULL DEFAULT ${defaultValue}`,
        ).run();
        console.log(`Migration completed: ${columnName} column added`);
      }
    }

    const responseFeedbackExists = tables.some((t) => t.name === 'response_feedback');
    if (!responseFeedbackExists) {
      console.log('Creating response_feedback table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS response_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_session_id TEXT NOT NULL,
          message_ts TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          feedback_type TEXT NOT NULL,
          user_question TEXT,
          bot_response_summary TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_session_id) REFERENCES user_profiles(session_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_user ON response_feedback(user_session_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_message ON response_feedback(message_ts);
        CREATE INDEX IF NOT EXISTS idx_feedback_channel ON response_feedback(channel_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_type ON response_feedback(feedback_type);
        CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON response_feedback(created_at);
      `);
      console.log('Migration completed: response_feedback table created');
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
  }
}

// Helper functions for database operations
export function getOne(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function getAll(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function runQuery(sql, params = []) {
  return db.prepare(sql).run(...params);
}
