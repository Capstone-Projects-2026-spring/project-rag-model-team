import { getOne, getAll, runQuery } from '../database/sqlite.js';

export const root = {
  // Simple health check query
  health: () => ({ status: 'ok', message: 'Server is running' }),
  // Fetch all users
  getAllUsers: async () => await getAll(`SELECT id, session_id, created_at FROM user_profiles`),
  // Fetch a user by ID
  getUserByID: async ({ id }) => await getOne(`SELECT id, session_id, created_at FROM user_profiles WHERE id = ?`, [id]),
  // Fetch all user profiles with their associated user info
  getAllUserProfiles: async () => {
    const profiles = await getAll(`SELECT id, session_id, created_at FROM user_profiles`);
    return profiles.map(async profile => {
      const userInfo = await getOne(
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
  // Fetch a user profile by session_id with associated user info
  getUserProfile: async ({ session_id }) => {
    const profile = await getOne(
      `SELECT id, session_id, created_at FROM user_profiles WHERE session_id = ?`,
      [session_id]
    );

    if (!profile) {
      return null;
    }

    const userInfo = await getOne(
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
  // Mutation for creating a new user profile along with user info
  createUserProfile: async ({ input }) => {
    try {
      console.log('Creating user profile with input:', input);
      
      // First create the user profile
      await runQuery(
        `INSERT INTO user_profiles (session_id) VALUES (?)`,
        [input.session_id]
      );
      
      // Get the created profile by session_id
      const profile = await getOne(
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
      const infoResult = await runQuery(
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
      const userInfo = await getOne(
        `SELECT * FROM user_info WHERE profile_id = ?`,
        [profileId]
      );
      console.log('Retrieved userInfo:', userInfo);

      if (!userInfo) {
        // Clean up if userInfo wasn't created
        await runQuery(`DELETE FROM user_profiles WHERE id = ?`, [profileId]);
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
  // Mutation for updating an existing user profile and user info
  updateUserProfile: async ({ session_id, input }) => {
    try {
      // First get the user profile
      const profile = await getOne(
        `SELECT id, session_id, created_at FROM user_profiles WHERE session_id = ?`,
        [session_id]
      );

      if (!profile) {
        throw new Error(`User profile with session_id ${session_id} not found`);
      }

      // Check if user_info exists
      const existingInfo = await getOne(
        `SELECT id FROM user_info WHERE profile_id = ?`,
        [profile.id]
      );

      if (existingInfo) {
        // Update existing user_info
        await runQuery(
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
        await runQuery(
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
      const userInfo = await getOne(
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
  // Mutation for removing a user profile and associated user info
  removeUser: async ({ id }) => {
    await runQuery(`DELETE FROM user_profiles WHERE id = ?`, [id]);
    await runQuery(`DELETE FROM user_info WHERE profile_id = ?`, [id]);

    const check = await getOne(`SELECT id FROM user_profiles WHERE id = ?`, [id]);
    const secondCheck = await getOne(`SELECT id FROM user_info WHERE profile_id = ?`, [id]);

    if (!check && !secondCheck) {
      return true;  // row is gone, delete succeeded
    }

    return false;   // row still exists, delete failed
  },
  // Mutation for creating a new interaction record (for tracking user interactions with content)
  createInteractionRecord: async ({ session_id, interactionType, message }) => {
    try {
      // Get the user profile by session_id
      const profile = await getOne(
        `SELECT id FROM user_profiles WHERE session_id = ?`,
        [session_id]
      );

      if (!profile) {
        throw new Error(`User profile with session_id ${session_id} not found`);
      }

      // Insert the interaction record
      await runQuery(
        `INSERT INTO user_interactions (profile_id, interaction_type, message)
         VALUES (?, ?, ?)`,
        [
          profile.id,
          interactionType,
          message
        ]
      );

      const check = await getOne(
        `SELECT * FROM user_interactions WHERE profile_id = ? AND interaction_type = ? AND message = ? ORDER BY created_at DESC LIMIT 1`,
        [
          profile.id,
          interactionType,
          message
        ]
      );

      if(!check){
        console.error('Error in createRecord:', error);
        return null;
      }

      const profile_id = check.profile_id
      const interaction_type_ = check.interaction_type
      const message_ =  check.message
      const created_at = check.created_at

      return { profile_id: profile_id, interaction_type: interaction_type_, message: message_, created_at: created_at  };
    } catch (error) {
      console.error('Error in createRecord:', error);
      throw new Error(`Failed to create interaction record: ${error.message}`);
    }
  },
  getInteractionRecords: async ({ session_id }) => {
    try {
      // Get the user profile by session_id
      const profile = await getOne(
        `SELECT id FROM user_profiles WHERE session_id = ?`,
        [session_id]
      );

      if (!profile) {
        throw new Error(`User profile with session_id ${session_id} not found`);
      }

      // Fetch interaction records for the profile
      const interactions = await getAll(
        `SELECT id, interaction_type, message, created_at, profile_id
         FROM user_interactions
         WHERE profile_id = ?`,
        [profile.id]
      );

      return interactions;
    } catch (error) {
      console.error('Error in getInteractionRecords:', error);
      throw new Error(`Failed to fetch interaction records: ${error.message}`);
    }
  },
  getAllInteractionRecords: async () => {
    return await getAll(`SELECT * FROM user_interactions`);
  },
  removeInteractionRecord: async ({ id }) => {
    await runQuery(`DELETE FROM user_interactions WHERE id = ?`, [id]);

    const check = await getOne(`SELECT id FROM user_interactions WHERE id = ?`, [id]);

    if (!check) {
      return true;  // row is gone, delete succeeded
    }

    return false;   // row still exists, delete failed
  }
};
