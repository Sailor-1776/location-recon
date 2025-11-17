import fs from 'node:fs/promises';
import { getLogger } from '../utils/logger';

type PDFParseResult = {
	text: string;
	numpages?: number;
	info?: Record<string, unknown>;
	metadata?: unknown;
	version?: string;
};

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

async function tryOcrFallback(_path: string): Promise<string | null> {
	// Real OCR from PDF requires rasterizing; out of scope for tests.
	// Degrade gracefully by returning null, signaling no OCR available.
	try {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const _t = await import('tesseract.js');
		// Without rasterization, we cannot OCR PDFs here. Return null.
		return null;
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
			const ocrText = await tryOcrFallback(path);
			if (ocrText && ocrText.trim().length > parsed.text.trim().length) {
				logger.warn('PDF low text density; used OCR fallback');
				return ocrText;
			}
		}
		return parsed.text;
	}
	const ocrText = await tryOcrFallback(path);
	if (ocrText) {
		logger.warn('PDF parse failed; used OCR fallback');
		return ocrText;
	}
	logger.warn('PDF parse failed; returning empty string');
	return '';
}


