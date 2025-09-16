// searchController.ts
import { Request, Response } from 'express';
import { embedQuery, vectorSearch, keywordSearch } from '../utils/chunkEmbed';
import db from '../lib/db';

// Search within a specific resource
export const searchResource = async (req: Request, res: Response) => {
try {
const { query, resourceId } = req.body;
if (!query || !resourceId) {
      return res.status(400).json({ status: 'error', message: 'Query and resourceId are required' });
    }
    const results = await vectorSearch(query, { resourceIds: [resourceId] });
    res.json({ status: 'success', query, results });
  } catch (err: any) {
    console.error('Error in searchResource:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Search across all resources (flat list)
export const searchAllResources = async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ status: 'error', message: 'Query is required' });
    }
    const results = await vectorSearch(query);
    res.json({ status: 'success', query, results });
  } catch (err: any) {
    console.error('Error in searchAllResources:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Search across all resources and group by document
export const searchAllResourcesGrouped = async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    console.log('=== SEARCH ALL RESOURCES GROUPED FUNCTION CALLED ===');
    console.log(`🔍 Query received: "${query}"`);

    if (!query || query.trim().length === 0) {
      console.log('❌ Empty query received');
      return res.status(400).json({ status: 'error', message: 'Query is required' });
    }

    let rawResults;
    // New logic: Prioritize keyword search
    const keywordResults = await keywordSearch(query);

    if (keywordResults.length > 0) {
      console.log('✅ Keyword search returned results. Prioritizing these.');
      rawResults = keywordResults;
    } else {
      console.log('⚠️ No keyword results found. Falling back to hybrid (vector) search.');
      // Fallback to the original hybrid search
      rawResults = await vectorSearch(query);
    }

    console.log(`✅ Raw search returned ${rawResults.length} rows`);

    const groupedResults = rawResults.reduce((acc: any, row: any) => {
      const resourceId = row.resource_id;

      if (!acc[resourceId]) {
        acc[resourceId] = {
          resource_id: resourceId,
          resource_title: row.resource_title,
          resource_type: row.resource_metadata?.type || 'document',
          resource_created_at: row.resource_created_at,
          max_score: 0,
          chunk_count: 0,
          chunks: []
        };
      }

      console.log(`Debug: Processing chunk for resourceId: ${resourceId}`);
      console.log(`Debug: Current row.final_score: ${row.final_score}`);
      console.log(`Debug: Current acc[${resourceId}].max_score before update: ${acc[resourceId].max_score}`);

      acc[resourceId].chunks.push({
        id: row.chunk_id,
        text: row.text,
        score: row.final_score,
        preview: row.preview
      });

      acc[resourceId].chunk_count++;
      acc[resourceId].max_score = Math.max(acc[resourceId].max_score, row.final_score);

      console.log(`Debug: New acc[${resourceId}].max_score after update: ${acc[resourceId].max_score}`);

      return acc;
    }, {});

    const documents = Object.values(groupedResults)
  .sort((a: any, b: any) => {
    // Primary sort: by max_score (descending)
    if (a.max_score !== b.max_score) {
      return b.max_score - a.max_score;
    }
    // Secondary sort: by chunk_count (descending) - more matching sections first
    return b.chunk_count - a.chunk_count;
  });

    console.log(`📊 Final result: ${rawResults.length} chunks across ${documents.length} documents`);
    console.log('=== END SEARCH ALL RESOURCES GROUPED ===');

    res.json({
      status: 'success',
      query,
      documents,
      total_chunks: rawResults.length,
      total_documents: documents.length
    });

  } catch (err: any) {
    console.error('❌ Search error in searchAllResourcesGrouped:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Get content of a single document
export const getDocumentContent = async (req: Request, res: Response) => {
  try {
    const { resourceId } = req.params;
    if (!resourceId) {
      return res.status(400).json({ status: 'error', message: 'resourceId is required' });
    }
    const result = await db.query('SELECT text FROM chunks WHERE resource_id = $1 ORDER BY position', [resourceId]);
    const content = result.rows.map((row: { text: string }) => row.text).join('\n\n');
    res.json({ status: 'success', content });
  } catch (err: any) {
    console.error('Error in getDocumentContent:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};