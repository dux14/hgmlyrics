// Runs BEFORE any test file imports the app.
// Sets env vars so server/index.js boot validation passes and db.js
// uses an in-memory SQLite instead of touching the filesystem.

process.env.ADMIN_PIN = 'test-pin-1234';
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
process.env.DB_URL = ':memory:';
process.env.NODE_ENV = 'test';
// Ensure no Turso embedded mode kicks in.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
