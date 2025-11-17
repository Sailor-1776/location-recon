import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getLogger } from '../utils/logger';

const logger = getLogger();

type AnnotatableBlock = {
	block: string;
	searchKey?: string;
	warningMessage?: string;
};

type PageLines = string[][];

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

function splitTextByPages(text: string | undefined, pageCount: number): PageLines {
	if (!text?.trim() || pageCount <= 0) {
		return Array.from({ length: Math.max(pageCount, 1) }, () => []);
	}

	const normalized = text.replace(/\r\n/g, '\n');
	let segments = normalized.split(/\f+/).filter(segment => segment.trim().length > 0);

	if (segments.length === pageCount) {
		return segments.map(segment =>
			segment
				.split('\n')
				.map(line => line.trim())
				.filter(line => line.length > 0)
		);
	}

	const lines = normalized
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0);

	const perPage = Math.max(1, Math.ceil(lines.length / Math.max(pageCount, 1)));
	const result: PageLines = [];
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
		const start = pageIndex * perPage;
		const end = start + perPage;
		result.push(lines.slice(start, end));
	}
	return result;
}

function findAnchor(block: string, pageLines: PageLines): { pageIndex: number; lineIndex: number; score: number } | null {
	const blockLines = block
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0);

	if (blockLines.length === 0) {
		return null;
	}

	const candidates = [blockLines[0], blockLines[1]].filter(Boolean);
	let best: { pageIndex: number; lineIndex: number; score: number } | null = null;

	for (let pageIndex = 0; pageIndex < pageLines.length; pageIndex++) {
		const lines = pageLines[pageIndex];
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex]!;
			for (const candidate of candidates) {
				const score = similarity(candidate, line);
				if (score > (best?.score ?? 0)) {
					best = { pageIndex, lineIndex, score };
				}
			}
		}
	}

	if (best && best.score >= MIN_SIMILARITY) {
		return best;
	}

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

		const anchor = findAnchor(block.block, pageLines);
		const pageIndex = anchor?.pageIndex ?? distributeFallbackPage(index, actionable.length, pages.length);
		const safePageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
		const page = pages[safePageIndex];
		const { width, height } = page.getSize();

		const estimatedLine = anchor?.lineIndex ?? (index % (pageLines[safePageIndex]?.length || DEFAULT_LINES_PER_PAGE));
		const suggestedY = height - TOP_MARGIN - estimatedLine * LINE_HEIGHT;
		const y = reserveY(safePageIndex, suggestedY, pageCursors, height);
		const x = Math.max(width * 0.65, width - 180);

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

function drawPlacements(
	pdfDoc: PDFDocument,
	placements: BlockPlacement[],
	font: ReturnType<typeof pdfDoc.embedFont>,
	fontSize: number
): void {
	const pages = pdfDoc.getPages();

	for (const placement of placements) {
		const page = pages[placement.pageIndex];
		const textWidth = font.widthOfTextAtSize(placement.text, fontSize);
		const textHeight = fontSize;
		const padding = 3;

		page.drawRectangle({
			x: placement.x - padding,
			y: placement.y - textHeight - padding,
			width: textWidth + padding * 2,
			height: textHeight + padding * 2,
			color: rgb(1, 1, 0.8),
		});

		page.drawLine({
			start: { x: placement.x - padding, y: placement.y - textHeight - padding },
			end: { x: placement.x + textWidth + padding, y: placement.y - textHeight - padding },
			thickness: 1,
			color: rgb(1, 0, 0),
		});
		page.drawLine({
			start: { x: placement.x + textWidth + padding, y: placement.y - textHeight - padding },
			end: { x: placement.x + textWidth + padding, y: placement.y + padding },
			thickness: 1,
			color: rgb(1, 0, 0),
		});
		page.drawLine({
			start: { x: placement.x + textWidth + padding, y: placement.y + padding },
			end: { x: placement.x - padding, y: placement.y + padding },
			thickness: 1,
			color: rgb(1, 0, 0),
		});
		page.drawLine({
			start: { x: placement.x - padding, y: placement.y + padding },
			end: { x: placement.x - padding, y: placement.y - textHeight - padding },
			thickness: 1,
			color: rgb(1, 0, 0),
		});

		page.drawText(placement.text, {
			x: placement.x,
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
	extractedText?: string
): Promise<Buffer> {
	const pdfDoc = await PDFDocument.load(pdfBuffer);
	const pages = pdfDoc.getPages();
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const pageLines = splitTextByPages(extractedText, pages.length);

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
	extractedText?: string
): Promise<Buffer> {
	return annotatePdfOneShot(pdfBuffer, locationBlocks, extractedText);
}

export async function annotatePdfWithSearchKeysImproved(
	pdfBuffer: Buffer,
	locationBlocks: AnnotatableBlock[],
	extractedText: string
): Promise<Buffer> {
	return annotatePdfOneShot(pdfBuffer, locationBlocks, extractedText);
}

