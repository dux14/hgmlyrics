const { createClient } = require('@libsql/client');
const path = require('path');

// In production, connect to Turso cloud.
// In development, use the local sqlite.db file.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.resolve(__dirname, 'sqlite.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/**
 * Initialize the database schema
 */
async function initDB() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      albumSlug TEXT,
      year INTEGER,
      genre TEXT,
      voiceType TEXT,
      voicePercentMale INTEGER,
      voicePercentFemale INTEGER,
      coverImage TEXT,
      sections TEXT,
      albumOrder INTEGER DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
}

initDB().catch((err) => console.error('Error initializing database:', err));

/**
 * Execute a write query (INSERT, UPDATE, DELETE)
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<import('@libsql/client').ResultSet>}
 */
const run = async (sql, params = []) => {
  return client.execute({ sql, args: params });
};

/**
 * Execute a read query and return all rows
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<Array<object>>}
 */
const all = async (sql, params = []) => {
  const result = await client.execute({ sql, args: params });
  return result.rows;
};

/**
 * Execute a read query and return the first row
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<object|null>}
 */
const get = async (sql, params = []) => {
  const result = await client.execute({ sql, args: params });
  return result.rows[0] || null;
};

module.exports = { client, run, all, get };
