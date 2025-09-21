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

// Enhanced search across all resources with proper scoring
export const searchAllResourcesGrouped = async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    console.log('=== SEARCH ALL RESOURCES GROUPED FUNCTION CALLED ===');
    console.log(`🔍 Query received: "${query}"`);

    // FIX: Check for empty or whitespace-only queries
    if (!query || query.trim().length === 0) {
      console.log('❌ Empty or whitespace-only query received');
      return res.status(400).json({ status: 'error', message: 'Query cannot be empty' });
    }

    const trimmedQuery = query.trim();

    // Get ALL results - both keyword and vector
    console.log('🔎 Performing comprehensive search...');

    // 1. Get keyword search results with trimmed query
    const keywordResults = await keywordSearch(trimmedQuery, 50);
    console.log(`📝 Keyword search returned ${keywordResults.length} results`);

    // 2. Get vector search results with trimmed query
    const vectorResults = await vectorSearch(trimmedQuery, { limit: 50 });
    console.log(`🧮 Vector search returned ${vectorResults.length} results`);

    // 3. Combine and deduplicate results
    const resultMap = new Map();

    // Add keyword results with adjusted scoring
    keywordResults.forEach(row => {
      const key = `${row.resource_id}-${row.chunk_id}`;
      if (!resultMap.has(key)) {
        const adjustedScore = calculateKeywordScore(row, trimmedQuery);
        resultMap.set(key, {
          ...row,
          final_score: adjustedScore,
          match_type: 'keyword'
        });
      }
    });

    // Add vector results, combining scores if already exists
    vectorResults.forEach(row => {
      const key = `${row.resource_id}-${row.chunk_id}`;
      if (resultMap.has(key)) {
        const existing = resultMap.get(key);
        const combinedScore = Math.min(1.0, (existing.final_score * 0.6) + (row.final_score * 0.4));
        resultMap.set(key, {
          ...row,
          final_score: combinedScore,
          match_type: 'hybrid'
        });
      } else {
        resultMap.set(key, {
          ...row,
          match_type: 'vector'
        });
      }
    });

    // Convert to array
    const allResults = Array.from(resultMap.values());
    console.log(`✅ Combined search returned ${allResults.length} unique chunks`);

    // Group by document with proper scoring and better deduplication
    const groupedResults = allResults.reduce((acc: any, row: any) => {
      const resourceId = row.resource_id;

      if (!acc[resourceId]) {
        const metadataScore = calculateMetadataScore(row, trimmedQuery);

        acc[resourceId] = {
          resource_id: resourceId,
          resource_title: row.resource_title,
          resource_type: row.resource_metadata?.type || 'document',
          resource_created_at: row.resource_created_at,
          resource_metadata: row.resource_metadata,
          publishers: row.resource_metadata?.publishers || [],
          description: row.resource_metadata?.description || '',
          max_score: metadataScore,
          metadata_match_score: metadataScore,
          chunk_count: 0,
          chunks: [],
          processedChunkIds: new Set() // Track processed chunk IDs
        };
      }

      // FIX: Better deduplication using Set
      const chunkId = row.chunk_id;

      // Only process if we haven't seen this chunk ID
      if (!acc[resourceId].processedChunkIds.has(chunkId)) {
        acc[resourceId].processedChunkIds.add(chunkId);

        const chunkPreview = highlightMatchedText(row.text, trimmedQuery);

        // Check if preview is just metadata (skip if so)
        const isMetadataOnly = chunkPreview.startsWith('Document:') ||
                               chunkPreview.startsWith('Title:') ||
                               chunkPreview.startsWith('Description:') ||
                               chunkPreview.startsWith('Keywords:');

        // Only add meaningful chunks
        if (!isMetadataOnly || acc[resourceId].chunks.length === 0) {
          // Check for similar existing preview
          const similarExists = acc[resourceId].chunks.some((c: any) => {
            const similarity = calculateSimpleSimilarity(c.preview, chunkPreview);
            return similarity > 0.85; // 85% similar threshold
          });

          if (!similarExists) {
            acc[resourceId].chunks.push({
              id: chunkId,
              text: row.text,
              score: row.final_score,
              preview: chunkPreview,
              match_type: row.match_type,
              position: row.position || 0
            });
            acc[resourceId].chunk_count++;
          }
        }
      }

      // Update max score
      const chunkScore = row.final_score;
      const combinedScore = acc[resourceId].metadata_match_score > 0
        ? Math.min(1.0, (acc[resourceId].metadata_match_score * 0.3) + (chunkScore * 0.7))
        : chunkScore;

      acc[resourceId].max_score = Math.max(acc[resourceId].max_score, combinedScore);

      return acc;
    }, {});

    // Convert to array and clean up
    const documents = Object.values(groupedResults).map((doc: any) => {
      // Remove the tracking Set before sending
      delete doc.processedChunkIds;

      // Sort chunks by score and position
      doc.chunks.sort((a: any, b: any) => {
        if (Math.abs(a.score - b.score) > 0.01) {
          return b.score - a.score;
        }
        return a.position - b.position;
      });
      return doc;
    });

    // Sort documents by relevance
    documents.sort((a: any, b: any) => {
      if (Math.abs(a.max_score - b.max_score) > 0.01) {
        return b.max_score - a.max_score;
      }
      return b.chunk_count - a.chunk_count;
    });

    console.log(`📊 Final result: ${allResults.length} chunks across ${documents.length} documents`);
    console.log('=== END SEARCH ALL RESOURCES GROUPED ===');

    res.json({
      status: 'success',
      query: trimmedQuery,
      documents,
      total_chunks: allResults.length,
      total_documents: documents.length
    });

  } catch (err: any) {
    console.error('❌ Search error in searchAllResourcesGrouped:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// Simple similarity calculation for deduplication
function calculateSimpleSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;

  // Remove highlight markers and normalize
  const clean1 = text1.replace(/\*\*/g, '').toLowerCase().trim();
  const clean2 = text2.replace(/\*\*/g, '').toLowerCase().trim();

  if (clean1 === clean2) return 1.0;
  if (clean1.length === 0 || clean2.length === 0) return 0;

  // Check if one contains the other
  if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.9;

  // Simple overlap check
  const words1 = clean1.split(/\s+/);
  const words2 = clean2.split(/\s+/);
  const set1 = new Set(words1);
  const set2 = new Set(words2);

  let overlap = 0;
  set1.forEach(word => {
    if (set2.has(word)) overlap++;
  });

  const similarity = (overlap * 2) / (set1.size + set2.size);
  return similarity;
}

// Calculate score based on where keyword match occurs
function calculateKeywordScore(row: any, query: string): number {
  const queryLower = query.toLowerCase();
  const title = row.resource_title?.toLowerCase() || '';
  const description = row.resource_metadata?.description?.toLowerCase() || '';
  const publishers = (row.resource_metadata?.publishers || []).join(' ').toLowerCase();
  const tags = (row.resource_metadata?.tags || []).join(' ').toLowerCase();
  const text = row.text?.toLowerCase() || '';

  let score = 0;

  if (title.includes(queryLower)) {
    score = Math.max(score, 0.95);
  }
  if (publishers.includes(queryLower)) {
    score = Math.max(score, 0.85);
  }
  if (description.includes(queryLower)) {
    score = Math.max(score, 0.75);
  }
  if (tags.includes(queryLower)) {
    score = Math.max(score, 0.70);
  }
  if (text.includes(queryLower)) {
    const textScore = Math.min(0.65, row.text_rank || 0.5);
    score = Math.max(score, textScore);
  }

  return score;
}

// Calculate metadata-only score for document
function calculateMetadataScore(row: any, query: string): number {
  const queryLower = query.toLowerCase();
  const title = row.resource_title?.toLowerCase() || '';
  const description = row.resource_metadata?.description?.toLowerCase() || '';
  const publishers = (row.resource_metadata?.publishers || []).join(' ').toLowerCase();
  const tags = (row.resource_metadata?.tags || []).join(' ').toLowerCase();

  let score = 0;

  if (title.includes(queryLower)) {
    score = 0.95;
  } else if (publishers.includes(queryLower)) {
    score = 0.85;
  } else if (description.includes(queryLower)) {
    score = 0.75;
  } else if (tags.includes(queryLower)) {
    score = 0.70;
  }

  return score;
}

// Highlight matched text for display (strip metadata headers)
function highlightMatchedText(text: string, query: string): string {
  if (!text || !query) return '';

  // Remove metadata header if present
  let cleanText = text;

  // Check for common metadata patterns and skip them
  const lines = text.split('\n');
  let contentStartIndex = 0;

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i];
    if (line.startsWith('Document:') ||
        line.startsWith('Title:') ||
        line.startsWith('Description:') ||
        line.startsWith('Summary:') ||
        line.startsWith('Authors:') ||
        line.startsWith('Publishers:') ||
        line.startsWith('Keywords:') ||
        line === '---' ||
        line === '=== Content ===' ||
        line.trim() === '') {
      contentStartIndex = i + 1;
    } else {
      // Found actual content
      break;
    }
  }

  if (contentStartIndex > 0 && contentStartIndex < lines.length) {
    cleanText = lines.slice(contentStartIndex).join('\n').trim();
  }

  const queryLower = query.toLowerCase();
  const textLower = cleanText.toLowerCase();
  const index = textLower.indexOf(queryLower);

  if (index === -1) {
    // No direct match in content, return beginning
    return cleanText.substring(0, 200) + (cleanText.length > 200 ? '...' : '');
  }

  // Extract context around the match
  const contextBefore = 50;
  const contextAfter = 100;
  const start = Math.max(0, index - contextBefore);
  const end = Math.min(cleanText.length, index + query.length + contextAfter);

  let excerpt = cleanText.substring(start, end);

  // Add ellipsis if needed
  if (start > 0) excerpt = '...' + excerpt;
  if (end < cleanText.length) excerpt = excerpt + '...';

  // Highlight the matched text
  const matchStart = start > 0 ? 3 + (index - start) : index - start;
  const beforeMatch = excerpt.substring(0, matchStart);
  const match = excerpt.substring(matchStart, matchStart + query.length);
  const afterMatch = excerpt.substring(matchStart + query.length);

  return `${beforeMatch}**${match}**${afterMatch}`;
}

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