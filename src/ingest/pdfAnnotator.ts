import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { extractStructuredFacilities } from './textUtils';
import { getLogger } from '../utils/logger';

const logger = getLogger();

// Dynamically import pdfjs-dist to avoid webpack bundling issues in Next.js
// In Node.js/server environment, use require() for better externalization support
async function getPdfjsLib() {
	if (typeof window === 'undefined') {
		// Node.js/server environment - use require() to avoid webpack bundling
		// Use a variable to make the require truly dynamic so webpack doesn't analyze it
		const moduleName = 'pdfjs-dist';
		// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
		const pdfjsLib = require(moduleName);
		// Set up pdfjs-dist worker for Node.js
		if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
			pdfjsLib.GlobalWorkerOptions.workerSrc = '';
		}
		return pdfjsLib;
	} else {
		// Browser environment - use dynamic import
		const pdfjsLib = await import('pdfjs-dist');
		return pdfjsLib;
	}
}

interface LocationAnnotation {
	block: string;
	searchKey: string;
	pageIndex: number;
	xPosition: number;
	yPosition: number;
}

interface TextItem {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	pageIndex: number;
}

/**
 * Group text items into words/phrases by combining adjacent items on the same line
 */
function groupTextItemsIntoWords(textItems: TextItem[]): TextItem[] {
	const grouped: TextItem[] = [];
	const pageGroups = new Map<number, TextItem[]>();
	
	// Group by page
	for (const item of textItems) {
		if (!pageGroups.has(item.pageIndex)) {
			pageGroups.set(item.pageIndex, []);
		}
		pageGroups.get(item.pageIndex)!.push(item);
	}
	
	// For each page, group items that are on the same line (similar Y) and adjacent (similar X)
	for (const [pageIndex, items] of pageGroups.entries()) {
		// Sort by Y (top to bottom), then by X (left to right)
		const sorted = items.sort((a, b) => {
			const yDiff = Math.abs(a.y - b.y);
			if (yDiff > 5) return b.y - a.y; // Different lines
			return a.x - b.x; // Same line, sort by X
		});
		
		let currentWord: TextItem | null = null;
		const Y_TOLERANCE = 5; // Items within 5 points are on the same line
		const X_GAP = 10; // Items within 10 points are part of the same word
		
		for (const item of sorted) {
			if (!currentWord) {
				currentWord = { ...item };
			} else {
				const sameLine = Math.abs(currentWord.y - item.y) < Y_TOLERANCE;
				const adjacent = item.x - (currentWord.x + currentWord.width) < X_GAP;
				
				if (sameLine && adjacent) {
					// Combine into same word
					currentWord.text += item.text;
					currentWord.width = item.x + item.width - currentWord.x;
				} else {
					// Start new word
					grouped.push(currentWord);
					currentWord = { ...item };
				}
			}
		}
		if (currentWord) {
			grouped.push(currentWord);
		}
	}
	
	return grouped;
}

/**
 * Annotates a PDF with search keys positioned to the right of location blocks.
 * Search keys are displayed in red, size 16 font.
 */
export async function annotatePdfWithSearchKeys(
	pdfBuffer: Buffer,
	locationBlocks: Array<{ block: string; searchKey?: string }>
): Promise<Buffer> {
	try {
		const pdfDoc = await PDFDocument.load(pdfBuffer);
		const pages = pdfDoc.getPages();
		const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
		const fontSize = 16;
		const textColor = rgb(1, 0, 0); // Red color

		// Group location blocks by their likely page
		const annotations: LocationAnnotation[] = [];
		const blocksPerPage = Math.ceil(locationBlocks.length / pages.length);

		for (let i = 0; i < locationBlocks.length; i++) {
			const { block, searchKey } = locationBlocks[i];
			if (!searchKey) continue;

			const pageIndex = Math.floor(i / blocksPerPage);
			if (pageIndex >= pages.length) continue;

			const page = pages[pageIndex];
			const { width, height } = page.getSize();
			
			// Calculate Y position: start from top, space blocks vertically
			const blockIndexOnPage = i % blocksPerPage;
			const yPosition = height - 100 - (blockIndexOnPage * 80);

			annotations.push({
				block,
				searchKey,
				pageIndex,
				xPosition: width * 0.7,
				yPosition: Math.max(50, yPosition),
			});
		}

		// Add annotations to PDF
		for (const annotation of annotations) {
			const page = pages[annotation.pageIndex];
			
			page.drawText(annotation.searchKey, {
				x: annotation.xPosition,
				y: annotation.yPosition,
				size: fontSize,
				font: font,
				color: textColor,
			});
		}

		const pdfBytes = await pdfDoc.save();
		return Buffer.from(pdfBytes);
	} catch (error: any) {
		logger.error('PDF annotation failed', { message: error?.message });
		throw error;
	}
}

/**
 * Extract text items with coordinates from PDF using pdfjs-dist
 */
async function extractTextWithPositions(pdfBuffer: Buffer): Promise<TextItem[]> {
	try {
		// Dynamically import pdfjs-dist to avoid webpack bundling issues
		const pdfjsLib = await getPdfjsLib();
		
		const loadingTask = pdfjsLib.getDocument({ 
			data: new Uint8Array(pdfBuffer),
			useSystemFonts: true,
		});
		const pdf = await loadingTask.promise;
		const textItems: TextItem[] = [];

		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);
			const viewport = page.getViewport({ scale: 1.0 });
			const textContent = await page.getTextContent();

			for (const item of textContent.items) {
				if ('str' in item && 'transform' in item && item.str.trim()) {
					const transform = item.transform;
					const x = transform[4];
					const pdfY = transform[5];
					const y = viewport.height - pdfY;
					
					textItems.push({
						text: item.str,
						x,
						y,
						width: item.width || 0,
						height: item.height || 0,
						pageIndex: pageNum - 1,
					});
				}
			}
		}

		// Group individual characters into words
		return groupTextItemsIntoWords(textItems);
	} catch (error: any) {
		logger.warn('pdfjs-dist extraction failed, will use fallback', { message: error?.message });
		return [];
	}
}

/**
 * Find the position of a location block in the PDF by matching text
 * Returns the Y position of the first line (facility name) of the block
 */
function findBlockPosition(
	block: string,
	textItems: TextItem[],
	pageIndex: number
): { x: number; y: number } | null {
	const blockLines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
	if (blockLines.length === 0) return null;

	// Find items on this page, sorted by Y position (top to bottom)
	const pageItems = textItems
		.filter(item => item.pageIndex === pageIndex)
		.sort((a, b) => b.y - a.y); // Sort by Y descending (top to bottom)

	if (pageItems.length === 0) return null;

	// Try to find the facility name (first line) - this is usually the most distinctive
	const facilityName = blockLines[0];
	
	// Look for exact or partial matches of the facility name
	for (const item of pageItems) {
		const itemText = item.text.trim();
		
		// Exact match
		if (itemText === facilityName || itemText.includes(facilityName) || facilityName.includes(itemText)) {
			return { x: item.x, y: item.y };
		}
		
		// Word-based matching for multi-word facility names
		const facilityWords = facilityName.split(/\s+/).filter(w => w.length > 1);
		const itemWords = itemText.split(/\s+/).filter(w => w.length > 1);
		
		if (facilityWords.length > 0 && itemWords.length > 0) {
			// Check if significant words match
			const matchingWords = facilityWords.filter(fw => 
				itemWords.some(iw => {
					const fwLower = fw.toLowerCase();
					const iwLower = iw.toLowerCase();
					return fwLower === iwLower || fwLower.includes(iwLower) || iwLower.includes(fwLower);
				})
			);
			
			// If at least 2 words match, or if it's a short name and most words match
			if (matchingWords.length >= Math.min(2, facilityWords.length) || 
			    (facilityWords.length <= 3 && matchingWords.length === facilityWords.length)) {
				return { x: item.x, y: item.y };
			}
		}
	}

	// Fallback: try matching address line (second line) if facility name didn't match
	if (blockLines.length > 1) {
		const addressLine = blockLines[1];
		for (const item of pageItems) {
			const itemText = item.text.trim();
			if (itemText.includes(addressLine) || addressLine.includes(itemText)) {
				// Return position slightly above (for the facility name line)
				return { x: item.x, y: item.y + 15 };
			}
		}
	}

	return null;
}

/**
 * Improved version that uses pdfjs-dist to extract text with exact coordinates
 * and preserves the original PDF structure
 */
export async function annotatePdfWithSearchKeysImproved(
	pdfBuffer: Buffer,
	locationBlocks: Array<{ block: string; searchKey?: string }>,
	extractedText: string
): Promise<Buffer> {
	try {
		// Load PDF with pdf-lib to preserve structure
		const pdfDoc = await PDFDocument.load(pdfBuffer);
		const pages = pdfDoc.getPages();
		const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
		const fontSize = 16;
		const textColor = rgb(1, 0, 0); // Red color

		// Extract text with positions using pdfjs-dist (this will group characters into words)
		const textItems = await extractTextWithPositions(pdfBuffer);

		// Create annotations with accurate positions
		const annotations: LocationAnnotation[] = [];

		for (const { block, searchKey } of locationBlocks) {
			if (!searchKey) continue;

			// Try to find the block position on each page
			let foundPosition: { x: number; y: number; pageIndex: number } | null = null;

			for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
				const position = findBlockPosition(block, textItems, pageIndex);
				if (position) {
					foundPosition = { ...position, pageIndex };
					break;
				}
			}

			if (!foundPosition) {
				// Fallback: use line-based estimation
				const textLines = extractedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
				const blockLines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
				if (blockLines.length === 0) continue;

				const firstLine = blockLines[0];
				const lineIndex = textLines.findIndex(line =>
					line.includes(firstLine) || firstLine.includes(line)
				);

				if (lineIndex >= 0) {
					const totalLines = textLines.length;
					const linesPerPage = Math.ceil(totalLines / pages.length);
					const pageIndex = Math.min(Math.floor(lineIndex / linesPerPage), pages.length - 1);
					const page = pages[pageIndex];
					const { width, height } = page.getSize();
					const lineIndexOnPage = lineIndex % linesPerPage;
					const lineHeight = 13;
					const yPosition = height - 50 - (lineIndexOnPage * lineHeight);

					foundPosition = {
						x: width * 0.7,
						y: Math.max(50, Math.min(yPosition, height - 50)),
						pageIndex,
					};
				} else {
					continue; // Skip if we can't find the block
				}
			}

			// Get page dimensions to calculate right-side position
			const page = pages[foundPosition.pageIndex];
			const { width } = page.getSize();

			// Position search key to the right of the location block
			// Use the block's X position and add offset, or use 70% of page width
			const xPosition = Math.max(foundPosition.x + 200, width * 0.7);

			annotations.push({
				block,
				searchKey,
				pageIndex: foundPosition.pageIndex,
				xPosition,
				yPosition: foundPosition.y,
			});
		}

		// Add annotations to PDF (this preserves the original structure)
		// Make sure we're drawing the FULL search key string, not individual characters
		for (const annotation of annotations) {
			const page = pages[annotation.pageIndex];

			page.drawText(annotation.searchKey, {
				x: annotation.xPosition,
				y: annotation.yPosition,
				size: fontSize,
				font: font,
				color: textColor,
			});
		}

		const pdfBytes = await pdfDoc.save();
		return Buffer.from(pdfBytes);
	} catch (error: any) {
		logger.error('PDF annotation failed', { message: error?.message });
		// Fallback to simpler method if pdfjs-dist fails
		logger.warn('Falling back to simple annotation method');
		return annotatePdfWithSearchKeys(pdfBuffer, locationBlocks);
	}
}
