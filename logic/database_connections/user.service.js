import db from './sqlite';

function getAllUsers() {
  return db.prepare(`
    SELECT id, email, username, is_active, created_at
    FROM users
  `).all();
}

function getUserByID(id) {
  return db.prepare(`
        SELECT id, email, username, is_active, created_at
        FROM users
        WHERE id = ?
    `).get(id);
}

module.exports = { getAllUsers, getUserByID };
