import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('❌ DATABASE_URL not set in environment');

declare global {
  // Allow global reuse in serverless
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

if (!global.pgPool) {
  console.log("🟢 Initializing new Postgres pool...");
  global.pgPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  });
} else {
  console.log("♻️ Reusing existing Postgres pool");
}

const pool = global.pgPool;

export const query = async (text: string, params?: any[]) => {
  console.log("🔍 Running query:", text, params ?? []);
  try {
    const result = await pool!.query(text, params);
    console.log("✅ Query success, rows:", result.rowCount);
    return result;
  } catch (err: any) {
    console.error("🔥 Query error:", err.message);
    throw err;
  }
};

export default {
  query,
};
