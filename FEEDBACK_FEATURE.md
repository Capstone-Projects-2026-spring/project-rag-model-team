# Response Feedback Feature Documentation

## Overview
The response feedback feature allows users to rate the Slack bot's responses as "helpful" or "not helpful" by clicking buttons that appear below each response. This helps track response quality and improve the bot over time.

## How It Works

### User Experience
1. When the bot responds to a question in Slack (both in DMs and channels), two feedback buttons appear below the response:
   - 👍 **Helpful** (green/primary button)
   - 👎 **Not helpful** (grey button)

2. Users can click either button to provide feedback
3. After clicking, a confirmation message appears:
   - Helpful: "✅ Thanks for the feedback! I'm glad this was helpful."
   - Not helpful: "📝 Thanks for the feedback! I'll work on improving my responses."

4. If a user clicks a different button later on the same message, their feedback is updated

### Technical Implementation

#### Database Schema
A new `response_feedback` table stores all feedback with the following fields:
- `id`: Primary key
- `user_session_id`: Links to the user who gave feedback
- `message_ts`: Slack message timestamp (unique identifier for the response)
- `channel_id`: The Slack channel where feedback was given
- `feedback_type`: Either "helpful" or "not_helpful"
- `user_question`: The question that was answered (optional)
- `bot_response_summary`: A summary of the response (optional)
- `created_at`: When feedback was submitted
- `updated_at`: When feedback was last updated

Indexes are created on user, message, channel, type, and timestamp for efficient querying.

#### Files Modified/Created

1. **logic/database/schema.sql**
   - Added `response_feedback` table definition
   - Added 5 indexes for optimal query performance

2. **logic/database/feedbackService.js** (NEW)
   - `storeFeedback()`: Save new feedback to the database
   - `updateFeedback()`: Update existing feedback
   - `getExistingFeedback()`: Check if user already gave feedback on a message
   - `getUserFeedbackStats()`: Get a user's feedback statistics
   - `getUserFeedbackHistory()`: Get user's feedback over a time period
   - `getFeedbackForMessage()`: Get all feedback on a specific message
   - `getOverallFeedbackStats()`: Get system-wide feedback statistics

3. **index.js**
   - Imported feedback service functions
   - Added `buildFeedbackButtons()`: Creates feedback button blocks
   - Added `appendFeedbackButtons()`: Adds feedback buttons to response blocks
   - Updated `app_mention` handler to include feedback buttons on responses
   - Updated `message` (DM) handler to include feedback buttons on responses
   - Added `feedback_helpful` action handler to process helpful clicks
   - Added `feedback_not_helpful` action handler to process not helpful clicks

4. **logic/database/sqlite.js**
   - Added migration check for `response_feedback` table
   - Automatically creates the table on first run if it doesn't exist

## Usage

### For Users
Simply click the appropriate button after receiving a response from the bot:
- 👍 **Helpful** if the response answered your question well
- 👎 **Not helpful** if the response wasn't useful or accurate

### For Administrators
Query the database to analyze feedback:

```javascript
import { getOverallFeedbackStats, getUserFeedbackStats } from './logic/database/feedbackService.js';

// Get overall statistics
const stats = getOverallFeedbackStats();
console.log(`Helpful: ${stats.helpful_count} (${stats.helpful_percentage}%)`);
console.log(`Not helpful: ${stats.not_helpful_count}`);

// Get user-specific statistics
const userStats = getUserFeedbackStats('user_session_id');
console.log(userStats);
```

## Features

✅ **Persistent Storage**: All feedback is stored in the database with timestamps
✅ **User Feedback History**: Track feedback from each user over time
✅ **Update Capability**: Users can change their feedback if they click the wrong button
✅ **Message-Level Tracking**: Feedback is linked to specific bot responses via message timestamps
✅ **Automatic Acknowledgment**: Clear confirmation messages inform users their feedback was recorded
✅ **Indexed Queries**: Optimized database queries for fast lookups

## Future Enhancement Ideas

- Display aggregate feedback score below responses
- Add optional text field for users to provide detailed feedback
- Create a dashboard showing feedback trends over time
- Automatically flag responses with high "not helpful" rates for review
- Use feedback data to improve the RAG implementation
- Set up alerts when feedback scores drop below a threshold
- Generate reports on response quality by topic

## Database Queries

Get feedback for a specific user in the last 30 days:
```sql
SELECT * FROM response_feedback
WHERE user_session_id = ?
AND created_at >= datetime('now', '-30 days')
ORDER BY created_at DESC;
```

Get the most helpful responses:
```sql
SELECT message_ts, channel_id, COUNT(*) as helpful_count
FROM response_feedback
WHERE feedback_type = 'helpful'
GROUP BY message_ts
ORDER BY helpful_count DESC;
```

Get feedback statistics by day:
```sql
SELECT 
  DATE(created_at) as date,
  SUM(CASE WHEN feedback_type = 'helpful' THEN 1 ELSE 0 END) as helpful,
  SUM(CASE WHEN feedback_type = 'not_helpful' THEN 1 ELSE 0 END) as not_helpful
FROM response_feedback
GROUP BY DATE(created_at)
ORDER BY date DESC;
```
