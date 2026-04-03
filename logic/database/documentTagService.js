import { getOne, getAll, runQuery } from './sqlite.js';

function parseTagsField(row) {
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    auto_classified: row.auto_classified === 1,
  };
}

/**
 * Insert or replace a document's tag record.
 * @param {string} fileId - Google Drive file ID
 * @param {string} fileName - Display name of the file
 * @param {string} classificationLevel - 'public' | 'internal' | 'confidential' | 'restricted'
 * @param {string[]} tags - Array of topic tag strings
 * @param {boolean} autoClassified - true if tags were assigned by LLM, false if from Drive metadata
 */
export function upsertDocumentTags(fileId, fileName, classificationLevel, tags, autoClassified = false) {
  runQuery(
    `INSERT INTO document_tags (drive_file_id, file_name, classification_level, tags, auto_classified, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(drive_file_id) DO UPDATE SET
       file_name = excluded.file_name,
       classification_level = excluded.classification_level,
       tags = excluded.tags,
       auto_classified = excluded.auto_classified,
       updated_at = CURRENT_TIMESTAMP`,
    [fileId, fileName, classificationLevel, JSON.stringify(tags), autoClassified ? 1 : 0]
  );
}

/**
 * Get the tag record for a specific Drive file.
 * Returns null if not yet indexed.
 */
export function getDocumentTags(fileId) {
  const row = getOne(`SELECT * FROM document_tags WHERE drive_file_id = ?`, [fileId]);
  return parseTagsField(row);
}

/**
 * Get all documents that have a given topic tag.
 * Uses a JSON string search (e.g. tags column contains `"onboarding"`).
 */
export function getDocumentsByTag(tag) {
  const rows = getAll(
    `SELECT * FROM document_tags WHERE tags LIKE ?`,
    [`%"${tag.toLowerCase()}"%`]
  );
  return rows.map(parseTagsField);
}

/**
 * Get all indexed document tag records.
 */
export function getAllDocumentTags() {
  return getAll(`SELECT * FROM document_tags ORDER BY file_name`).map(parseTagsField);
}
