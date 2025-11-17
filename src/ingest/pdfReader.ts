import fs from 'node:fs/promises';
import { getLogger } from '../utils/logger';
import { createRequire } from 'module';

type PDFParseResult = {
	text: string;
	numpages?: number;
	info?: Record<string, unknown>;
	metadata?: unknown;
	version?: string;
};

async function getPdfjsLib(): Promise<any | null> {
	try {
		// Use legacy build for Node.js compatibility (avoids DOMMatrix errors)
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const dynamicImport = new Function('m', 'return import(m)');
		// @ts-expect-error any
		const pdfjsLib = await dynamicImport('pdfjs-dist/legacy/build/pdf');
		// @ts-expect-error any
		if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
			// @ts-expect-error any
			pdfjsLib.GlobalWorkerOptions.workerSrc = undefined as unknown as string;
		}
		return pdfjsLib;
	} catch {
		try {
			const require = createRequire(import.meta.url);
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const fallback = require('pdfjs-dist/legacy/build/pdf');
			if (fallback && fallback.GlobalWorkerOptions) {
				fallback.GlobalWorkerOptions.workerSrc = undefined as unknown as string;
			}
			return fallback;
		} catch {
			return null;
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
		let createCanvas: ((w: number, h: number) => any) | null = null;
		try {
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			const dynamicImport = new Function('m', 'return import(m)');
			// @ts-expect-error any
			const canvasMod = await dynamicImport('canvas');
			// @ts-expect-error canvas types
			createCanvas = (canvasMod as any).createCanvas;
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

export async function extractText(path: string): Promise<string> {
	const logger = getLogger();
	const parsed = await tryPdfParse(path);
	if (parsed && parsed.text?.trim()) {
		const pages = parsed.numpages ?? 1;
		const density = parsed.text.length / Math.max(1, pages);
		if (density < 200) {
			// Try pdfjs extraction before OCR for low-density parses
			const pdfjsRes = await tryPdfjsExtract(path);
			if (pdfjsRes?.text?.trim()) {
				logger.warn('PDF low text density; used pdfjs text extraction fallback');
				return pdfjsRes.text;
			}
			const ocrText = await tryOcrFallback(path);
			if (ocrText && ocrText.trim().length > parsed.text.trim().length) {
				logger.warn('PDF low text density; used OCR fallback');
				return ocrText;
			}
		}
		return parsed.text;
	}
	// Try pdfjs text extraction if pdf-parse failed
	const pdfjsRes = await tryPdfjsExtract(path);
	if (pdfjsRes?.text?.trim()) {
		logger.warn('PDF parse failed; used pdfjs text extraction fallback');
		return pdfjsRes.text;
	}
	const ocrText = await tryOcrFallback(path);
	if (ocrText) {
		logger.warn('PDF parse failed; used OCR fallback');
		return ocrText;
	}
	logger.warn('PDF parse failed; returning empty string');
	return '';
}


