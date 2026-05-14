const { createClient } = require('@libsql/client');
const path = require('path');

// Client modes (resolved at module load):
// 1. DB_URL set        → use it directly (tests use ':memory:').
// 2. TURSO_DATABASE_URL → embedded replica mode (production).
// 3. fallback           → local sqlite.db (development).
const isTest = !!process.env.DB_URL;
const isProduction = !isTest && !!process.env.TURSO_DATABASE_URL;

const client = isTest
  ? createClient({ url: process.env.DB_URL })
  : isProduction
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
      updatedAt TEXT,
      cejilla INTEGER
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

/**
 * Drop and recreate the songs table. ONLY for tests with DB_URL=:memory:.
 * Throws if invoked in production.
 */
async function resetDb() {
  if (!process.env.DB_URL) {
    throw new Error('resetDb() only allowed when DB_URL is set (test mode)');
  }
  await dbReady;
  await client.execute('DROP TABLE IF EXISTS songs');
  await initDB();
}

module.exports = { client, run, all, get, resetDb };
