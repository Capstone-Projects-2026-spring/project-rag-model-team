import { getOne, getAll, runQuery } from '../../backend/server-sqljs.js';

export const root = {
  health: () => ({ status: 'ok', message: 'Server is running' }),
  getAllUsers: () => getAll(`SELECT id, session_id, created_at FROM user_profiles`),
  getUserByID: ({ id }) => getOne(`SELECT id, session_id, created_at FROM user_profiles WHERE id = ?`, [id]),
  getAllUserProfiles: () => {
    const profiles = getAll(`SELECT id, session_id, created_at FROM user_profiles`);

    return profiles.map(profile => {
      const userInfo = getOne(
        `SELECT * FROM user_info WHERE profile_id = ?`,
        [profile.id]
      );
      return {
        id: profile.id,
        session_id: profile.session_id,
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
      id: profile.id,
      session_id: profile.session_id,
      userInfo: userInfo,
      hasCompletedIntake: userInfo ? true : false
    };
  },
  
  createUserProfile: ({ input }) => {
    try {
      console.log('Creating user profile with input:', input);
      
      // First create the user profile
      runQuery(
        `INSERT INTO user_profiles (session_id) VALUES (?)`,
        [input.session_id]
      );
      
      // Get the created profile by session_id
      const profile = getOne(
        `SELECT id, session_id, created_at FROM user_profiles WHERE session_id = ?`,
        [input.session_id]
      );
      console.log('Created profile:', profile);

      if (!profile) {
        throw new Error('Failed to create or retrieve user profile');
      }

      const profileId = profile.id;

      // Then create the user info
      console.log('Creating user info for profile ID:', profileId);
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
      console.log('User info creation result:', infoResult);

      // Return the complete profile
      const userInfo = getOne(
        `SELECT * FROM user_info WHERE profile_id = ?`,
        [profileId]
      );
      console.log('Retrieved userInfo:', userInfo);

      if (!userInfo) {
        // Clean up if userInfo wasn't created
        runQuery(`DELETE FROM user_profiles WHERE id = ?`, [profileId]);
        throw new Error('Failed to create user info record');
      }

      return {
        id: profile.id,
        session_id: profile.session_id,
        userInfo: userInfo,
        hasCompletedIntake: true
      };
    } catch (error) {
      console.error('Error in createUserProfile:', error);
      throw new Error(`Failed to create user profile: ${error.message}`);
    }
  },
  updateUserProfile: ({ session_id, input }) => {
    try {
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

      if (!userInfo) {
        throw new Error('Failed to retrieve updated user info');
      }

      return {
        id: profile.id,
        session_id: profile.session_id,
        userInfo: userInfo,
        hasCompletedIntake: true
      };
    } catch (error) {
      console.error('Error in updateUserProfile:', error);
      throw new Error(`Failed to update user profile: ${error.message}`);
    }
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
