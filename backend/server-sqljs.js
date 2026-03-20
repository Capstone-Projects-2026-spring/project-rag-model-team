require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bodyParser = require('body-parser');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Database setup
const dbPath = path.join(__dirname, 'database', 'users.db');
let db;

// Initialize SQL.js database
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
    // Create tables
    const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
    db.run(schema);
    saveDatabase();
  }
}

// Save database to file
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(dbPath, buffer);
}

// Helper functions for database operations
function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function runQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDatabase();

  // Get last insert ID
  const result = getOne('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: result ? result.id : null };
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// ============= API Routes =============

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Get or create user profile by session
app.get('/api/profile', (req, res) => {
  try {
    const sessionId = req.session.id;

    // Check if profile exists
    let profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [sessionId]);

    if (!profile) {
      // Create new profile
      const result = runQuery('INSERT INTO user_profiles (session_id) VALUES (?)', [sessionId]);
      profile = getOne('SELECT * FROM user_profiles WHERE id = ?', [result.lastInsertRowid]);
    }

    // Get user info if exists
    const userInfo = getOne('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]);

    res.json({
      profile,
      userInfo,
      hasCompletedIntake: !!userInfo
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Submit intake form
app.post('/api/intake', (req, res) => {
  try {
    const sessionId = req.session.id;
    const {
      name,
      email,
      role,
      experienceLevel,
      department,
      areasOfInterest,
      technicalSkills,
      learningGoals,
      preferredContentComplexity
    } = req.body;

    // Validate required fields
    if (!role || !experienceLevel) {
      return res.status(400).json({ error: 'Role and experience level are required' });
    }

    // Get or create profile
    let profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [sessionId]);

    if (!profile) {
      const result = runQuery('INSERT INTO user_profiles (session_id) VALUES (?)', [sessionId]);
      profile = getOne('SELECT * FROM user_profiles WHERE id = ?', [result.lastInsertRowid]);
    }

    // Check if user info already exists
    const existingInfo = getOne('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]);

    if (existingInfo) {
      // Update existing info
      runQuery(`
        UPDATE user_info SET
          name = ?,
          email = ?,
          role = ?,
          experience_level = ?,
          department = ?,
          areas_of_interest = ?,
          technical_skills = ?,
          learning_goals = ?,
          preferred_content_complexity = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE profile_id = ?
      `, [
        name,
        email,
        role,
        experienceLevel,
        department,
        JSON.stringify(areasOfInterest || []),
        JSON.stringify(technicalSkills || []),
        JSON.stringify(learningGoals || []),
        preferredContentComplexity,
        profile.id
      ]);
    } else {
      // Insert new info
      runQuery(`
        INSERT INTO user_info (
          profile_id, name, email, role, experience_level, department,
          areas_of_interest, technical_skills, learning_goals, preferred_content_complexity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        profile.id,
        name,
        email,
        role,
        experienceLevel,
        department,
        JSON.stringify(areasOfInterest || []),
        JSON.stringify(technicalSkills || []),
        JSON.stringify(learningGoals || []),
        preferredContentComplexity
      ]);
    }

    // Fetch updated user info
    const userInfo = getOne('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]);

    res.json({
      success: true,
      message: 'Intake form submitted successfully',
      userInfo
    });
  } catch (error) {
    console.error('Error submitting intake:', error);
    res.status(500).json({ error: 'Failed to submit intake form' });
  }
});

// Track user interaction
app.post('/api/interaction', (req, res) => {
  try {
    const sessionId = req.session.id;
    const { interactionType, contentId, contentTitle, metadata } = req.body;

    // Get profile
    const profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [sessionId]);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Insert interaction
    runQuery(`
      INSERT INTO user_interactions (profile_id, interaction_type, content_id, content_title, metadata)
      VALUES (?, ?, ?, ?, ?)
    `, [
      profile.id,
      interactionType,
      contentId,
      contentTitle,
      JSON.stringify(metadata || {})
    ]);

    res.json({ success: true, message: 'Interaction tracked' });
  } catch (error) {
    console.error('Error tracking interaction:', error);
    res.status(500).json({ error: 'Failed to track interaction' });
  }
});

// Get personalized content recommendations
app.get('/api/recommendations', (req, res) => {
  try {
    const sessionId = req.session.id;

    // Get profile and user info
    const profile = getOne('SELECT * FROM user_profiles WHERE session_id = ?', [sessionId]);

    if (!profile) {
      return res.json({ recommendations: [], reason: 'No profile found' });
    }

    const userInfo = getOne('SELECT * FROM user_info WHERE profile_id = ?', [profile.id]);

    if (!userInfo) {
      return res.json({ recommendations: [], reason: 'Intake not completed' });
    }

    // Generate recommendations based on role and experience
    const recommendations = generateRecommendations(userInfo);

    res.json({
      recommendations,
      userRole: userInfo.role,
      experienceLevel: userInfo.experience_level
    });
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// Helper function to generate recommendations
function generateRecommendations(userInfo) {
  const recommendations = [];

  // Role-based recommendations
  const roleMapping = {
    'junior_dev': [
      { title: 'Getting Started Guide', path: '/docs/intro', complexity: 'beginner' },
      { title: 'Tutorial Basics', path: '/docs/tutorial-basics', complexity: 'beginner' },
      { title: 'Development Environment Setup', path: '/docs/system-architecture/development-environment', complexity: 'beginner' }
    ],
    'mid_dev': [
      { title: 'System Architecture', path: '/docs/system-architecture/design', complexity: 'intermediate' },
      { title: 'API Specification', path: '/docs/api-specification', complexity: 'intermediate' },
      { title: 'Integration Testing', path: '/docs/testing/integration-testing', complexity: 'intermediate' }
    ],
    'senior_dev': [
      { title: 'System Architecture Design', path: '/docs/system-architecture/design', complexity: 'advanced' },
      { title: 'API Design Principles', path: '/docs/api-specification/design-api-intro', complexity: 'advanced' },
      { title: 'Acceptance Testing', path: '/docs/testing/acceptence-testing', complexity: 'advanced' }
    ],
    'manager': [
      { title: 'System Overview', path: '/docs/requirements/system-overview', complexity: 'intermediate' },
      { title: 'Use Case Descriptions', path: '/docs/requirements/use-case-descriptions', complexity: 'intermediate' },
      { title: 'Features and Requirements', path: '/docs/requirements/features-and-requirements', complexity: 'intermediate' }
    ],
    'designer': [
      { title: 'System Block Diagram', path: '/docs/requirements/system-block-diagram', complexity: 'beginner' },
      { title: 'Use Case Descriptions', path: '/docs/requirements/use-case-descriptions', complexity: 'intermediate' }
    ]
  };

  // Get recommendations for role
  const roleRecs = roleMapping[userInfo.role] || roleMapping['junior_dev'];

  // Filter by preferred complexity if specified
  const complexity = userInfo.preferred_content_complexity;
  if (complexity) {
    return roleRecs.filter(rec => rec.complexity === complexity || rec.complexity === 'intermediate');
  }

  return roleRecs;
}

// Initialize database and start  server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  if (db) {
    saveDatabase();
  }
  process.exit(0);
});

module.exports = {app, db, getOne, getAll, runQuery, initDatabase};
