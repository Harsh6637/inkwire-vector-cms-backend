import { Pool } from 'pg';
import dns from 'dns/promises';

// Assert DATABASE_URL exists
if (!process.env.DATABASE_URL) throw new Error('❌ DATABASE_URL not set');
const connectionString = process.env.DATABASE_URL!;

declare global {
  var pgPool: Pool | undefined;
}

async function createPool(): Promise<Pool> {
  const hostMatch = connectionString.match(/@(.+?):/);
  const host = hostMatch ? hostMatch[1] : null;

  let connString = connectionString;

  if (host) {
    try {
      const addresses = await dns.lookup(host, { family: 4 }); // force IPv4
      connString = connectionString.replace(host, addresses.address);
      console.log('Resolved IPv4 address for Postgres:', addresses.address);
    } catch (err) {
      console.warn('IPv4 lookup failed, using hostname:', err);
    }
  }

  return new Pool({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

// Reuse pool globally
export const getPool = async (): Promise<Pool> => {
  if (!global.pgPool) {
    console.log('🟢 Initializing new Postgres pool...');
    global.pgPool = await createPool();
  } else {
    console.log('♻️ Reusing existing Postgres pool');
  }
  return global.pgPool;
};

// Simple query wrapper
export const query = async (text: string, params?: any[]) => {
  const pool = await getPool();
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err: any) {
    console.error('🔥 Query error:', err.message);
    throw err;
  }
};

export default { query };
