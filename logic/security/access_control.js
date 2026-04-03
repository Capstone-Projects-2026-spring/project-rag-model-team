const CLASSIFICATION_RANKS = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

const ROLE_CLASSIFICATION_MAP = {
  student: 'public',
  junior_dev: 'internal',
  mid_dev: 'internal',
  designer: 'internal',
  qa: 'internal',
  senior_dev: 'confidential',
  devops: 'confidential',
  manager: 'restricted',
};

export function normalizeClassification(level) {
  const normalized = String(level || '').trim().toLowerCase();
  return Object.hasOwn(CLASSIFICATION_RANKS, normalized) ? normalized : 'internal';
}

export function getClassificationForRole(role) {
  return ROLE_CLASSIFICATION_MAP[role] || 'internal';
}

export function canAccessClassification(userClassification, resourceClassification) {
  const userRank = CLASSIFICATION_RANKS[normalizeClassification(userClassification)];
  const resourceRank = CLASSIFICATION_RANKS[normalizeClassification(resourceClassification)];
  return userRank >= resourceRank;
}

export function parseDriveFileClassification(file = {}) {
  const haystack = `${file.description || ''} ${file.name || ''}`;
  const match = haystack.match(/classification\s*[:=]\s*(public|internal|confidential|restricted)/i);
  return normalizeClassification(match?.[1]);
}

/**
 * Parses topic tags from a Drive file's description or name.
 * Expects format: "tags: onboarding, backend, api" (pipe-delimited from other metadata is fine).
 */
export function parseDriveFileTags(file = {}) {
  const haystack = `${file.description || ''} ${file.name || ''}`;
  const match = haystack.match(/tags\s*[:=]\s*([^|]+)/i);
  if (!match) return [];
  return match[1].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export function annotateFilesWithClassification(files = []) {
  return files.map((file) => ({
    ...file,
    classification_level: parseDriveFileClassification(file),
    tags: parseDriveFileTags(file),
  }));
}

export function filterAccessibleFiles(files = [], userClassification) {
  return annotateFilesWithClassification(files).filter((file) =>
    canAccessClassification(userClassification, file.classification_level)
  );
}

export function filterAccessibleProfiles(profiles = [], userClassification) {
  return profiles.filter((profile) => {
    const profileClassification =
      profile?.userInfo?.classification_level || getClassificationForRole(profile?.userInfo?.role);

    return canAccessClassification(userClassification, profileClassification);
  });
}

export function buildAccessDeniedMessage(topic) {
  const suffix = topic ? ` for "${topic}"` : '';
  return `Sorry, your current access level does not allow me to share that information${suffix}.`;
}
