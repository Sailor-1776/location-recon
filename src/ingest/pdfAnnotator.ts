import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getLogger } from '../utils/logger';
import type { PdfTextExtraction } from './pdfReader';
import type { BlockWithPosition } from './textUtils';

const logger = getLogger();

type AnnotatableBlock = {
	block: string;
	searchKey?: string;
	warningMessage?: string;
	// Position data captured during block identification
	pageIndex?: number;
	y?: number;
	x?: number;
	maxX?: number;
	facilityNameLine?: string;
};

type PageLine = {
	text: string;
	normalized: string;
	lineIndex: number;
	x?: number;
	maxX?: number;
	y?: number;
};

type PageLines = PageLine[][];

type BlockPlacement = {
	pageIndex: number;
	x: number;
	y: number;
	text: string;
	blockPreview: string;
};

const TOP_MARGIN = 60;
const BOTTOM_MARGIN = 40;
const LINE_HEIGHT = 16;
const VERTICAL_GAP = 18;
const MIN_SIMILARITY = 0.55;
const DEFAULT_LINES_PER_PAGE = 45;

const normalize = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const tokenize = (value: string): Set<string> =>
	new Set(
		normalize(value)
			.split(' ')
			.filter(Boolean)
	);

function similarity(a: string, b: string): number {
	if (!a || !b) return 0;
	if (a === b) return 1;
	if (a.includes(b) || b.includes(a)) {
		return Math.min(a.length, b.length) / Math.max(a.length, b.length);
	}

	const tokensA = tokenize(a);
	const tokensB = tokenize(b);
	if (tokensA.size === 0 || tokensB.size === 0) return 0;

	let overlap = 0;
	for (const token of tokensA) {
		if (tokensB.has(token)) {
			overlap++;
		}
	}
	return overlap / new Set([...tokensA, ...tokensB]).size;
}

function buildPageLines(textSource: PdfTextExtraction | string | undefined, pageCount: number): PageLines {
	const safePageCount = Math.max(pageCount, 1);

	const positionalPages = typeof textSource === 'object' && textSource !== null && 'text' in textSource ? textSource.pages : undefined;
	if (positionalPages?.length) {
		const result: PageLines = [];
		for (let pageIndex = 0; pageIndex < safePageCount; pageIndex++) {
			const page = positionalPages[pageIndex];
			if (!page) {
				result.push([]);
				continue;
			}
			result.push(
				page.lines.map(line => ({
					text: line.text,
					normalized: normalize(line.text),
					lineIndex: line.lineIndex,
					x: Number.isFinite(line.x) ? line.x : undefined,
					maxX: Number.isFinite(line.maxX) ? line.maxX : undefined,
					y: Number.isFinite(line.y) ? line.y : undefined,
				}))
			);
		}
		return result;
	}

	const text = typeof textSource === 'string' ? textSource : textSource?.text;
	if (!text?.length) {
		return Array.from({ length: safePageCount }, () => []);
	}

	const normalized = text.replace(/\r\n/g, '\n');
	const segments = normalized.split(/\f+/);

	const mapSegmentToLines = (segment: string): PageLine[] =>
		segment.split('\n').map((line, idx) => {
			const trimmed = line.trim();
			return {
				text: trimmed,
				normalized: trimmed ? normalize(trimmed) : '',
				lineIndex: idx,
			};
		});

	if (segments.length === safePageCount) {
		return segments.map(mapSegmentToLines);
	}

	const lines = normalized.split('\n');
	const perPage = Math.max(1, Math.ceil(lines.length / safePageCount));
	const result: PageLines = [];
	for (let pageIndex = 0; pageIndex < safePageCount; pageIndex++) {
		const start = pageIndex * perPage;
		const end = start + perPage;
		result.push(
			lines.slice(start, end).map((line, idx) => {
				const trimmed = line.trim();
				return {
					text: trimmed,
					normalized: trimmed ? normalize(trimmed) : '',
					lineIndex: idx,
				};
			})
		);
	}
	return result;
}

function searchCandidateOnPages(
	candidate: string,
	pageLines: PageLines,
	targetPageIndex?: number
): { pageIndex: number; lineIndex: number; score: number; line: PageLine } | null {
	let best: { pageIndex: number; lineIndex: number; score: number; line: PageLine } | null = null;
	const pageIndexes =
		typeof targetPageIndex === 'number' && Number.isInteger(targetPageIndex)
			? [targetPageIndex]
			: pageLines.map((_, idx) => idx);

	for (const pageIndex of pageIndexes) {
		const lines = pageLines[pageIndex];
		if (!lines) continue;
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex]!;
			if (!line.text) continue;
			const score = similarity(candidate, line.text);
			if (score > (best?.score ?? 0)) {
				best = { pageIndex, lineIndex, score, line };
			}
		}
	}

	return best;
}

function findAnchor(
	block: string,
	pageLines: PageLines
): { pageIndex: number; lineIndex: number; score: number; line: PageLine } | null {
	const rawLines = block
		.split(/\r?\n/)
		.map(line => line.trim());
	const blockLines = rawLines.filter(line => line.length > 0);

	if (blockLines.length === 0) {
		return null;
	}

	if (rawLines[0] === '') {
		logger.warn('Top line of text block is empty; skipping to next line for facility name anchor.', {
			blockPreview: block.substring(0, 120),
		});
	}

	const primaryCandidate = blockLines[0]; // Facility name (FIRST LINE - TOP OF BLOCK)
	const fallbackCandidate = blockLines[1]; // Address line

	if (!primaryCandidate) {
		return null;
	}

	// CRITICAL: Always prioritize facility name line (first line)
	// Search for facility name first with a lower threshold to ensure we find it
	const primaryMatch = searchCandidateOnPages(primaryCandidate, pageLines);
	
	// If we find the facility name with any reasonable match, use it
	if (primaryMatch && primaryMatch.score >= MIN_SIMILARITY) {
		logger.debug('Found facility name line anchor', {
			facilityName: primaryCandidate,
			score: primaryMatch.score,
			pageIndex: primaryMatch.pageIndex,
			y: primaryMatch.line.y,
		});
		return primaryMatch;
	}

	// Only use address line as fallback if facility name truly cannot be found
	// But when we do, try to find facility name on the same page
	if (fallbackCandidate) {
		const fallbackMatch = searchCandidateOnPages(fallbackCandidate, pageLines);
		if (fallbackMatch && fallbackMatch.score >= MIN_SIMILARITY) {
			// Try harder to find facility name on the same page where address was found
			const primaryOnFallbackPage = searchCandidateOnPages(primaryCandidate, pageLines, fallbackMatch.pageIndex);
			if (primaryOnFallbackPage && primaryOnFallbackPage.score >= 0.3) {
				// Even a weak match on the same page is better than using address line
				logger.info('Found facility name on same page as address (using facility name Y coordinate)', {
					facilityName: primaryCandidate,
					address: fallbackCandidate,
					facilityScore: primaryOnFallbackPage.score,
					pageIndex: primaryOnFallbackPage.pageIndex,
					y: primaryOnFallbackPage.line.y,
				});
				return primaryOnFallbackPage;
			}

			logger.warn('Facility name was not found on the fallback page; using address line Y coordinate (NOT IDEAL)', {
				facilityName: primaryCandidate,
				fallbackLine: fallbackCandidate,
				blockPreview: block.substring(0, 120),
				pageIndex: fallbackMatch.pageIndex,
				y: fallbackMatch.line.y,
			});
			return fallbackMatch;
		}
	}

	logger.warn('Could not find anchor for block', {
		blockPreview: block.substring(0, 120),
		facilityName: primaryCandidate,
	});
	return null;
}

function distributeFallbackPage(blockIndex: number, totalBlocks: number, pageCount: number): number {
	if (pageCount <= 0) return 0;
	if (totalBlocks === 0) return 0;
	const perPage = Math.max(1, Math.ceil(totalBlocks / pageCount));
	return Math.min(pageCount - 1, Math.floor(blockIndex / perPage));
}

function clampY(value: number, pageHeight: number): number {
	const top = pageHeight - TOP_MARGIN;
	const bottom = BOTTOM_MARGIN;
	return Math.max(bottom, Math.min(top, value));
}

function reserveY(
	pageIndex: number,
	suggestedY: number,
	pageCursors: number[],
	pageHeight: number
): number {
	const cursor = pageCursors[pageIndex] ?? (pageHeight - TOP_MARGIN);
	const chosen = clampY(Math.min(suggestedY, cursor), pageHeight);
	pageCursors[pageIndex] = chosen - VERTICAL_GAP;
	return chosen;
}

function buildResearchPlacements(pageCount: number, pages: ReturnType<PDFDocument['getPages']>, label: string): BlockPlacement[] {
	const text = label || 'RESEARCH REQUIRED';
	const placements: BlockPlacement[] = [];
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
		const page = pages[pageIndex];
		if (!page) continue;
		const { width, height } = page.getSize();
		placements.push({
			pageIndex,
			x: width * 0.68,
			y: height - TOP_MARGIN,
			text,
			blockPreview: text,
		});
	}
	return placements;
}

function clampHorizontalTarget(value: number, pageWidth: number): number {
	const minX = 40;
	const maxX = Math.max(minX, pageWidth - 40);
	if (!Number.isFinite(value)) {
		return maxX;
	}
	return Math.max(minX, Math.min(value, maxX));
}

function preparePlacements(
	blocks: AnnotatableBlock[],
	pages: ReturnType<PDFDocument['getPages']>,
	pageLines: PageLines
): BlockPlacement[] {
	const placements: BlockPlacement[] = [];
	const actionable = blocks.filter(block => block && (block.searchKey || block.warningMessage));
	if (actionable.length === 0) {
		return placements;
	}

	const pageCursors = pages.map(page => page.getSize().height - TOP_MARGIN);

	for (let index = 0; index < actionable.length; index++) {
		const block = actionable[index]!;
		const text = block.searchKey ?? block.warningMessage ?? '';
		if (!text) continue;

		// PRIORITY 1: Use captured Y coordinate from block identification (most accurate)
		let safePageIndex: number;
		let y: number;
		let anchorMaxX: number | undefined;

		// Check if we have valid captured position data
		const hasValidPosition = typeof block.y === 'number' && 
		                         block.y > 0 && 
		                         typeof block.pageIndex === 'number' &&
		                         block.pageIndex >= 0;

		if (hasValidPosition && typeof block.pageIndex === 'number' && typeof block.y === 'number') {
			// We have captured position data from block identification
			safePageIndex = Math.max(0, Math.min(block.pageIndex, pages.length - 1));
			const page = pages[safePageIndex];
			if (!page) {
				// Fallback if page doesn't exist
				logger.warn('Page not found for captured position, falling back to search', {
					requestedPageIndex: block.pageIndex,
					totalPages: pages.length,
					blockPreview: block.block.substring(0, 100),
				});
				// Fall through to search-based approach
			} else {
				const { width, height } = page.getSize();
				
				// Use the captured Y coordinate directly (this is the facility name line's Y position)
				// This Y coordinate is from the PDF's coordinate system where Y increases upward
				y = clampY(block.y, height);
				anchorMaxX = block.maxX;
				
				// Update cursor to prevent future annotations from overlapping
				const currentCursor = pageCursors[safePageIndex] ?? (height - TOP_MARGIN);
				if (y <= currentCursor) {
					pageCursors[safePageIndex] = y - VERTICAL_GAP;
				}
				
				logger.info('Using captured Y coordinate from block identification', {
					blockPreview: block.block.substring(0, 100),
					facilityNameLine: block.facilityNameLine,
					pageIndex: safePageIndex,
					rawY: block.y,
					clampedY: y,
					pageHeight: height,
					hasMaxX: typeof block.maxX === 'number',
				});
				
				// Skip the fallback search - we have valid position data
				const defaultX = Math.max(width * 0.65, width - 180);
				const desiredX = anchorMaxX !== undefined ? Math.max(defaultX, anchorMaxX + 12) : defaultX;
				const x = clampHorizontalTarget(desiredX, width);

				placements.push({
					pageIndex: safePageIndex,
					x,
					y,
					text,
					blockPreview: block.block.substring(0, 120),
				});
				continue; // Skip to next block
			}
		}
		
		// FALLBACK: Use search-based approach if no captured position data or if page lookup failed
		logger.info('Using fallback search-based positioning', {
			blockPreview: block.block.substring(0, 100),
			hasY: typeof block.y === 'number',
			hasPageIndex: typeof block.pageIndex === 'number',
			blockY: block.y,
			blockPageIndex: block.pageIndex,
		});
		
		// CRITICAL: findAnchor now prioritizes facility name line, but we need to ensure
		// we're using the facility name line's Y coordinate, not the address line
		const anchor = findAnchor(block.block, pageLines);
		const pageIndex = anchor?.pageIndex ?? distributeFallbackPage(index, actionable.length, pages.length);
		safePageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
		const page = pages[safePageIndex];
		if (!page) continue;
		const { width, height } = page.getSize();

		// Extract facility name line from block
		const blockLines = block.block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
		const facilityNameLine = blockLines[0] || block.facilityNameLine || '';
		
		// Try to find facility name line specifically on the anchor's page
		let facilityNameY: number | undefined;
		if (facilityNameLine && anchor) {
			const pageLineEntries = pageLines[safePageIndex] ?? [];
			// Search for facility name line on this page
			for (const pageLine of pageLineEntries) {
				if (pageLine.text && similarity(facilityNameLine, pageLine.text) >= 0.5) {
					if (typeof pageLine.y === 'number') {
						facilityNameY = pageLine.y;
						logger.info('Found facility name line Y coordinate in fallback search', {
							facilityName: facilityNameLine,
							y: facilityNameY,
							pageIndex: safePageIndex,
						});
						break;
					}
				}
			}
		}
		
		const pageLineEntries = pageLines[safePageIndex] ?? [];
		const fallbackLineIndex = pageLineEntries.length > 0 ? index % pageLineEntries.length : index % DEFAULT_LINES_PER_PAGE;
		const estimatedLine = anchor?.line?.lineIndex ?? anchor?.lineIndex ?? fallbackLineIndex;
		const anchorY = anchor?.line?.y;
		
		// PRIORITY: Use facility name Y coordinate if we found it, otherwise use anchor Y
		if (typeof facilityNameY === 'number') {
			// We found the facility name line's Y coordinate - use it!
			y = clampY(facilityNameY, height);
			const currentCursor = pageCursors[safePageIndex] ?? (height - TOP_MARGIN);
			if (y <= currentCursor) {
				pageCursors[safePageIndex] = y - VERTICAL_GAP;
			}
			anchorMaxX = anchor?.line?.maxX;
		} else if (typeof anchorY === 'number') {
			// Use anchor Y directly (should be facility name line if findAnchor worked correctly)
			y = clampY(anchorY, height);
			const currentCursor = pageCursors[safePageIndex] ?? (height - TOP_MARGIN);
			if (y <= currentCursor) {
				pageCursors[safePageIndex] = y - VERTICAL_GAP;
			}
			anchorMaxX = anchor?.line?.maxX;
		} else {
			// Fallback: calculate Y based on estimated line position
			const suggestedY = height - TOP_MARGIN - estimatedLine * LINE_HEIGHT;
			y = reserveY(safePageIndex, suggestedY, pageCursors, height);
			anchorMaxX = anchor?.line?.maxX;
		}
		
		const defaultX = Math.max(width * 0.65, width - 180);
		const desiredX = anchorMaxX !== undefined ? Math.max(defaultX, anchorMaxX + 12) : defaultX;
		const x = clampHorizontalTarget(desiredX, width);

		placements.push({
			pageIndex: safePageIndex,
			x,
			y,
			text,
			blockPreview: block.block.substring(0, 120),
		});
	}

	return placements;
}

function resolveTextX(desiredX: number, pageWidth: number, textWidth: number, padding: number): number {
	const minX = 40;
	const maxX = Math.max(minX, pageWidth - (textWidth + padding * 2) - 4);
	if (maxX <= minX) return minX;
	return Math.max(minX, Math.min(desiredX, maxX));
}

function drawPlacements(
	pdfDoc: PDFDocument,
	placements: BlockPlacement[],
	font: Awaited<ReturnType<typeof pdfDoc.embedFont>>,
	fontSize: number
): void {
	const pages = pdfDoc.getPages();

	for (const placement of placements) {
		const page = pages[placement.pageIndex];
		if (!page) continue;
		const { width: pageWidth } = page.getSize();
		const textWidth = font.widthOfTextAtSize(placement.text, fontSize);
		const textHeight = fontSize;
		const padding = 3;
		const actualX = resolveTextX(placement.x, pageWidth, textWidth, padding);

		page.drawText(placement.text, {
			x: actualX,
			y: placement.y,
			size: fontSize,
			font,
			color: rgb(1, 0, 0),
		});
	}
}

async function annotatePdfOneShot(
	pdfBuffer: Buffer,
	locationBlocks: AnnotatableBlock[],
	extractedText?: PdfTextExtraction | string
): Promise<Buffer> {
	const pdfDoc = await PDFDocument.load(pdfBuffer);
	const pages = pdfDoc.getPages();
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const pageLines = buildPageLines(extractedText, pages.length);

	const placements = preparePlacements(locationBlocks, pages, pageLines);

	if (placements.length === 0) {
		logger.warn('No actionable blocks detected; adding RESEARCH REQUIRED markers');
		const fallbackPlacements = buildResearchPlacements(pages.length, pages, 'RESEARCH REQUIRED');
		drawPlacements(pdfDoc, fallbackPlacements, font, 16);
		const fallbackBytes = await pdfDoc.save();
		return Buffer.from(fallbackBytes);
	}

	logger.info('Annotating PDF with single-pass strategy', {
		pages: pages.length,
		annotations: placements.length,
	});

	drawPlacements(pdfDoc, placements, font, 16);
	const pdfBytes = await pdfDoc.save();
	return Buffer.from(pdfBytes);
}

export async function annotatePdfWithSearchKeys(
	pdfBuffer: Buffer,
	locationBlocks: AnnotatableBlock[],
	extractedText?: PdfTextExtraction | string
): Promise<Buffer> {
	return annotatePdfOneShot(pdfBuffer, locationBlocks, extractedText);
}

export async function annotatePdfWithSearchKeysImproved(
	pdfBuffer: Buffer,
	locationBlocks: AnnotatableBlock[],
	extractedText?: PdfTextExtraction | string
): Promise<Buffer> {
	return annotatePdfOneShot(pdfBuffer, locationBlocks, extractedText);
}

