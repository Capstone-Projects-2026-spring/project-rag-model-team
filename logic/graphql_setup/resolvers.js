import { getOne, getAll, runQuery } from '../../backend/server-sqljs.js';

export const root = {
  health: () => ({ status: 'ok', message: 'Server is running' }),
  getAllUsers: () => getAll(`SELECT id, created_at FROM user_profiles`),
  getUserByID: ({ id }) => getOne(`SELECT id, created_at FROM user_profiles WHERE id = ?`, [id]),
  createUser: ({ session_id }) => {
    const result = runQuery(
      `INSERT INTO user_profiles (session_id) VALUES (?)`,
      [session_id]
    );
    return getOne(
      `SELECT id, created_at FROM user_profiles WHERE id = ?`,
      [result.lastInsertRowid]
    );
  },
  removeUser: ({ id }) => {
    runQuery(`DELETE FROM user_profiles WHERE id = ?`, [id]);
    const check = getOne(`SELECT id FROM user_profiles WHERE id = ?`, [id]);
    if (!check) {
      return true;  // row is gone, delete succeeded
    }
    return false;   // row still exists, delete failed
  }
};
