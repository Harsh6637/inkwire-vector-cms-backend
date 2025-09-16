console.log('Starting server...');
import 'dotenv/config';
console.log('Environment loaded');
import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import serverless from 'serverless-http';

// Add process error handlers FIRST
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise, 'reason:', reason);
  console.error('Stack trace:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  console.error('Stack trace:', error.stack);
});

try {
  console.log('Importing database...');
  const db = require('./lib/db').default;
  console.log('✅ Database imported successfully');
} catch (dbError) {
  console.error('❌ Database import failed:', dbError);
}

try {
  console.log('Importing auth routes...');
  const authRoutes = require('./routes/auth').default;
  console.log('✅ Auth routes imported');
} catch (authError) {
  console.error('❌ Auth routes import failed:', authError);
}

try {
  console.log('Importing resource routes...');
  const resourceRoutes = require('./routes/resources').default;
  console.log('✅ Resource routes imported');
} catch (resourceError) {
  console.error('❌ Resource routes import failed:', resourceError);
}

try {
  console.log('Importing search routes...');
  const searchRoutes = require('./routes/search').default;
  console.log('✅ Search routes imported');
} catch (searchError) {
  console.error('❌ Search routes import failed:', searchError);
  console.error('This is likely the culprit!');
}

const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000', //localhost
    'http://127.0.0.1:3000',
    'https://inkwire-vector-cms.vercel.app' // Vercel frontend
  ],

  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    fieldSize: 10 * 1024 * 1024
  }
});

const API_VERSION = '/api/v1';

// HomePage
app.get('/', (req: Request, res: Response) => {
  res.send('Inkwire Vector CMS Backend is running!');
});

console.log('Setting up routes...');

// API routes - with try/catch
try {
  const authRoutes = require('./routes/auth').default;
  app.use(`${API_VERSION}/auth`, authRoutes);
  console.log('✅ Auth routes registered');
} catch (e) {
  console.error('❌ Failed to register auth routes:', e);
}

try {
  const resourceRoutes = require('./routes/resources').default;
  app.use(`${API_VERSION}/resources`, upload.none(), resourceRoutes);
  console.log('✅ Resource routes registered');
} catch (e) {
  console.error('❌ Failed to register resource routes:', e);
}

try {
  const searchRoutes = require('./routes/search').default;
  app.use(`${API_VERSION}/search`, searchRoutes);
  console.log('✅ Search routes registered');
} catch (e) {
  console.error('❌ Failed to register search routes:', e);
}

// Health check
app.get(`${API_VERSION}/health`, (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend is running!' });
});

// Database check route (testing only)
app.get(`${API_VERSION}/db-check`, async (req: Request, res: Response) => {
  try {
    const db = require('./lib/db').default;
    const extCheck = await db.query(`SELECT extname FROM pg_extension WHERE extname = 'vector';`);
    const tableCheck = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('users', 'resources', 'chunks');
    `);

    res.json({
      status: 'ok',
      db_check: {
        pgvector_installed: extCheck.rows.length > 0,
        tables_present: tableCheck.rows.map((r: any) => r.table_name),
      },
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        status: 'error',
        message: 'File too large. Maximum size is 10MB.'
      });
    }
    return res.status(400).json({
      status: 'error',
      message: `Upload error: ${err.message}`
    });
  }

  res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler for unmatched routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`
  });
});

// LOCAL SERVER START ONLY
if (require.main === module) {
  const PORT = process.env.PORT || 3001;

  console.log('Starting server listener...');

  app.listen(PORT, () => {
    console.log(`✅ Server running locally at http://localhost:${PORT}`);
  }).on('error', (error) => {
    console.error('❌ Server failed to start:', error);
  });
}

console.log('✅ Index.ts execution completed');

// SERVERLESS HANDLER FOR VERCEL
export const handler = serverless(app);
export default app;