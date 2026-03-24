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
    role TEXT NOT NULL, -- e.g., 'junior_dev', 'senior_dev', 'manager', 'designer', etc.
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
    profile_id INTEGER NOT NULL,
    interaction_type TEXT NOT NULL, -- e.g., 'page_view', 'search', 'feedback'
    content_id TEXT,
    content_title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT, -- JSON as TEXT for additional context
    FOREIGN KEY (profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_session ON user_profiles(session_id);
CREATE INDEX IF NOT EXISTS idx_user_info_profile ON user_info(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_info_role ON user_info(role);
CREATE INDEX IF NOT EXISTS idx_user_info_experience ON user_info(experience_level);
CREATE INDEX IF NOT EXISTS idx_interactions_profile ON user_interactions(profile_id);
CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON user_interactions(created_at);
