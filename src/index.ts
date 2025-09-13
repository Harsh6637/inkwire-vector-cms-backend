import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import serverless from 'serverless-http';
import db from './lib/db';
import authRoutes from './routes/auth';
import resourceRoutes from './routes/resources';
import searchRoutes from './routes/search';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',  // localhost development
    'http://127.0.0.1:3000',
    'https://inkwire-vector-cms.vercel.app' //Vercel deployment
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    fieldSize: 10 * 1024 * 1024  // 10MB field size limit
  }
});

const API_VERSION = '/api/v1';

app.get('/', (req: Request, res: Response) => {
  res.send('Inkwire Backend is running!');
});

// API routes
app.use(`${API_VERSION}/auth`, authRoutes);
app.use(`${API_VERSION}/resources`, upload.none(), resourceRoutes);
app.use(`${API_VERSION}/search`, searchRoutes);

// Health check route
app.get(`${API_VERSION}/health`, (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend is running!' });
});

// Database check route, Only for the testing purposes
app.get(`${API_VERSION}/db-check`, async (req: Request, res: Response) => {
  try {
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
        tables_present: tableCheck.rows.map(r => r.table_name),
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

// Local development server
const PORT = process.env.PORT;

// Only start the server when running locally
if (require.main === module || process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running locally at http://localhost:${PORT}`);
  });
}

export default app;

// Serverless handler for Vercel
export const handler = serverless(app);