import pkg from 'pg';
const { Pool } = pkg;

declare global {
    var pgPool: any;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set in environment');

const pool = globalThis.pgPool ?? new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // required for Supabase
});

// Save instance to globalThis so serverless reuses it
if (!globalThis.pgPool) globalThis.pgPool = pool;

export default {
  query: (text: string, params?: any[]) => pool.query(text, params),
};
