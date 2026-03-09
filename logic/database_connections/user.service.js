import db from './db.js';

export function getAllUsers() {
  return db.prepare(`
    SELECT id, email, username, is_active, created_at
    FROM users
  `).all();
}

export function getUserByID(id) {
  return db.prepare(`
        SELECT id, email, username, is_active, created_at
        FROM users
        WHERE id = ?
    `).get(id);
}
