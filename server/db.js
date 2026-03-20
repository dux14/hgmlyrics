const { createClient } = require('@libsql/client');
const path = require('path');

// Embedded Replica mode:
// - In production: local replica file syncs with Turso cloud.
//   Reads are instant (local file), writes go to remote then sync back.
// - In development: uses local sqlite.db directly (no remote).
const isProduction = !!process.env.TURSO_DATABASE_URL;

const client = isProduction
  ? createClient({
      url: `file:${path.resolve(__dirname, 'local-replica.db')}`,
      syncUrl: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      syncInterval: 60, // auto-sync every 60 seconds
    })
  : createClient({
      url: `file:${path.resolve(__dirname, 'sqlite.db')}`,
    });

/**
 * Initialize the database: sync replica + create schema
 */
async function initDB() {
  // Sync the replica on startup so data is available immediately
  if (isProduction) {
    await client.sync();
    console.log('✅ Turso replica synced.');
  }

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

const dbReady = initDB().catch((err) => console.error('Error initializing database:', err));

/**
 * Execute a write query (INSERT, UPDATE, DELETE)
 * Syncs the replica after write operations in production.
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<import('@libsql/client').ResultSet>}
 */
const run = async (sql, params = []) => {
  await dbReady;
  const result = await client.execute({ sql, args: params });
  // Sync after writes so the local replica has the latest data
  if (isProduction) {
    client.sync().catch(() => {});
  }
  return result;
};

/**
 * Execute a read query and return all rows
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<Array<object>>}
 */
const all = async (sql, params = []) => {
  await dbReady;
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
  await dbReady;
  const result = await client.execute({ sql, args: params });
  return result.rows[0] || null;
};

module.exports = { client, run, all, get };
