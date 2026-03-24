import db from '../database/sqlite.js';

export function getAllUsers() {
  return db.prepare(`
    SELECT id, created_at
    FROM user_profiles
  `).all();
}

export function getUserByID(id) {
  return db.prepare(`
        SELECT id, created_at
        FROM user_profiles
        WHERE id = ?
    `).get(id);
}

export function health() {
  return {status: 'ok', message: 'Server is running'};
}

export function profile() {
  try {
    const sessionId = req.session.id;

    // Check if profile exists
    let profile = db.prepare('SELECT * FROM user_profiles WHERE session_id = ?', [sessionId]);

    if (!profile) {
      // Create new profile
      const result = db.prepare('INSERT INTO user_profiles (session_id) VALUES (?)', [sessionId]);
      profile = db.prepare('SELECT * FROM user_profiles WHERE id = ?', [result.lastInsertRowid]);
    }

    // Get user info if exists
    const userInfo = db.prepare('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]);

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
