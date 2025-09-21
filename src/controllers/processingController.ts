import { Request, Response } from 'express';
import db from '../lib/db';
import { processResourceChunksAsync } from '../services/chunkProcessor';

// Process chunks for a specific resource
export const processChunks = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if resource exists
    const result = await db.query(
      'SELECT id, metadata FROM resources WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    const resource = result.rows[0];

    // Check current status
    if (resource.metadata?.processingStatus === 'processing') {
      return res.json({
        message: 'Already processing',
        status: 'processing'
      });
    }

    if (resource.metadata?.processingStatus === 'completed') {
      return res.json({
        message: 'Already processed',
        status: 'completed'
      });
    }

    // Update status to processing
    await db.query(
      `UPDATE resources
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}')::jsonb,
         '{processingStatus}',
         '"processing"'
       )
       WHERE id = $1`,
      [id]
    );

    // Start processing asynchronously
    processResourceChunksAsync(parseInt(id));

    res.json({
      message: 'Processing started',
      status: 'processing'
    });

  } catch (error: any) {
    console.error('Error starting chunk processing:', error);
    res.status(500).json({
      message: 'Failed to start processing',
      error: error.message
    });
  }
};

// Process all pending resources
export const processAllPending = async (req: Request, res: Response) => {
  try {
    // Find all resources without chunks
    const pendingResult = await db.query(
      `SELECT id FROM resources
       WHERE metadata->>'processingStatus' IS NULL
       OR metadata->>'processingStatus' = 'pending'
       OR metadata->>'processingStatus' = 'failed'`
    );

    if (pendingResult.rows.length === 0) {
      return res.json({
        message: 'No pending resources',
        processed: 0
      });
    }

    // Start processing each resource
    for (const row of pendingResult.rows) {
      await db.query(
        `UPDATE resources
         SET metadata = jsonb_set(
           COALESCE(metadata, '{}')::jsonb,
           '{processingStatus}',
           '"processing"'
         )
         WHERE id = $1`,
        [row.id]
      );

      processResourceChunksAsync(row.id);
    }

    res.json({
      message: `Started processing ${pendingResult.rows.length} resources`,
      processed: pendingResult.rows.length
    });

  } catch (error: any) {
    console.error('Error processing pending resources:', error);
    res.status(500).json({
      message: 'Failed to process pending resources',
      error: error.message
    });
  }
};

// Get processing status
export const getProcessingStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT
        name,
        metadata->>'processingStatus' as status,
        (SELECT COUNT(*) FROM chunks WHERE resource_id = $1) as chunk_count
       FROM resources
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    const {name, status, chunk_count } = result.rows[0];

    res.json({
        resourceId: id,
        resourceName: name,
        status: status || 'pending',
        chunkCount: parseInt(chunk_count),
        ready: status === 'completed' && parseInt(chunk_count) > 0
    });

  } catch (error: any) {
    console.error('Error getting status:', error);
    res.status(500).json({
      message: 'Failed to get status',
      error: error.message
    });
  }
};