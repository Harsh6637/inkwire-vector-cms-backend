import db from '../lib/db';
import OpenAI from 'openai';
import { Request, Response } from 'express';

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not defined in environment');
  }
  return new OpenAI({ apiKey });
}

interface ChunkMetadata {
  position: number;
  section?: string;
  tokens: number;
}

interface SearchResult {
  chunk_id: number;
  resource_id: number;
  resource_title: string;
  resource_metadata: any;
  text: string;
  section_name?: string;
  similarity_score: number;
  text_rank: number;
  final_score: number;
  position: number;
  token_count: number;
  resource_created_at: Date;
  preview: string;
}

interface SearchOptions {
  limit?: number;
  similarityThreshold?: number;
  userId?: number;
  fileTypes?: string[];
  minScore?: number;
  resourceIds?: number[];
}

// Generic section header extraction
function extractSectionHeaders(text: string): string[] {
  const headerPatterns = [
    /^[A-Z][A-Z\s&\-]+$/gm, // ALL CAPS headers
    /^\d+\.\s+[A-Z][^.]*$/gm, // Numbered headers
    /^[A-Z][a-z\s]+:$/gm, // Title case with colon
    /^#{1,6}\s+.+$/gm, // Markdown headers
    /^\*{1,2}[A-Z][^*]*\*{1,2}$/gm, // Bold headers
  ];

  const headers: string[] = [];
  headerPatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      headers.push(...matches.map(h => h.trim().replace(/[#*_:]/g, '').trim()));
    }
  });

  return [...new Set(headers)].filter(h => h.length > 2 && h.length < 100);
}

// Enhanced chunking that works with your existing structure
export function chunkText(text: string, maxSize: number = 1200, overlap: number = 150): { text: string; metadata: ChunkMetadata }[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: { text: string; metadata: ChunkMetadata }[] = [];
  const headers = extractSectionHeaders(text);

  // Split by logical sections (double newlines)
  const sections = text.split(/\n\s*\n+/).filter(s => s.trim().length > 0);

  let currentSection = '';
  let position = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();

    // Check if this section is a header
    const isHeader = headers.some(h => section.includes(h));
    const sectionName = isHeader ? section : currentSection;

    if (isHeader) {
      currentSection = section;
      continue;
    }

    if (section.length <= maxSize) {
      chunks.push({
        text: section,
        metadata: {
          position: position++,
          section: sectionName,
          tokens: Math.ceil(section.length / 4)
        }
      });
    } else {
      const subChunks = splitLargeSection(section, maxSize, overlap, sectionName, position);
      chunks.push(...subChunks);
      position += subChunks.length;
    }
  }

  if (chunks.length === 0) {
    return fallbackChunking(text, maxSize, overlap);
  }

  return chunks;
}

function splitLargeSection(
  text: string,
  maxSize: number,
  overlap: number,
  sectionName: string,
  startPosition: number
): { text: string; metadata: ChunkMetadata }[] {
  const chunks: { text: string; metadata: ChunkMetadata }[] = [];
  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0);

  let currentChunk = '';
  let position = startPosition;

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 1 <= maxSize) {
      currentChunk += (currentChunk ? '\n' : '') + paragraph;
    } else {
      if (currentChunk) {
        chunks.push({
          text: currentChunk.trim(),
          metadata: {
            position: position++,
            section: sectionName,
            tokens: Math.ceil(currentChunk.length / 4)
          }
        });

        const sentences = currentChunk.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const overlapText = sentences.slice(-2).join('. ').trim();
        currentChunk = overlapText.length <= overlap ? overlapText + '\n' + paragraph : paragraph;
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      metadata: {
        position: position++,
        section: sectionName,
        tokens: Math.ceil(currentChunk.length / 4)
      }
    });
  }

  return chunks;
}

function fallbackChunking(text: string, maxSize: number, overlap: number): { text: string; metadata: ChunkMetadata }[] {
  const chunks: { text: string; metadata: ChunkMetadata }[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  let currentChunk = '';
  let position = 0;

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length <= maxSize) {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    } else {
      if (currentChunk) {
        chunks.push({
          text: currentChunk.trim(),
          metadata: {
            position: position++,
            tokens: Math.ceil(currentChunk.length / 4)
          }
        });

        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.ceil(overlap / 6));
        currentChunk = overlapWords.join(' ') + ' ' + sentence;
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      metadata: {
        position: position++,
        tokens: Math.ceil(currentChunk.length / 4)
      }
    });
  }

  return chunks;
}

// Enhanced processing that handles raw data extraction
export async function processTextAndInsertChunks(resourceId: number, text: string): Promise<void> {
  try {
    if (!text || text.trim().length === 0) {
      console.log(`No text content to process for resource ${resourceId}`);
      return;
    }

    console.log(`Processing text for resource ${resourceId}, length: ${text.length} characters`);

    const chunksWithMetadata = chunkText(text, 1200, 150);
    console.log(`Created ${chunksWithMetadata.length} chunks for resource ${resourceId}`);

    if (chunksWithMetadata.length === 0) {
      console.log(`No chunks created for resource ${resourceId}`);
      return;
    }

    const openai = getOpenAIClient();
    const embeddings: { text: string; embedding: number[]; metadata: ChunkMetadata }[] = [];

    const batchSize = 3;
    for (let i = 0; i < chunksWithMetadata.length; i += batchSize) {
      const batch = chunksWithMetadata.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunksWithMetadata.length / batchSize)} for resource ${resourceId}`);

      try {
        const batchEmbeddings = await Promise.all(
          batch.map(async (chunkData) => {
            const retryCount = 3;
            let lastError;

            for (let retry = 0; retry < retryCount; retry++) {
              try {
                const embeddingRes = await openai.embeddings.create({
                  model: 'text-embedding-3-large',
                  input: chunkData.text.trim(),
                  dimensions: 1536
                });

                return {
                  text: chunkData.text.trim(),
                  embedding: embeddingRes.data[0].embedding,
                  metadata: chunkData.metadata
                };
              } catch (error) {
                lastError = error;
                console.warn(`Retry ${retry + 1}/${retryCount} failed:`, error);

                if (retry < retryCount - 1) {
                  await new Promise(resolve => setTimeout(resolve, Math.pow(2, retry) * 1000));
                }
              }
            }

            throw lastError;
          })
        );

        embeddings.push(...batchEmbeddings);

        if (i + batchSize < chunksWithMetadata.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        console.error(`Error processing batch for resource ${resourceId}:`, error);
        throw error;
      }
    }

    console.log(`Inserting ${embeddings.length} embeddings for resource ${resourceId}`);

    const insertPromises = embeddings.map(async ({ text, embedding, metadata }) => {
      try {

console.log('Embedding type:', typeof embedding);
console.log('Is array:', Array.isArray(embedding));
console.log('First few values:', embedding.slice(0, 3));

       await db.query(
  'INSERT INTO chunks (resource_id, text, embedding, position, section_name, token_count) VALUES ($1, $2, $3::vector, $4, $5, $6)',
  [
    resourceId,
    text,
    JSON.stringify(embedding), // Force it as JSON string
    metadata.position,
    metadata.section || null,
    metadata.tokens
  ]
);
      } catch (dbError) {
        console.error(`Error inserting chunk for resource ${resourceId}:`, dbError);
        throw dbError;
      }
    });

    const insertBatchSize = 10;
    for (let i = 0; i < insertPromises.length; i += insertBatchSize) {
      const batch = insertPromises.slice(i, i + insertBatchSize);
      await Promise.all(batch);
    }

    console.log(`Successfully processed ALL ${embeddings.length} chunks for resource ${resourceId}`);

  } catch (error) {
    console.error(`Failed to process chunks for resource ${resourceId}:`, error);
    throw new Error(`Chunk processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Generate embedding for search queries
export async function embedQuery(query: string): Promise<number[]> {
  try {
    if (!query || query.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    console.log(`Generating embedding for query: "${query.substring(0, 50)}..."`);
    const openai = getOpenAIClient();

    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: query.trim(),
      dimensions: 1536
    });

    if (!embeddingRes.data || embeddingRes.data.length === 0) {
      throw new Error('No embedding data received from OpenAI');
    }

    return embeddingRes.data[0].embedding;

  } catch (error) {
    console.error('Error generating query embedding:', error);
    throw new Error(`Query embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// New function for exact keyword search
export async function keywordSearch(
  query: string,
  limit: number = 50, // Increased limit to get more results
  userId?: number
): Promise<SearchResult[]> {
  try {
    console.log(`🔍 Performing keyword search for: "${query}"`);

    // Search in both chunks AND resource metadata
    let queryParams: any[] = [query];
    let paramCount = 1;

    if (userId) {
      paramCount++;
      queryParams.push(userId);
    }

    queryParams.push(limit);
    const limitParam = `$${++paramCount}`;

    // Enhanced query to search in metadata as well
    const results = await db.query(
      `SELECT
        c.id as chunk_id,
        c.resource_id,
        c.text,
        c.position,
        c.section_name,
        c.token_count,
        r.name as resource_title,
        r.metadata as resource_metadata,
        r.publishers,
        r.description,
        r.created_at as resource_created_at,
        0.0 as similarity_score,
        ts_rank_cd(to_tsvector('english', c.text), plainto_tsquery('english', $1)) as text_rank,
        ts_rank_cd(to_tsvector('english', r.name), plainto_tsquery('english', $1)) as title_rank,
        ts_rank_cd(to_tsvector('english', COALESCE(r.description, '')), plainto_tsquery('english', $1)) as desc_rank
      FROM chunks c
      JOIN resources r ON c.resource_id = r.id
      WHERE
        to_tsvector('english', c.text) @@ plainto_tsquery('english', $1)
        OR to_tsvector('english', r.name) @@ plainto_tsquery('english', $1)
        OR to_tsvector('english', COALESCE(r.description, '')) @@ plainto_tsquery('english', $1)
        OR LOWER(array_to_string(r.publishers, ' ')) LIKE LOWER('%' || $1 || '%')
        ${userId ? `AND r.user_id = $2` : ''}
      ORDER BY
        CASE
          WHEN to_tsvector('english', r.name) @@ plainto_tsquery('english', $1) THEN 1
          WHEN LOWER(array_to_string(r.publishers, ' ')) LIKE LOWER('%' || $1 || '%') THEN 2
          WHEN to_tsvector('english', COALESCE(r.description, '')) @@ plainto_tsquery('english', $1) THEN 3
          ELSE 4
        END,
        text_rank DESC
      LIMIT ${limitParam}`,
      queryParams
    );

    console.log(`✅ Keyword search found ${results.rows.length} results`);

    return results.rows.map((row: any) => {
      // Calculate dynamic score based on where the match occurred
      let finalScore = 0.5; // Base score

      // Check where the match occurred and adjust score
      if (row.title_rank > 0) {
        finalScore = Math.max(finalScore, Math.min(0.95, 0.7 + row.title_rank));
      } else if (row.desc_rank > 0) {
        finalScore = Math.max(finalScore, Math.min(0.75, 0.5 + row.desc_rank));
      } else if (row.text_rank > 0) {
        finalScore = Math.min(0.65, 0.3 + row.text_rank);
      }

      // Check for publisher match
      const queryLower = query.toLowerCase();
      const publishers = (row.publishers || []).join(' ').toLowerCase();
      if (publishers.includes(queryLower)) {
        finalScore = Math.max(finalScore, 0.85);
      }

      return {
        chunk_id: row.chunk_id,
        resource_id: row.resource_id,
        resource_title: row.resource_title,
        resource_metadata: {
          ...row.resource_metadata,
          publishers: row.publishers,
          description: row.description
        },
        text: row.text,
        section_name: row.section_name,
        similarity_score: 0,
        text_rank: row.text_rank,
        final_score: finalScore, // Dynamic score instead of always 1.0
        position: row.position,
        token_count: row.token_count,
        resource_created_at: row.resource_created_at,
        preview: row.text.length > 200 ? row.text.substring(0, 200) + '...' : row.text
      };
    });

  } catch (error) {
    console.error('Error in keyword search:', error);
    throw error;
  }
}

// Main vector search function
export async function vectorSearch(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  try {
    const {
      limit = 10,
      similarityThreshold = 0.1,
      userId,
      fileTypes = [],
      minScore = 0,
      resourceIds = []
    } = options;

    const embedding = await embedQuery(query);

    // Build dynamic WHERE clause
    let whereConditions = ['1 - (c.embedding <=> $1::vector) > $3'];
    let queryParams: any[] = [JSON.stringify(embedding), query, similarityThreshold];
    let paramCount = 3;

    if (userId) {
      whereConditions.push(`r.user_id = $${++paramCount}`);
      queryParams.push(userId);
    }

    if (fileTypes.length > 0) {
      whereConditions.push(`r.metadata->>'type' = ANY($${++paramCount})`);
      queryParams.push(fileTypes);
    }

    if (resourceIds.length > 0) {
      whereConditions.push(`r.id = ANY($${++paramCount})`);
      queryParams.push(resourceIds);
    }

    queryParams.push(limit * 2); // Get more results for post-processing
    const limitParam = `$${++paramCount}`;

    // REVISED SQL QUERY: Add exact phrase rank to the database query
    const vectorResults = await db.query(
      `SELECT
        c.id as chunk_id,
        c.resource_id,
        c.text,
        c.position,
        c.section_name,
        c.token_count,
        r.name as resource_title,
        r.metadata as resource_metadata,
        r.created_at as resource_created_at,
        (1 - (c.embedding <=> $1::vector)) as similarity_score,
        ts_rank_cd(to_tsvector('english', c.text), plainto_tsquery('english', $2)) as text_rank,
        ts_rank_cd(to_tsvector('english', c.text), to_tsquery('english', quote_literal($2))) as exact_phrase_rank
      FROM chunks c
      JOIN resources r ON c.resource_id = r.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY
        exact_phrase_rank DESC,
        (1 - (c.embedding <=> $1::vector)) * 0.5 +
        ts_rank_cd(to_tsvector('english', c.text), plainto_tsquery('english', $2)) * 0.5 DESC
      LIMIT ${limitParam}`,
      queryParams
    );

    // Post-process and score results
    const scoredResults = vectorResults.rows.map((row: any) => {
      let finalScore;
      // If there is an exact phrase match, give it a major boost
      if (row.exact_phrase_rank > 0) {
        finalScore = Math.min(1.0, row.similarity_score + 0.5); // Add a significant bonus
      } else {
        // Fallback to the original hybrid scoring
        finalScore = (row.similarity_score * 0.5) + (row.text_rank * 0.5);
      }

      return {
        chunk_id: row.chunk_id,
        resource_id: row.resource_id,
        resource_title: row.resource_title,
        resource_metadata: row.resource_metadata,
        text: row.text,
        section_name: row.section_name,
        similarity_score: row.similarity_score,
        text_rank: row.text_rank,
        final_score: finalScore,
        position: row.position,
        token_count: row.token_count,
        resource_created_at: row.resource_created_at,
        preview: row.text.length > 200 ? row.text.substring(0, 200) + '...' : row.text
      };
    });

    return scoredResults
      .filter((result: any) => result.final_score >= minScore)
      .sort((a: any, b: any) => b.final_score - a.final_score)
      .slice(0, limit);

  } catch (error) {
    console.error('Error in vector search:', error);
    throw error;
  }
}

// Enhanced hybrid search
export async function hybridSearch(
  query: string,
  limit: number = 10,
  similarityThreshold: number = 0.1,
  userId?: number
): Promise<SearchResult[]> {
  return vectorSearch(query, {
    limit,
    similarityThreshold,
    userId
  });
}

// Utility functions
export function validateEmbedding(embedding: number[]): boolean {
  return Array.isArray(embedding) &&
         embedding.length === 1536 &&
         embedding.every(val => typeof val === 'number' && !isNaN(val) && isFinite(val));
}

export async function deleteResourceChunks(resourceId: number): Promise<void> {
  try {
    const result = await db.query('DELETE FROM chunks WHERE resource_id = $1', [resourceId]);
    console.log(`Deleted ${result.rowCount} chunks for resource ${resourceId}`);
  } catch (error) {
    console.error(`Error deleting chunks for resource ${resourceId}:`, error);
    throw error;
  }
}

// Search within specific resources
export async function searchInResources(
  query: string,
  resourceIds: number[],
  options: Omit<SearchOptions, 'resourceIds'> = {}
): Promise<SearchResult[]> {
  return vectorSearch(query, {
    ...options,
    resourceIds
  });
}

// Get similar chunks to a specific chunk
export async function findSimilarChunks(
  chunkId: number,
  limit: number = 5,
  userId?: number
): Promise<SearchResult[]> {
  try {
    // Get the embedding of the source chunk
    const chunkResult = await db.query(
      'SELECT embedding, text FROM chunks WHERE id = $1',
      [chunkId]
    );

    if (chunkResult.rows.length === 0) {
      throw new Error('Chunk not found');
    }

    const sourceEmbedding = chunkResult.rows[0].embedding;
    const sourceText = chunkResult.rows[0].text;

    let whereClause = 'c.id != $1';
    let queryParams: any[] = [chunkId, sourceEmbedding];

    if (userId) {
      whereClause += ' AND r.user_id = $3';
      queryParams.push(userId);
    }

    const limitParam = userId ? '$4' : '$3';
    queryParams.push(limit);

    const results = await db.query(
      `SELECT
        c.id as chunk_id,
        c.resource_id,
        c.text,
        c.position,
        c.section_name,
        c.token_count,
        r.name as resource_title,
        r.metadata as resource_metadata,
        r.created_at as resource_created_at,
        1 - (c.embedding <=> $2::vector) as similarity_score
      FROM chunks c
      JOIN resources r ON c.resource_id = r.id
      WHERE ${whereClause}
      ORDER BY c.embedding <=> $2::vector
      LIMIT ${limitParam}`,
      queryParams
    );

    return results.rows.map((row: any) => ({
      chunk_id: row.chunk_id,
      resource_id: row.resource_id,
      resource_title: row.resource_title,
      resource_metadata: row.resource_metadata,
      text: row.text,
      section_name: row.section_name,
      similarity_score: row.similarity_score,
      text_rank: 0,
      final_score: row.similarity_score,
      position: row.position,
      token_count: row.token_count,
      resource_created_at: row.resource_created_at,
      preview: row.text.length > 200 ? row.text.substring(0, 200) + '...' : row.text
    }));

  } catch (error) {
    console.error('Error finding similar chunks:', error);
    throw error;
  }
}