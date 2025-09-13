import db from '../lib/db';
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Split text into chunks
export function chunkText(text: string, size: number = 500): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

// Process text, generate embeddings, insert into DB
export async function processTextAndInsertChunks(resourceId: number, text: string) {
  const chunks = chunkText(text);

  for (const chunk of chunks) {
    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: chunk
    });

    const vector: number[] = embeddingRes.data[0].embedding;

    await db.query(
      'INSERT INTO chunks (resource_id, text, embedding) VALUES ($1, $2, $3)',
      [resourceId, chunk, vector]
    );
  }
}

// Generate embedding for query (used in search)
export async function embedQuery(query: string): Promise<number[]> {
  const embeddingRes = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: query
  });

  return embeddingRes.data[0].embedding;
}
