import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

// Singleton at module scope. Fluid Compute reuses function instances,
// so this connection persists across warm invocations.
// `prepare: false` is mandatory for the Supabase transaction pooler (port 6543).
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 1,
  prepare: false,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
});

export default sql;
