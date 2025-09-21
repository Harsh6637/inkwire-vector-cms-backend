import db from '../lib/db';
import { processTextAndInsertChunks, deleteResourceChunks } from '../utils/chunkEmbed';
import { extractTextFromRawData } from '../utils/rawDataProcessor';

// Process chunks for a resource asynchronously
export async function processResourceChunksAsync(resourceId: number) {
  try {
    console.log(`Starting chunk processing for resource ${resourceId}`);

    // Get resource from database
    const result = await db.query(
      'SELECT * FROM resources WHERE id = $1',
      [resourceId]
    );

    if (result.rows.length === 0) {
      throw new Error('Resource not found');
    }

    const resource = result.rows[0];
    let contentToProcess = resource.text_content;

    // Extract text from raw data if available
    if (resource.metadata?.rawData) {
      const extractedText = await extractTextFromRawData(resource.metadata.rawData);
      if (extractedText && extractedText.trim().length > 0) {
        contentToProcess = extractedText;
        // Update database with extracted text
        await db.query(
          'UPDATE resources SET text_content = $1 WHERE id = $2',
          [extractedText, resourceId]
        );
      }
    }

    // Create enriched content with metadata for better search
    const enrichedContent = createEnrichedContent(
      contentToProcess,
      resource.name,
      resource.publishers,
      resource.description,
      resource.metadata?.tags || []
    );

    // Process and insert chunks
    await processTextAndInsertChunks(resourceId, enrichedContent);

    // Update metadata to mark as processed
    await db.query(
      `UPDATE resources
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}')::jsonb,
         '{processingStatus}',
         '"completed"'
       )
       WHERE id = $1`,
      [resourceId]
    );

    console.log(`Successfully processed chunks for resource ${resourceId}`);

  } catch (error) {
    console.error(`Failed to process chunks for resource ${resourceId}:`, error);

    // Mark as failed
    await db.query(
      `UPDATE resources
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}')::jsonb,
         '{processingStatus}',
         '"failed"'
       )
       WHERE id = $1`,
      [resourceId]
    );
  }
}

// Helper to enrich content with metadata
function createEnrichedContent(
  text: string,
  name: string,
  publishers: string[],
  description: string,
  tags: string[]
): string {
  let enriched = '';

  // Add metadata at the beginning for better search context
  if (name) enriched += `Title: ${name}\n`;
  if (description) enriched += `Description: ${description}\n`;
  if (publishers?.length > 0) enriched += `Publishers: ${publishers.join(', ')}\n`;
  if (tags?.length > 0) enriched += `Tags: ${tags.join(', ')}\n`;

  if (enriched) enriched += '\n---\n\n';

  return enriched + text;
}