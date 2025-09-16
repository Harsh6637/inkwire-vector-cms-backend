import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

function normalizeText(raw: string): string {
  return raw
    // Remove null bytes and other control characters that cause UTF-8 issues
    .replace(/\x00/g, '') // Remove null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove other control chars
    // Preserve paragraph breaks by keeping double newlines
    .replace(/\r\n\r\n+/g, '\n\n')
    .replace(/\n\n+/g, '\n\n')
    // Convert single line breaks to spaces, but preserve paragraph breaks
    .replace(/(?<!\n)\r\n|\r|\n(?!\n)/g, ' ')
    // Clean up excessive spaces but preserve normal spacing
    .replace(/[ \t]{2,}/g, ' ')
    // Remove replacement characters
    .replace(/\uFFFD/g, '')
    // Trim whitespace from start and end
    .trim();
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  console.log('Starting PDF text extraction...');
  console.log(`PDF buffer size: ${buffer.length} bytes`);

  try {
    // Check if it's actually a PDF
    const pdfHeader = buffer.toString('ascii', 0, 4);
    console.log(`File header: "${pdfHeader}"`);

    if (pdfHeader !== '%PDF') {
      console.error('Invalid PDF format - missing %PDF header');
      return '';
    }

    console.log('Valid PDF format detected, attempting text extraction...');

    const pdfData = await pdfParse(buffer);

    console.log(`PDF parsing results:`);
    console.log(`  - Pages: ${pdfData.numpages || 0}`);
    console.log(`  - Raw text length: ${pdfData.text?.length || 0}`);

    const text = pdfData.text?.trim() || '';

    if (text.length === 0) {
      console.warn('PDF contains no extractable text');
      return '';
    }

    console.log(`Successfully extracted ${text.length} characters`);
    console.log(`Text preview (first 200 chars): "${text.substring(0, 200)}..."`);

    return normalizeText(text);

  } catch (error: any) {
    console.error('PDF extraction failed:', error.message);
    return '';
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  console.log('Starting DOCX text extraction...');
  console.log(`DOCX buffer size: ${buffer.length} bytes`);

  try {
    const result = await mammoth.extractRawText({ buffer });
    let text = result.value?.trim() || '';

    if (text.length === 0) {
      console.warn('DOCX contains no extractable text');
      return '';
    }

    console.log(`Successfully extracted ${text.length} characters from DOCX`);
    console.log(`Text preview (first 200 chars): "${text.substring(0, 200)}..."`);

    return text; // Return raw text, let normalizeText handle formatting

  } catch (error: any) {
    console.error('DOCX extraction failed:', error.message);
    return '';
  }
}

export async function extractTextFromRawData(rawData: string): Promise<string | null> {
  console.log('Starting raw data text extraction...');

  try {
    if (!rawData || !rawData.includes('base64,')) {
      console.error('Invalid raw data format - missing base64 data');
      return null;
    }

    console.log('Raw data format validation passed');

    const [header, base64Data] = rawData.split(',');
    if (!base64Data) {
      console.error('No base64 data found after comma');
      return null;
    }

    console.log(`Base64 data length: ${base64Data.length} characters`);

    // Extract MIME type
    const mimeMatch = header.match(/data:([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'unknown';

    console.log(`Detected MIME type: "${mimeType}"`);
    console.log(`Full header: "${header}"`);

    // Convert to buffer
    console.log('Converting base64 to buffer...');
    const buffer = Buffer.from(base64Data, 'base64');
    console.log(`Buffer created: ${buffer.length} bytes`);

    let extracted = '';

    console.log(`Processing file type: ${mimeType}`);

    // Handle different file types
    switch (mimeType) {
      case 'application/pdf':
        console.log('Processing as PDF...');
        extracted = await extractPdfText(buffer);
        break;

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      case 'application/docx':
        console.log('Processing as DOCX...');
        extracted = await extractDocxText(buffer);
        break;

      case 'application/msword':
      case 'application/doc':
        console.log('Processing as DOC (legacy Word)...');
        extracted = await extractDocxText(buffer); // mammoth handles both
        break;

      case 'text/plain':
      case 'text/markdown':
      case 'text/csv':
        console.log('Processing as plain text...');
        extracted = buffer.toString('utf-8');
        break;

      default:
        console.log(`Unsupported MIME type: ${mimeType}. Trying as plain text...`);
        try {
          const textContent = buffer.toString('utf-8');
          if (textContent.length > 0 && !textContent.includes('\uFFFD')) {
            extracted = textContent;
            console.log('Successfully processed as plain text');
          } else {
            console.log('Not valid plain text');
          }
        } catch (e) {
          console.log('Failed to process as plain text');
        }
        break;
    }

    if (!extracted || extracted.trim().length === 0) {
      console.error('No text extracted from file');
      return null;
    }

    const normalizedText = normalizeText(extracted);
    console.log(`EXTRACTION SUCCESS!`);
    console.log(`Final results:`);
    console.log(`  - Original length: ${extracted.length}`);
    console.log(`  - Normalized length: ${normalizedText.length}`);
    console.log(`  - Preview: "${normalizedText.substring(0, 100)}..."`);

    return normalizedText;

  } catch (error: any) {
    console.error('EXTRACTION COMPLETELY FAILED:', error);
    console.error('Error message:', error.message);
    return null;
  }
}

export async function processResourceWithRawData(
  resourceId: number,
  text: string,
  metadata?: any
): Promise<void> {
  console.log(`\n=== PROCESSING RESOURCE ${resourceId} ===`);
  console.log(`Initial text length: ${text?.length || 0}`);
  console.log(`Has metadata: ${!!metadata}`);
  console.log(`Has rawData: ${!!(metadata?.rawData)}`);

  const db = require('../lib/db').default;
  let contentToProcess = text;

  // Check if we need to extract from raw data
  if (metadata?.rawData) {
    console.log(`\nEXTRACTING FROM RAW DATA...`);
    console.log(`Raw data preview: ${metadata.rawData.substring(0, 50)}...`);

    const extractedText = await extractTextFromRawData(metadata.rawData);

    if (extractedText && extractedText.trim().length > 0) {
      contentToProcess = extractedText;
      console.log(`\n✅ EXTRACTION SUCCESSFUL`);
      console.log(`Extracted ${extractedText.length} characters`);

      // Update database with extracted content
      console.log(`Updating database with extracted content...`);
      try {
        await db.query(
          'UPDATE resources SET text_content = $1 WHERE id = $2',
          [extractedText, resourceId]
        );
        console.log(`✅ Database updated successfully`);
      } catch (dbError: any) {
        console.error(`❌ Database update failed:`, dbError.message);
      }

    } else {
      console.error(`❌ EXTRACTION FAILED - No content extracted for resource ${resourceId}`);
      console.log(`Debugging info:`);
      console.log(`  - Raw data exists: ${!!metadata?.rawData}`);
      console.log(`  - Raw data length: ${metadata?.rawData?.length || 0}`);
      console.log(`  - Extracted text: "${extractedText}"`);

      // If extraction failed, we might still have original text to work with
      if (!text || text.trim().length === 0) {
        console.error(`❌ No fallback text available either`);
        console.log(`=== PROCESSING FAILED for resource ${resourceId} ===\n`);
        return;
      } else {
        console.log(`📝 Using original text as fallback (${text.length} characters)`);
      }
    }
  } else if (text && text.trim().length > 0) {
    console.log(`📝 Using provided text content (${text.length} characters)`);
  } else {
    console.error(`❌ No content to process - neither text nor raw data available`);
    console.log(`=== PROCESSING FAILED for resource ${resourceId} ===\n`);
    return;
  }

  // Process chunks if we have content
  if (contentToProcess && contentToProcess.trim().length > 0) {
    console.log(`\nCREATING CHUNKS...`);
    console.log(`Content length: ${contentToProcess.length} characters`);

    try {
      const { processTextAndInsertChunks } = require('./chunkEmbed');
      await processTextAndInsertChunks(resourceId, normalizeText(contentToProcess));
      console.log(`✅ CHUNKS CREATED SUCCESSFULLY for resource ${resourceId}`);
    } catch (chunkError: any) {
      console.error(`❌ CHUNK CREATION FAILED:`, chunkError.message);
      console.error(`Stack trace:`, chunkError.stack?.split('\n').slice(0, 3));
      throw chunkError;
    }
  } else {
    console.error(`❌ NO CONTENT TO CHUNK for resource ${resourceId}`);
  }

  console.log(`=== PROCESSING COMPLETE for resource ${resourceId} ===\n`);
}