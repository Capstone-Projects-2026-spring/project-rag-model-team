import fs from "fs";


/**
 * Appends feedback to feedback.txt and uploads/updates it in Google Drive.
 * @param {string} user - Slack user ID or name
 * @param {string} feedback - Feedback text or value
 * @param {object} [extra] - Optional extra info (question, response, etc)
 */
export async function logAndUploadFeedback(user, feedback, extra = {}) {
  const timestamp = new Date().toISOString();
  let entry = `---\nUser: ${user}\nTime: ${timestamp}\nFeedback: ${feedback}`;
  if (extra && Object.keys(extra).length > 0) {
    entry += `\nDetails: ${JSON.stringify(extra)}`;
  }
  entry += "\n";
  const filePath = "feedback.txt";
  fs.appendFileSync(filePath, entry);
}
