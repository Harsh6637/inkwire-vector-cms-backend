import { Request, Response } from 'express';
import db from '../lib/db';
import { deleteResourceChunks } from '../utils/chunkEmbed';
import { processResourceChunksAsync } from '../services/chunkProcessor';

export const createResource = async (req: Request, res: Response) => {
  try {
    const { name, text, publishers, description } = req.body;

    let metadata = {};
    try {
      metadata = typeof req.body.metadata === 'string'
        ? JSON.parse(req.body.metadata)
        : req.body.metadata || {};
    } catch (parseError) {
      console.error('Error parsing metadata:', parseError);
      metadata = {};
    }

    // Mark as pending for processing
    (metadata as any).processingStatus = 'pending';

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
    }

    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({ message: 'Description is required and must be a non-empty string' });
    }

    // Validate publishers array
    let publishersArray: string[] = [];
    if (publishers) {
      if (typeof publishers === 'string') {
        try {
          publishersArray = JSON.parse(publishers);
        } catch {
          publishersArray = publishers.split(',').map((p: string) => p.trim()).filter(Boolean);
        }
      } else if (Array.isArray(publishers)) {
        publishersArray = publishers.filter((p: any) => typeof p === 'string' && p.trim() !== '');
      }
    }

    if (publishersArray.length === 0) {
      return res.status(400).json({ message: 'At least one publisher is required' });
    }

    // Validate tags (from metadata)
    const tags = (metadata as any)?.tags || [];
    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ message: 'At least one tag is required' });
    }

    const user = (req as any).user;

    // Insert resource WITHOUT processing chunks
    const resourceResult = await db.query(
      `INSERT INTO resources (name, metadata, text_content, user_id, publishers, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name.trim(), metadata, text || '', user.id, publishersArray, description.trim()]
    );

    const resourceId = resourceResult.rows[0].id;
    console.log(`[DEBUG] Triggering async chunk processing for resource ${resourceId}`);
    processResourceChunksAsync(resourceId); // runs in background

    // Return immediately - NO chunk processing here
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
        r.id,
        r.name,
        r.metadata,
        r.text_content as content,
        r.publishers,
        r.description,
        r.created_at,
        (SELECT COUNT(*) FROM chunks c WHERE c.resource_id = r.id) as chunk_count
      FROM resources r
      ORDER BY r.created_at DESC
    `);

    const transformedResults = result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      metadata: row.metadata,
      content: row.content,
      rawData: row.metadata?.rawData,
      tags: row.metadata?.tags || [],
      publishers: row.publishers || [],
      description: row.description || '',
      created_at: row.created_at,
      processingStatus: row.metadata?.processingStatus || 'pending',
      chunkCount: parseInt(row.chunk_count)
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

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid resource ID' });
    }

    // Delete associated chunks first
    try {
      await deleteResourceChunks(parseInt(id));
      console.log(`Deleted chunks for resource ${id}`);
    } catch (chunkError) {
      console.error(`Error deleting chunks for resource ${id}:`, chunkError);
    }

    // Delete the resource
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
      'SELECT id, name, metadata, text_content as content, publishers, description, created_at FROM resources WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    const resource = result.rows[0];
    const transformedResult = {
      id: resource.id,
      name: resource.name,
      metadata: resource.metadata,
      content: resource.content,
      rawData: resource.metadata?.rawData,
      tags: resource.metadata?.tags || [],
      publishers: resource.publishers || [],
      description: resource.description || '',
      created_at: resource.created_at,
      processingStatus: resource.metadata?.processingStatus || 'pending'
    };

    res.json(transformedResult);

  } catch (err: any) {
    console.error('Error fetching resource:', err);
    res.status(500).json({
      message: 'Failed to fetch resource: ' + (err.message || 'Unknown error')
    });
  }
};

// Advanced search function utilizing the hybrid approach
export const searchResources = async (req: Request, res: Response) => {
  try {
    const { query, publishers, tags, description } = req.query;

    let sqlQuery = `
      SELECT id, name, metadata, publishers, description, created_at
      FROM resources
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    // Search by publisher (using dedicated column)
    if (publishers && Array.isArray(publishers) && publishers.length > 0) {
      paramCount++;
      sqlQuery += ` AND publishers && $${paramCount}`;
      params.push(publishers);
    }

    // Search by description (using dedicated column with full-text search)
    if (description && typeof description === 'string') {
      paramCount++;
      sqlQuery += ` AND description @@ plainto_tsquery('english', $${paramCount})`;
      params.push(description);
    }

    // Search by tags (using metadata JSON)
    if (tags && Array.isArray(tags) && tags.length > 0) {
      paramCount++;
      sqlQuery += ` AND metadata->'tags' ?| array[$${paramCount}]`;
      params.push(tags);
    }

    // General text search across name and description
    if (query && typeof query === 'string') {
      paramCount++;
      sqlQuery += ` AND (name ILIKE $${paramCount} OR description @@ plainto_tsquery('english', $${paramCount + 1}))`;
      params.push(`%${query}%`, query);
      paramCount++;
    }

    sqlQuery += ' ORDER BY created_at DESC';

    const result = await db.query(sqlQuery, params);
    res.json(result.rows);

  } catch (err: any) {
    console.error('Error searching resources:', err);
    res.status(500).json({
      message: 'Failed to search resources: ' + (err.message || 'Unknown error')
    });
  }
};