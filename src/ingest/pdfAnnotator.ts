import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { extractStructuredFacilities } from './textUtils';
import { getLogger } from '../utils/logger';
import { createRequire } from 'module';

const logger = getLogger();

// Dynamically import pdfjs-dist to avoid webpack bundling issues in Next.js
// Use createRequire for Node.js/server environment to handle CommonJS modules in ES module context
async function getPdfjsLib() {
	try {
		// Use dynamic import in a way that avoids bundler static analysis for optional targets
		// but still resolves installed 'pdfjs-dist'
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const dynamicImport = new Function('m', 'return import(m)');
		// @ts-expect-error any
		const pdfjsLib = await dynamicImport('pdfjs-dist');
		// @ts-expect-error any
		if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
			// Disable external worker; we will set disableWorker: true in getDocument
			// @ts-expect-error any
			pdfjsLib.GlobalWorkerOptions.workerSrc = undefined as unknown as string;
		}
		return pdfjsLib;
	} catch (error: any) {
		logger.error('Failed to import pdfjs-dist', { message: error?.message });
		throw error;
	}
}

interface LocationAnnotation {
	block: string;
	searchKey?: string;
	warningMessage?: string;
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
	locationBlocks: Array<{ block: string; searchKey?: string; warningMessage?: string }>
): Promise<Buffer> {
	try {
		logger.info('Using simple PDF annotation method', { blocksCount: locationBlocks.length });
		const pdfDoc = await PDFDocument.load(pdfBuffer);
		const pages = pdfDoc.getPages();
		const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
		const fontSize = 16;
		const textColor = rgb(1, 0, 0); // Red color

		// Group location blocks by their likely page
		const annotations: LocationAnnotation[] = [];
		const blocksPerPage = Math.ceil(locationBlocks.length / pages.length);

		for (let i = 0; i < locationBlocks.length; i++) {
			const blockData = locationBlocks[i];
			if (!blockData) continue;
			const { block, searchKey, warningMessage } = blockData;
			// Include all blocks - either with searchKey or warningMessage
			if (!searchKey && !warningMessage) {
				logger.debug('Skipping block in simple method (no searchKey or warningMessage)', { 
					block: block.substring(0, 50) 
				});
				continue;
			}

			const pageIndex = Math.floor(i / blocksPerPage);
			if (pageIndex >= pages.length) {
				logger.warn('Page index out of bounds', { pageIndex, pagesCount: pages.length });
				continue;
			}

			const page = pages[pageIndex];
			const { width, height } = page.getSize();
			
			// Calculate Y position: start from top, space blocks vertically
			const blockIndexOnPage = i % blocksPerPage;
			const yPosition = height - 100 - (blockIndexOnPage * 80);

			annotations.push({
				block,
				searchKey,
				warningMessage,
				pageIndex,
				xPosition: width * 0.7,
				yPosition: Math.max(50, yPosition),
			});
		}

		logger.info('Simple annotation method: adding annotations', { annotationsCount: annotations.length });

		// Add annotations to PDF
		for (const annotation of annotations) {
			const page = pages[annotation.pageIndex];
			const textToDisplay = annotation.searchKey || annotation.warningMessage || '';
			
			if (!textToDisplay) {
				logger.warn('Skipping annotation with empty text in simple method', { 
					block: annotation.block.substring(0, 50) 
				});
				continue;
			}
			
			// Draw light yellow background rectangle behind text for visibility
			const textWidth = font.widthOfTextAtSize(textToDisplay, fontSize);
			const textHeight = fontSize;
			const padding = 2;
			page.drawRectangle({
				x: annotation.xPosition - padding,
				y: annotation.yPosition - textHeight - padding,
				width: textWidth + (padding * 2),
				height: textHeight + (padding * 2),
				color: rgb(1, 1, 0.8),
				opacity: 1.0,
			});
			
			// Draw red text annotation
			page.drawText(textToDisplay, {
				x: annotation.xPosition,
				y: annotation.yPosition,
				size: fontSize,
				font: font,
				color: textColor,
				opacity: 1.0,
			});
		}

		const pdfBytes = await pdfDoc.save();
		logger.info('Simple PDF annotation completed', { annotationsAdded: annotations.length });
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
			disableWorker: true,
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
	locationBlocks: Array<{ block: string; searchKey?: string; warningMessage?: string }>,
	extractedText: string
): Promise<Buffer> {
	try {
		// Load PDF with pdf-lib to preserve structure
		const pdfDoc = await PDFDocument.load(pdfBuffer);
		const pages = pdfDoc.getPages();
		const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
		const fontSize = 16;
		const textColor = rgb(1, 0, 0); // Red color

		// Absolute fallback: if no blocks provided at all, place "RESEARCH REQUIRED" once per page (top-right area)
		if (!locationBlocks || locationBlocks.length === 0) {
			logger.warn('No location blocks provided; adding per-page RESEARCH REQUIRED markers');
			for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
				const page = pages[pageIndex];
				const { width, height } = page.getSize();
				const textToDisplay = 'RESEARCH REQUIRED';
				const textWidth = font.widthOfTextAtSize(textToDisplay, fontSize);
				const textHeight = fontSize;
				const padding = 2;
				const x = width * 0.7;
				const y = height - 100;
				// background
				page.drawRectangle({
					x: x - padding,
					y: y - textHeight - padding,
					width: textWidth + (padding * 2),
					height: textHeight + (padding * 2),
					color: rgb(1, 1, 0.8),
					opacity: 1.0,
				});
				// text
				page.drawText(textToDisplay, { x, y, size: fontSize, font, color: textColor, opacity: 1.0 });
			}
			const pdfBytes = await pdfDoc.save();
			logger.info('Per-page RESEARCH REQUIRED fallback annotation completed', { pages: pages.length });
			return Buffer.from(pdfBytes);
		}

		// Extract text with positions using pdfjs-dist (this will group characters into words)
		const textItems = await extractTextWithPositions(pdfBuffer);
		logger.info('Extracted text items from PDF', { 
			textItemsCount: textItems.length,
			pagesCount: pages.length 
		});

		// Create annotations with accurate positions
		const annotations: LocationAnnotation[] = [];

		// If we have no positioned text at all and the extractedText is also empty,
		// add a page-level fallback marker so the user sees something.
		if (textItems.length === 0 && (!extractedText || !extractedText.trim())) {
			logger.warn('No text items and no extracted text; adding page-level RESEARCH REQUIRED markers');
			for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
				const page = pages[pageIndex];
				const { width, height } = page.getSize();
				annotations.push({
					block: 'RESEARCH REQUIRED',
					warningMessage: 'RESEARCH REQUIRED',
					pageIndex,
					xPosition: width * 0.7,
					yPosition: height - 100,
				});
			}
		}

		logger.info('Starting PDF annotation', { 
			blocksCount: locationBlocks.length,
			blocks: locationBlocks.map((b, idx) => ({
				index: idx + 1,
				block: b.block,
				blockPreview: b.block.substring(0, 150),
				searchKey: b.searchKey,
				warningMessage: b.warningMessage
			}))
		});
		
		for (const { block, searchKey, warningMessage } of locationBlocks) {
			// Include all blocks - either with searchKey or warningMessage
			if (!searchKey && !warningMessage) {
				logger.debug('Skipping block (no searchKey or warningMessage)', { block: block.substring(0, 50) });
				continue;
			}

			logger.info('Processing block for annotation', { 
				block: block,
				blockPreview: block.substring(0, 150),
				hasSearchKey: !!searchKey,
				hasWarning: !!warningMessage,
				searchKey: searchKey,
				warningMessage: warningMessage
			});

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
				logger.debug('Block position not found via text matching, trying fallback', { 
					block: block.substring(0, 50) 
				});
				// Fallback: use line-based estimation
				const textLines = extractedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
				const blockLines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
				if (blockLines.length === 0) {
					logger.warn('Block has no lines, skipping', { block: block.substring(0, 50) });
					continue;
				}

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
					logger.debug('Found block position via fallback', { 
						pageIndex: foundPosition.pageIndex,
						x: foundPosition.x,
						y: foundPosition.y
					});
				} else {
					logger.warn('Could not find block in extracted text, skipping annotation', { 
						block: block.substring(0, 100),
						firstLine: firstLine.substring(0, 50)
					});
					continue; // Skip if we can't find the block
				}
			} else {
				logger.debug('Found block position via text matching', { 
					pageIndex: foundPosition.pageIndex,
					x: foundPosition.x,
					y: foundPosition.y
				});
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
				warningMessage,
				pageIndex: foundPosition.pageIndex,
				xPosition,
				yPosition: foundPosition.y,
			});
		}

		// Add annotations to PDF (this preserves the original structure)
		// Make sure we're drawing the FULL search key string or warning message, not individual characters
		logger.info('Adding annotations to PDF', { annotationsCount: annotations.length });
		
		// If no annotations were created (blocks not found), fall back to simple method
		if (annotations.length === 0) {
			logger.warn('No annotations created via improved method, falling back to simple method', { 
				blocksCount: locationBlocks.length,
				textItemsCount: textItems.length
			});
			return annotatePdfWithSearchKeys(pdfBuffer, locationBlocks);
		}
		
		for (const annotation of annotations) {
			const page = pages[annotation.pageIndex];
			const textToDisplay = annotation.searchKey || annotation.warningMessage || '';
			
			if (!textToDisplay) {
				logger.warn('Skipping annotation with empty text', { block: annotation.block.substring(0, 50) });
				continue;
			}

			logger.debug('Drawing annotation', { 
				text: textToDisplay.substring(0, 50),
				pageIndex: annotation.pageIndex,
				x: annotation.xPosition,
				y: annotation.yPosition
			});

			// Calculate text width for background rectangle
			const textWidth = font.widthOfTextAtSize(textToDisplay, fontSize);
			const textHeight = fontSize;
			const padding = 2;
			
			// Draw light yellow background rectangle behind text for visibility
			page.drawRectangle({
				x: annotation.xPosition - padding,
				y: annotation.yPosition - textHeight - padding,
				width: textWidth + (padding * 2),
				height: textHeight + (padding * 2),
				color: rgb(1, 1, 0.8), // Light yellow background for better contrast
				opacity: 1.0,
			});
			
			// Draw red border around text area for visibility using lines
			const rectX = annotation.xPosition - padding;
			const rectY = annotation.yPosition - textHeight - padding;
			const rectWidth = textWidth + (padding * 2);
			const rectHeight = textHeight + (padding * 2);
			
			// Draw border using lines (pdf-lib doesn't support borderColor/borderWidth directly)
			page.drawLine({
				start: { x: rectX, y: rectY },
				end: { x: rectX + rectWidth, y: rectY },
				thickness: 1,
				color: textColor,
			});
			page.drawLine({
				start: { x: rectX + rectWidth, y: rectY },
				end: { x: rectX + rectWidth, y: rectY + rectHeight },
				thickness: 1,
				color: textColor,
			});
			page.drawLine({
				start: { x: rectX + rectWidth, y: rectY + rectHeight },
				end: { x: rectX, y: rectY + rectHeight },
				thickness: 1,
				color: textColor,
			});
			page.drawLine({
				start: { x: rectX, y: rectY + rectHeight },
				end: { x: rectX, y: rectY },
				thickness: 1,
				color: textColor,
			});

			page.drawText(textToDisplay, {
				x: annotation.xPosition,
				y: annotation.yPosition,
				size: fontSize,
				font: font,
				color: textColor,
				opacity: 1.0,
			});
		}

		const pdfBytes = await pdfDoc.save();
		logger.info('PDF annotation completed successfully', { annotationsAdded: annotations.length });
		return Buffer.from(pdfBytes);
	} catch (error: any) {
		logger.error('PDF annotation failed', { message: error?.message });
		// Fallback to simpler method if pdfjs-dist fails
		logger.warn('Falling back to simple annotation method');
		return annotatePdfWithSearchKeys(pdfBuffer, locationBlocks);
	}
}
