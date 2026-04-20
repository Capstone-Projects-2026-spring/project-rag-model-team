-- User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User Information Table
CREATE TABLE IF NOT EXISTS user_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    session_id TEXT,
    name TEXT,
    email TEXT,
    github_username TEXT,
    active_github_repo TEXT,
    role TEXT NOT NULL, -- e.g., 'junior_dev', 'senior_dev', 'manager', 'designer', etc.
    classification_level TEXT NOT NULL DEFAULT 'internal', -- e.g., 'public', 'internal', 'confidential', 'restricted'
    experience_level TEXT NOT NULL, -- e.g., 'entry', 'mid', 'senior', 'expert'
    department TEXT,
    areas_of_interest TEXT, -- JSON array as TEXT
    technical_skills TEXT, -- JSON array as TEXT
    learning_goals TEXT, -- JSON array as TEXT
    preferred_content_complexity TEXT, -- e.g., 'beginner', 'intermediate', 'advanced'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

-- User Interactions Table (for tracking what content they've accessed)
CREATE TABLE IF NOT EXISTS user_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL, -- Links to user_profiles
    interaction_type TEXT NOT NULL, -- e.g., 'preemptive', 'reactive'
    message TEXT NOT NULL, -- The content they interacted with
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_session ON user_profiles(session_id);
CREATE INDEX IF NOT EXISTS idx_user_info_profile ON user_info(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_info_role ON user_info(role);
CREATE INDEX IF NOT EXISTS idx_user_info_classification ON user_info(classification_level);
CREATE INDEX IF NOT EXISTS idx_user_info_experience ON user_info(experience_level);
CREATE INDEX IF NOT EXISTS idx_interactions_profile ON user_interactions(profile_id);
CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON user_interactions(created_at);

-- Document Tags Table (tag cache for Google Drive files)
CREATE TABLE IF NOT EXISTS document_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_file_id TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    classification_level TEXT NOT NULL DEFAULT 'internal', -- e.g., 'public', 'internal', 'confidential', 'restricted'
    tags TEXT NOT NULL DEFAULT '[]',                       -- JSON array of topic tag strings
    auto_classified INTEGER NOT NULL DEFAULT 0,            -- 1 = LLM classified, 0 = from Drive metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_tags_file_id ON document_tags(drive_file_id);
CREATE INDEX IF NOT EXISTS idx_doc_tags_classification ON document_tags(classification_level);

-- GitHub Repositories synced for contributor recommendations
CREATE TABLE IF NOT EXISTS github_repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT UNIQUE NOT NULL,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    default_branch TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Aggregated contributor analytics per synced repository
CREATE TABLE IF NOT EXISTS github_contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    github_login TEXT NOT NULL,
    github_name TEXT,
    total_commits INTEGER NOT NULL DEFAULT 0,
    commits_last_15_days INTEGER NOT NULL DEFAULT 0,
    commits_last_30_days INTEGER NOT NULL DEFAULT 0,
    commits_last_90_days INTEGER NOT NULL DEFAULT 0,
    commits_last_180_days INTEGER NOT NULL DEFAULT 0,
    recent_commits INTEGER NOT NULL DEFAULT 0,
    last_commit_at DATETIME,
    touched_files TEXT NOT NULL DEFAULT '[]',
    recent_messages TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repo_id, github_login),
    FOREIGN KEY (repo_id) REFERENCES github_repositories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_github_repositories_full_name ON github_repositories(full_name);
CREATE INDEX IF NOT EXISTS idx_github_contributors_repo_id ON github_contributors(repo_id);
CREATE INDEX IF NOT EXISTS idx_github_contributors_login ON github_contributors(github_login);

-- Response Feedback Table (tracks helpful/not helpful feedback on bot responses)
CREATE TABLE IF NOT EXISTS response_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_session_id TEXT NOT NULL,
    message_ts TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL, -- 'helpful' or 'not_helpful'
    user_question TEXT,
    bot_response_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_session_id) REFERENCES user_profiles(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON response_feedback(user_session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_message ON response_feedback(message_ts);
CREATE INDEX IF NOT EXISTS idx_feedback_channel ON response_feedback(channel_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON response_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON response_feedback(created_at);
