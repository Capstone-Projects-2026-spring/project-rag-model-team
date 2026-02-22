#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting RAG Bot System...\n');

// Check if .env exists in backend
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('⚠️  No .env file found. Creating from template...');
  fs.copyFileSync(path.join(__dirname, '.env.example'), envPath);
  console.log('✓ Created .env file. Please update with your settings.\n');
}

// Check if database exists
const dbPath = path.join(__dirname, 'database', 'users.db');
if (!fs.existsSync(dbPath)) {
  console.log('📦 Initializing database...');
  try {
    execSync('npm run init-db', { stdio: 'inherit' });
    console.log('✓ Database initialized successfully\n');
  } catch (error) {
    console.error('❌ Failed to initialize database');
    process.exit(1);
  }
}

// Start the server
console.log('🔄 Starting backend server...\n');
try {
  execSync('npm start', { stdio: 'inherit' });
} catch (error) {
  console.error('❌ Failed to start server');
  process.exit(1);
}
