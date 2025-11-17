import fs from 'node:fs/promises';
import { simpleParser } from 'mailparser';
import { getLogger } from '../utils/logger';

async function parseEml(path: string): Promise<string> {
	const buf = await fs.readFile(path);
	const mail = await simpleParser(buf);
	const parts = [mail.subject, mail.text, mail.html]
		.filter(Boolean)
		.map((s) => String(s))
		.join('\n');
	return parts;
}

async function parseMsg(path: string): Promise<string> {
	const logger = getLogger();
	try {
		const buf = await fs.readFile(path);
		const { default: MSGReader } = await import('msgreader');
		const reader = new MSGReader(buf);
		const msg = reader.getFileData();
		const subject = (msg?.subject as string) || '';
		const body = (msg?.body as string) || '';
		return [subject, body].filter(Boolean).join('\n');
	} catch (e) {
		logger.warn('MSG parsing failed, returning empty string');
		return '';
	}
}

export async function extractText(path: string): Promise<string> {
	if (path.toLowerCase().endsWith('.eml')) {
		return parseEml(path);
	}
	if (path.toLowerCase().endsWith('.msg')) {
		return parseMsg(path);
	}
	throw new Error('Unsupported email format. Expected .eml or .msg');
}


