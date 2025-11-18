import fs from 'node:fs/promises';
import { getLogger } from '../utils/logger';
import { createRequire } from 'module';
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf';

export type PdfTextLine = {
	text: string;
	x: number;
	maxX: number;
	y: number;
	width: number;
	lineIndex: number;
};

export type PdfTextPage = {
	width: number;
	height: number;
	lines: PdfTextLine[];
};

export type PdfTextExtraction = {
	text: string;
	pages?: PdfTextPage[];
};

type PDFParseResult = {
	text: string;
	numpages?: number;
	info?: Record<string, unknown>;
	metadata?: unknown;
	version?: string;
};

type PdfJsLib = typeof PdfJsModule;
type CanvasFactory = (width: number, height: number) => {
	getContext: (contextId: string) => unknown;
	toBuffer: (format: string) => Buffer;
};

const LINE_JOIN_THRESHOLD = 2; // points
const WORD_GAP_THRESHOLD = 2; // points

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function fallbackWidthForText(text: string): number {
	return Math.max(text.length, 1) * 4;
}

type RawTextItem = {
	str?: string;
	transform?: number[];
	width?: number;
	textMatrix?: number[];
};

function groupItemsIntoLines(items: RawTextItem[]): PdfTextLine[] {
	const processed = items
		.filter((item) => typeof item?.str === 'string' && item.str.trim().length > 0)
		.map((item) => {
			const transform = Array.isArray(item.transform)
				? item.transform
				: Array.isArray(item.textMatrix)
					? item.textMatrix
					: undefined;
			const x = isFiniteNumber(transform?.[4]) ? transform![4] : 0;
			const y = isFiniteNumber(transform?.[5]) ? transform![5] : 0;
			const width = isFiniteNumber(item.width) && item.width > 0 ? item.width : fallbackWidthForText(item.str!.trim());
			return {
				text: item.str!.replace(/\s+/g, ' '),
				x,
				y,
				width,
			};
		})
		.sort((a, b) => {
			const deltaY = b.y - a.y;
			if (Math.abs(deltaY) > LINE_JOIN_THRESHOLD) {
				return deltaY;
			}
			return a.x - b.x;
		});

	const grouped: Array<{ textParts: string[]; xMin: number; xMax: number; y: number; lastX: number }> = [];
	for (const item of processed) {
		const last = grouped[grouped.length - 1];
		const endX = item.x + item.width;
		if (!last || Math.abs(item.y - last.y) > LINE_JOIN_THRESHOLD) {
			grouped.push({
				textParts: [item.text],
				xMin: item.x,
				xMax: endX,
				y: item.y,
				lastX: endX,
			});
			continue;
		}

		const gap = item.x - last.lastX;
		if (gap > WORD_GAP_THRESHOLD) {
			last.textParts.push(' ');
		}
		last.textParts.push(item.text);
		last.xMin = Math.min(last.xMin, item.x);
		last.xMax = Math.max(last.xMax, endX);
		last.lastX = Math.max(last.lastX, endX);
	}

	return grouped
		.map((line, idx) => ({
			text: line.textParts.join('').trim(),
			x: line.xMin,
			maxX: line.xMax,
			y: line.y,
			width: Math.max(line.xMax - line.xMin, 0),
			lineIndex: idx,
		}))
		.filter((line) => line.text.length > 0);
}

async function extractLayoutWithPdfjs(path: string, logger: ReturnType<typeof getLogger>): Promise<PdfTextPage[] | null> {
	try {
		const pdfjsLib = await getPdfjsLib();
		if (!pdfjsLib) return null;
		const buf = await fs.readFile(path);
		const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableWorker: true });
		const pdf = await loadingTask.promise;
		const pages: PdfTextPage[] = [];
		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const page = await pdf.getPage(pageNum);
			const viewport = page.getViewport({ scale: 1.0 });
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const content = await page.getTextContent();
			const lines = groupItemsIntoLines((content.items ?? []) as RawTextItem[]);
			pages.push({
				width: viewport.width,
				height: viewport.height,
				lines,
			});
		}
		return pages;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn?.('Failed to extract PDF layout metadata', { message });
		return null;
	}
}

async function getPdfjsLib(): Promise<PdfJsLib | null> {
	// Use legacy build for Node.js compatibility (avoids DOMMatrix errors)
	// pdfjs-dist is externalized in Next.js, so we need to use dynamic imports
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const dynamicImport = new Function('m', 'return import(m)');
	
	// Try .mjs extension first (for pdfjs-dist 5.4+)
	try {
		const pdfjsLib = (await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJsLib;
		// Don't set workerSrc in Node.js - it's not needed and causes errors
		return pdfjsLib;
	} catch (mjsError) {
		// Fallback to non-.mjs path (for older versions or if .mjs fails)
		try {
			const pdfjsLib = (await dynamicImport('pdfjs-dist/legacy/build/pdf')) as PdfJsLib;
			return pdfjsLib;
		} catch (legacyError) {
			// Last resort: try require() for CommonJS builds (won't work for .mjs files)
			try {
				const require = createRequire(import.meta.url);
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const fallback = require('pdfjs-dist/legacy/build/pdf') as PdfJsLib;
				return fallback;
			} catch {
				// All methods failed
				return null;
			}
		}
	}
}

async function tryPdfjsExtract(path: string): Promise<PDFParseResult | null> {
	try {
		const pdfjsLib = await getPdfjsLib();
		if (!pdfjsLib) return null;
		const buf = await fs.readFile(path);
		const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableWorker: true });
		const pdf = await loadingTask.promise;
		let text = '';
		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const page = await pdf.getPage(pageNum);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const content = await page.getTextContent();
			// @ts-expect-error content.items is any[]
			for (const item of content.items) {
				if ('str' in item && typeof item.str === 'string') {
					text += item.str + '\n';
				}
			}
			text += '\n';
		}
		return { text: text || '', numpages: pdf.numPages, info: {}, metadata: undefined, version: undefined };
	} catch {
		return null;
	}
}

async function tryPdfParse(path: string): Promise<PDFParseResult | null> {
	try {
		// pdf-parse uses a default export function
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pdfParse: any = (await import('pdf-parse')).default;
		const buf = await fs.readFile(path);
		const res: PDFParseResult = await pdfParse(buf);
		return res;
	} catch {
		return null;
	}
}

async function tryOcrFallback(path: string): Promise<string | null> {
	try {
		// Try to rasterize first page with pdfjs + node-canvas (optional)
		const pdfjsLib = await getPdfjsLib();
		if (!pdfjsLib) return null;
		// Optional dependency: canvas. Use obfuscated dynamic import to avoid bundler hard failure.
		let createCanvas: CanvasFactory | null = null;
		try {
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			const dynamicImport = new Function('m', 'return import(m)');
			const canvasMod = await dynamicImport('canvas');
			if (canvasMod && typeof canvasMod.createCanvas === 'function') {
				createCanvas = canvasMod.createCanvas as CanvasFactory;
			}
		} catch {
			createCanvas = null;
		}
		if (!createCanvas) return null;

		const buf = await fs.readFile(path);
		const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true });
		const pdf = await loadingTask.promise;
		// Render first page only for a "lightweight" OCR hint
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const page = await pdf.getPage(1);
		const viewport = page.getViewport({ scale: 2.0 });
		const canvas = createCanvas(viewport.width, viewport.height);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const ctx = canvas.getContext('2d');
		// Minimal canvasFactory to satisfy pdfjs
		const renderContext = {
			canvasContext: ctx,
			viewport,
		};
		// @ts-expect-error render any
		await page.render(renderContext).promise;

		// Now OCR with tesseract.js (optional)
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { createWorker } = await import('tesseract.js');
		const worker = await createWorker({
			logger: () => {},
		});
		await worker.loadLanguage('eng');
		await worker.initialize('eng');
		// @ts-expect-error toBuffer on node-canvas
		const img = canvas.toBuffer('image/png');
		// @ts-expect-error any
		const { data } = await worker.recognize(img);
		await worker.terminate();
		const text = (data?.text || '').trim();
		return text || null;
	} catch {
		return null;
	}
}

export async function extractText(path: string): Promise<PdfTextExtraction> {
	const logger = getLogger();
	let text = '';
	const parsed = await tryPdfParse(path);
	if (parsed && parsed.text?.trim()) {
		const pages = parsed.numpages ?? 1;
		const density = parsed.text.length / Math.max(1, pages);
		if (density < 200) {
			// Try pdfjs extraction before OCR for low-density parses
			const pdfjsRes = await tryPdfjsExtract(path);
			if (pdfjsRes?.text?.trim()) {
				logger.warn('PDF low text density; used pdfjs text extraction fallback');
				text = pdfjsRes.text;
			} else {
				const ocrText = await tryOcrFallback(path);
				if (ocrText && ocrText.trim().length > parsed.text.trim().length) {
					logger.warn('PDF low text density; used OCR fallback');
					text = ocrText;
				} else {
					text = parsed.text;
				}
			}
		} else {
			text = parsed.text;
		}
	} else {
		// Try pdfjs text extraction if pdf-parse failed
		const pdfjsRes = await tryPdfjsExtract(path);
		if (pdfjsRes?.text?.trim()) {
			logger.warn('PDF parse failed; used pdfjs text extraction fallback');
			text = pdfjsRes.text;
		} else {
			const ocrText = await tryOcrFallback(path);
			if (ocrText) {
				logger.warn('PDF parse failed; used OCR fallback');
				text = ocrText;
			} else {
				logger.warn('PDF parse failed; returning empty string');
				text = '';
			}
		}
	}

	const layoutPages = await extractLayoutWithPdfjs(path, logger);

	return {
		text,
		pages: layoutPages ?? undefined,
	};
}


