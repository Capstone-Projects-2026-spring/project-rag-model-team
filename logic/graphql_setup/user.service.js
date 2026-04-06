import { getAll, getOne, runQuery } from '../database/sqlite.js';

export function getAllUsers() {
  return getAll(`
    SELECT id, created_at
    FROM user_profiles
  `);
}

export function getUserByID(id) {
  return getOne(`
        SELECT id, created_at
        FROM user_profiles
        WHERE id = ?
    `, [id]);
}

export function health() {
  return {status: 'ok', message: 'Server is running'};
}

export function profile() {
  try {
    const sessionId = req.session.id;

    // Check if profile exists
    let profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [sessionId]);

    if (!profile) {
      runQuery('INSERT INTO user_profiles (session_id) VALUES (?)', [sessionId]);
      profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [sessionId]);
    }

    const userInfo = getOne('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]);

    res.json({
      profile,
      userInfo,
      hasCompletedIntake: !!userInfo
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}
