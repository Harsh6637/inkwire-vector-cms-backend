import { Request, Response } from 'express';
import db from '../lib/db';
import { processTextAndInsertChunks, deleteResourceChunks } from '../utils/chunkEmbed';

export const createResource = async (req: Request, res: Response) => {
try {
const { name, text } = req.body;

let metadata = {};
try {
metadata = typeof req.body.metadata === 'string'
? JSON.parse(req.body.metadata)
        : req.body.metadata || {};
    } catch (parseError) {
      console.error('Error parsing metadata:', parseError);
      metadata = {};
    }

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
    }

    const user = (req as any).user;

    // Insert the resource first
    const resourceResult = await db.query(
      'INSERT INTO resources (name, metadata, text_content, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [name.trim(), metadata, text || '', user.id]
    );

    const resourceId = resourceResult.rows[0].id;

    // Process with raw data extraction
    const { processResourceWithRawData } = require('../utils/rawDataProcessor');

    try {
      await processResourceWithRawData(resourceId, text, metadata);
      console.log(`Successfully processed resource ${resourceId}`);
    } catch (chunkError) {
      console.error(`Processing failed for resource ${resourceId}:`, chunkError);
      // Don't fail the entire request if processing fails
    }

    res.status(201).json({
      message: 'Resource created successfully',
      resourceId: resourceId
    });

  } catch (err: any) {
    console.error('Error creating resource:', err);
    res.status(500).json({
      message: 'Failed to create resource: ' + (err.message || 'Unknown error')
    });
  }
};

export const getResources = async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT
        id,
        name,
        metadata,
        text_content as content,
        created_at
      FROM resources
      ORDER BY created_at DESC
    `);

    const transformedResults = result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      metadata: row.metadata,
      content: row.content,
      rawData: row.metadata?.rawData,
      created_at: row.created_at
    }));

    res.json(transformedResults);
  } catch (err: any) {
    console.error('Error fetching resources:', err);
    res.status(500).json({
      message: 'Failed to fetch resources: ' + (err.message || 'Unknown error')
    });
  }
};

export const deleteResource = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid resource ID' });
    }

    // First, delete associated chunks
    try {
      await deleteResourceChunks(parseInt(id));
      console.log(`Deleted chunks for resource ${id}`);
    } catch (chunkError) {
      console.error(`Error deleting chunks for resource ${id}:`, chunkError);
      // Continue with resource deletion even if chunk deletion fails
    }

    // Then delete the resource
    const result = await db.query('DELETE FROM resources WHERE id = $1 RETURNING id, name', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    const deletedResource = result.rows[0];
    res.json({
      message: 'Resource deleted successfully',
      deletedResource: {
        id: deletedResource.id,
        name: deletedResource.name
      }
    });

  } catch (err: any) {
    console.error('Error deleting resource:', err);
    res.status(500).json({
      message: 'Failed to delete resource: ' + (err.message || 'Unknown error')
    });
  }
};

export const getResource = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid resource ID' });
    }

    const result = await db.query(
      'SELECT id, name, metadata, text_content as content, created_at FROM resources WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    // Transform result for frontend compatibility
    const resource = result.rows[0];
    const transformedResult = {
      id: resource.id,
      name: resource.name,
      metadata: resource.metadata,
      content: resource.content,
      rawData: resource.metadata?.rawData,
      created_at: resource.created_at
    };

    res.json(transformedResult);

  } catch (err: any) {
    console.error('Error fetching resource:', err);
    res.status(500).json({
      message: 'Failed to fetch resource: ' + (err.message || 'Unknown error')
    });
  }
};