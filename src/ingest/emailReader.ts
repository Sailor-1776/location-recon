import fs from 'node:fs/promises';
import { simpleParser, ParsedMail } from 'mailparser';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export interface StructuredEmail {
	headers: {
		from?: string;
		to?: string[];
		cc?: string[];
		bcc?: string[];
		subject?: string;
		date?: Date;
		messageId?: string;
		references?: string[];
		inReplyTo?: string;
		replyTo?: string;
	};
	text: string;
	html?: string;
	attachments: Array<{
		filename: string;
		contentType: string;
		content: Buffer;
		contentId?: string;
		size: number;
	}>;
	// For backward compatibility - combined text for location extraction
	extractedText: string;
	// Raw parsed mail object for additional metadata
	raw: ParsedMail;
}

async function parseEmlStructured(path: string): Promise<StructuredEmail> {
	const buf = await fs.readFile(path);
	const mail = await simpleParser(buf);
	
	const from = mail.from?.text || (mail.from as any)?.value?.[0]?.address || '';
	const to = mail.to ? (Array.isArray(mail.to) ? mail.to : [mail.to]).map((a: any) => a.text || a.value?.[0]?.address || '').filter(Boolean) : [];
	const cc = mail.cc ? (Array.isArray(mail.cc) ? mail.cc : [mail.cc]).map((a: any) => a.text || a.value?.[0]?.address || '').filter(Boolean) : [];
	const bcc = mail.bcc ? (Array.isArray(mail.bcc) ? mail.bcc : [mail.bcc]).map((a: any) => a.text || a.value?.[0]?.address || '').filter(Boolean) : [];
	
	return {
		headers: {
			from,
			to,
			cc,
			bcc,
			subject: mail.subject || undefined,
			date: mail.date || undefined,
			messageId: mail.messageId || undefined,
			references: mail.references ? (Array.isArray(mail.references) ? mail.references : [mail.references]) : undefined,
			inReplyTo: mail.inReplyTo || undefined,
			replyTo: mail.replyTo?.text || (mail.replyTo as any)?.value?.[0]?.address || undefined,
		},
		text: mail.text || '',
		html: mail.html ? String(mail.html) : undefined,
		attachments: (mail.attachments || []).map((att: any) => ({
			filename: att.filename || att.contentId || 'unnamed',
			contentType: att.contentType || 'application/octet-stream',
			content: att.content as Buffer,
			contentId: att.contentId || undefined,
			size: att.size || 0,
		})),
		extractedText: [mail.subject, mail.text, mail.html]
			.filter(Boolean)
			.map(s => String(s))
			.join('\n'),
		raw: mail,
	};
}

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

export async function parseEmailStructured(path: string): Promise<StructuredEmail> {
	if (path.toLowerCase().endsWith('.eml')) {
		return parseEmlStructured(path);
	}
	throw new Error('Structured parsing only supported for .eml files');
}

export async function parseEmailStructuredFromBuffer(buffer: Buffer): Promise<StructuredEmail> {
	const mail = await simpleParser(buffer);
	
	const from = mail.from?.text || (mail.from as any)?.value?.[0]?.address || '';
	const to = mail.to ? (Array.isArray(mail.to) ? mail.to : [mail.to]).map((a: any) => a.text || a.value?.[0]?.address || '').filter(Boolean) : [];
	const cc = mail.cc ? (Array.isArray(mail.cc) ? mail.cc : [mail.cc]).map((a: any) => a.text || a.value?.[0]?.address || '').filter(Boolean) : [];
	const bcc = mail.bcc ? (Array.isArray(mail.bcc) ? mail.bcc : [mail.bcc]).map((a: any) => a.text || a.value?.[0]?.address || '').filter(Boolean) : [];
	
	return {
		headers: {
			from,
			to,
			cc,
			bcc,
			subject: mail.subject || undefined,
			date: mail.date || undefined,
			messageId: mail.messageId || undefined,
			references: mail.references ? (Array.isArray(mail.references) ? mail.references : [mail.references]) : undefined,
			inReplyTo: mail.inReplyTo || undefined,
			replyTo: mail.replyTo?.text || (mail.replyTo as any)?.value?.[0]?.address || undefined,
		},
		text: mail.text || '',
		html: mail.html ? String(mail.html) : undefined,
		attachments: (mail.attachments || []).map((att: any) => ({
			filename: att.filename || att.contentId || 'unnamed',
			contentType: att.contentType || 'application/octet-stream',
			content: att.content as Buffer,
			contentId: att.contentId || undefined,
			size: att.size || 0,
		})),
		extractedText: [mail.subject, mail.text, mail.html]
			.filter(Boolean)
			.map(s => String(s))
			.join('\n'),
		raw: mail,
	};
}


