import { runQuery, getOne, getAll } from './sqlite.js';

/**
 * Store user feedback about a bot response
 * @param {string} userSessionId - The user's session ID
 * @param {string} messageTs - The Slack message timestamp
 * @param {string} channelId - The Slack channel ID
 * @param {string} feedbackType - Either 'helpful' or 'not_helpful'
 * @param {string} userQuestion - The question the user asked
 * @param {string} botResponseSummary - A summary of the bot's response
 */
export function storeFeedback(
  userSessionId,
  messageTs,
  channelId,
  feedbackType,
  userQuestion = null,
  botResponseSummary = null
) {
  if (!userSessionId || !messageTs || !channelId || !feedbackType) {
    throw new Error('Missing required feedback parameters');
  }

  if (!['helpful', 'not_helpful'].includes(feedbackType)) {
    throw new Error('Invalid feedback type. Must be "helpful" or "not_helpful"');
  }

  try {
    runQuery(
      `INSERT INTO response_feedback (
        user_session_id, message_ts, channel_id, feedback_type,
        user_question, bot_response_summary
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [userSessionId, messageTs, channelId, feedbackType, userQuestion, botResponseSummary]
    );
    console.log(`✅ Feedback stored: ${feedbackType} from ${userSessionId} on message ${messageTs}`);
  } catch (error) {
    console.error('Error storing feedback:', error);
    throw error;
  }
}

/**
 * Get feedback statistics for a user
 * @param {string} userSessionId - The user's session ID
 * @returns {object} Statistics about user's feedback
 */
export function getUserFeedbackStats(userSessionId) {
  try {
    const stats = getOne(
      `SELECT
        COUNT(*) as total_feedback,
        SUM(CASE WHEN feedback_type = 'helpful' THEN 1 ELSE 0 END) as helpful_count,
        SUM(CASE WHEN feedback_type = 'not_helpful' THEN 1 ELSE 0 END) as not_helpful_count
      FROM response_feedback
      WHERE user_session_id = ?`,
      [userSessionId]
    );
    return stats || { total_feedback: 0, helpful_count: 0, not_helpful_count: 0 };
  } catch (error) {
    console.error('Error retrieving user feedback stats:', error);
    throw error;
  }
}

/**
 * Get all feedback for a specific message
 * @param {string} messageTs - The Slack message timestamp
 * @returns {array} Array of feedback records
 */
export function getFeedbackForMessage(messageTs) {
  try {
    const feedback = getAll(
      `SELECT * FROM response_feedback WHERE message_ts = ? ORDER BY created_at DESC`,
      [messageTs]
    );
    return feedback || [];
  } catch (error) {
    console.error('Error retrieving feedback for message:', error);
    throw error;
  }
}

/**
 * Get feedback for a specific user and time period
 * @param {string} userSessionId - The user's session ID
 * @param {number} daysBack - Number of days to look back (default: 30)
 * @returns {array} Array of feedback records
 */
export function getUserFeedbackHistory(userSessionId, daysBack = 30) {
  try {
    const feedback = getAll(
      `SELECT * FROM response_feedback
      WHERE user_session_id = ?
      AND created_at >= datetime('now', '-' || ? || ' days')
      ORDER BY created_at DESC`,
      [userSessionId, daysBack]
    );
    return feedback || [];
  } catch (error) {
    console.error('Error retrieving user feedback history:', error);
    throw error;
  }
}

/**
 * Check if a user has already given feedback on a specific message
 * @param {string} userSessionId - The user's session ID
 * @param {string} messageTs - The Slack message timestamp
 * @returns {object|null} Existing feedback or null
 */
export function getExistingFeedback(userSessionId, messageTs) {
  try {
    const feedback = getOne(
      `SELECT * FROM response_feedback
      WHERE user_session_id = ? AND message_ts = ?
      ORDER BY created_at DESC
      LIMIT 1`,
      [userSessionId, messageTs]
    );
    return feedback || null;
  } catch (error) {
    console.error('Error checking for existing feedback:', error);
    throw error;
  }
}

/**
 * Get system-wide feedback statistics
 * @returns {object} Overall feedback statistics
 */
export function getOverallFeedbackStats() {
  try {
    const stats = getOne(
      `SELECT
        COUNT(*) as total_feedback,
        SUM(CASE WHEN feedback_type = 'helpful' THEN 1 ELSE 0 END) as helpful_count,
        SUM(CASE WHEN feedback_type = 'not_helpful' THEN 1 ELSE 0 END) as not_helpful_count,
        ROUND(
          SUM(CASE WHEN feedback_type = 'helpful' THEN 1 ELSE 0 END) * 100.0 /
          COUNT(*), 2
        ) as helpful_percentage
      FROM response_feedback`
    );
    return stats || { total_feedback: 0, helpful_count: 0, not_helpful_count: 0, helpful_percentage: 0 };
  } catch (error) {
    console.error('Error retrieving overall feedback stats:', error);
    throw error;
  }
}

/**
 * Update feedback if the user changes their mind
 * @param {string} userSessionId - The user's session ID
 * @param {string} messageTs - The Slack message timestamp
 * @param {string} newFeedbackType - New feedback type
 */
export function updateFeedback(userSessionId, messageTs, newFeedbackType) {
  if (!['helpful', 'not_helpful'].includes(newFeedbackType)) {
    throw new Error('Invalid feedback type. Must be "helpful" or "not_helpful"');
  }

  try {
    runQuery(
      `UPDATE response_feedback
      SET feedback_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_session_id = ? AND message_ts = ?`,
      [newFeedbackType, userSessionId, messageTs]
    );
    console.log(`✅ Feedback updated: ${newFeedbackType} from ${userSessionId} on message ${messageTs}`);
  } catch (error) {
    console.error('Error updating feedback:', error);
    throw error;
  }
}
