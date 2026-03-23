import { getOne, getAll, runQuery } from '../../backend/server-sqljs.js';

export const root = {
  health: () => ({ status: 'ok', message: 'Server is running' }),
  getAllUsers: () => getAll(`SELECT id, session_id, created_at FROM user_profiles`),
  getUserByID: ({ id }) => getOne(`SELECT id, session_id, created_at FROM user_profiles WHERE id = ?`, [id]),
  getAllUserProfiles: () => {
    const profiles = getAll(`SELECT id, session_id, created_at FROM user_profiles`);

    return profiles.map(profile => {
      console.log(profile);
      const userInfo = getOne(
      `SELECT * FROM user_info WHERE profile_id = ?`,
      [profile.id]
      );
      return {
        profile: profile,
        userInfo: userInfo,
        hasCompletedIntake: userInfo ? true : false
      };
    });
  },
  getUserProfile: ({ session_id }) => {
    const profile = getOne(
      `SELECT id, session_id, created_at FROM user_profiles WHERE session_id = ?`,
      [session_id]
    );

    if (!profile) {
      return null;
    }

    const userInfo = getOne(
      `SELECT * FROM user_info WHERE profile_id = ?`,
      [profile.id]
    );

    return {
      profile: profile,
      userInfo: userInfo,
      hasCompletedIntake: userInfo ? true : false
    };
  },
  
  createUserProfile: ({ input }) => {
    // First create the user profile
    const profileResult = runQuery(
      `INSERT INTO user_profiles (session_id) VALUES (?)`,
      [input.session_id]
    );
    const profileId = profileResult.lastInsertRowid;

    // Then create the user info
    const infoResult = runQuery(
      `INSERT INTO user_info (
        profile_id, session_id, name, email, role, experience_level, department,
        areas_of_interest, technical_skills, learning_goals, preferred_content_complexity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profileId,
        input.session_id,
        input.name || null,
        input.email || null,
        input.role,
        input.experience_level,
        input.department || null,
        input.areas_of_interest || null,
        input.technical_skills || null,
        input.learning_goals || null,
        input.preferred_content_complexity || null
      ]
    );
    if (!infoResult) {
      // If user info creation failed, clean up the created profile
      runQuery(`DELETE FROM user_profiles WHERE id = ?`, [profileId]);
      throw new Error('Failed to create user info');
    }

    // Return the complete profile
    const profile = getOne(
      `SELECT id, session_id, created_at FROM user_profiles WHERE id = ?`,
      [profileId]
    );

    const userInfo = getOne(
      `SELECT * FROM user_info WHERE profile_id = ?`,
      [profileId]
    );

    return {
      profile: profile,
      userInfo: userInfo,
      hasCompletedIntake: true
    };
  },
  updateUserProfile: ({ session_id, input }) => {
    // First get the user profile
    const profile = getOne(
      `SELECT id, session_id, created_at FROM user_profiles WHERE session_id = ?`,
      [session_id]
    );

    if (!profile) {
      throw new Error(`User profile with session_id ${session_id} not found`);
    }

    // Check if user_info exists
    const existingInfo = getOne(
      `SELECT id FROM user_info WHERE profile_id = ?`,
      [profile.id]
    );

    if (existingInfo) {
      // Update existing user_info
      runQuery(
        `UPDATE user_info SET
          name = ?, email = ?, role = ?, experience_level = ?, department = ?,
          areas_of_interest = ?, technical_skills = ?, learning_goals = ?, preferred_content_complexity = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE profile_id = ?`,
        [
          input.name || null,
          input.email || null,
          input.role,
          input.experience_level,
          input.department || null,
          input.areas_of_interest || null,
          input.technical_skills || null,
          input.learning_goals || null,
          input.preferred_content_complexity || null,
          profile.id
        ]
      );
    } else {
      // Create new user_info
      runQuery(
        `INSERT INTO user_info (
          profile_id, session_id, name, email, role, experience_level, department,
          areas_of_interest, technical_skills, learning_goals, preferred_content_complexity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profile.id,
          session_id,
          input.name || null,
          input.email || null,
          input.role,
          input.experience_level,
          input.department || null,
          input.areas_of_interest || null,
          input.technical_skills || null,
          input.learning_goals || null,
          input.preferred_content_complexity || null
        ]
      );
    }

    // Return updated profile
    const userInfo = getOne(
      `SELECT * FROM user_info WHERE profile_id = ?`,
      [profile.id]
    );

    return {
      profile: profile,
      userInfo: userInfo,
      hasCompletedIntake: true
    };
  },
  removeUser: ({ id }) => {
    runQuery(`DELETE FROM user_profiles WHERE id = ?`, [id]);
    runQuery(`DELETE FROM user_info WHERE profile_id = ?`, [id]);

    const check = getOne(`SELECT id FROM user_profiles WHERE id = ?`, [id]);
    const secondCheck = getOne(`SELECT id FROM user_info WHERE profile_id = ?`, [id]);

    if (!check && !secondCheck) {
      return true;  // row is gone, delete succeeded
    }

    return false;   // row still exists, delete failed
  }
};
