import { NextRequest, NextResponse } from 'next/server';
import { extractCandidateBlocks, extractStructuredFacilities } from '../../../../../ingest/textUtils';
import { normalizeAddress } from '../../../../../normalize/address';
import { getDAO } from '../../../../../match/locationsDAO';
import { loadConfig } from '../../../../../config';
import { reconcileOne } from '../../../../../match/matcher';
import { canonicalKey } from '../../../../../types';
import { getLogger } from '../../../../../utils/logger';
import { isAddressExact, isNameExact } from '../../../../../match/scorers';
import { extractText } from '../../../../../ingest/pdfReader';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
	const logger = getLogger();
	try {
		const formData = await req.formData();
		const dao = getDAO(loadConfig().mr8Driver);
		const results: any[] = [];
		const inputText = formData.get('text');
		if (typeof inputText === 'string' && inputText.trim()) {
			const blocks = extractCandidateBlocks(inputText);
			for (const block of blocks) {
				const canonical = normalizeAddress(block);
				const match = await reconcileOne(canonical, dao);
				const name_exact = !!(match.record && isNameExact(canonical.name, match.record.name));
				const address_exact = !!(match.record && isAddressExact(canonical, match.record));
				// Treat fuzzy EXACT as a found match (do not require strict equality)
				const found = match.status === 'EXACT' && !!match.record;
				const search_key =
					found && match.record
						? match.record.search_key ||
						  canonicalKey({
						  	name: match.record.name,
						  	address1: match.record.address1,
						  	city: match.record.city,
						  	state: match.record.state,
						  	postal_code: match.record.postal_code,
						  })
						: undefined;
				results.push({
					input: block.split(/\n/).slice(0, 3).join(' '),
					parsed: canonical,
					match,
					outcome: found ? 'FOUND' : 'RESEARCH',
					search_key,
					name_exact,
					address_exact,
					note: found ? undefined : 'User needs to conduct research.',
				});
			}
		}
		const files = formData.getAll('files');
		for (const f of files) {
			if (!(f instanceof File)) continue;
			const buf = Buffer.from(await f.arrayBuffer());
			let text = '';
			
			// Check if it's a PDF file
			const isPdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
			
			if (isPdf) {
				// Extract text from PDF using pdfReader
				try {
					// Write buffer to temp file for pdfReader
					const tmpPath = path.join(os.tmpdir(), `pdf-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`);
					await fs.writeFile(tmpPath, buf);
					text = await extractText(tmpPath);
					// Clean up temp file
					await fs.unlink(tmpPath).catch(() => {});
				} catch (e: any) {
					logger.warn('PDF extraction failed', { message: e?.message, file: f.name });
					text = '';
				}
			} else {
				// For non-PDF files, treat as text
				try {
					text = buf.toString('utf8');
				} catch {
					text = '';
				}
			}
			
			// Use structured facility extraction for PDFs, fallback to candidate blocks for other formats
			const blocks = isPdf && text.trim() 
				? extractStructuredFacilities(text) 
				: extractCandidateBlocks(text);
			
			for (const block of blocks) {
				const ca = normalizeAddress(block);
				const match = await reconcileOne(ca, dao);
				const name_exact = !!(match.record && isNameExact(ca.name, match.record.name));
				const address_exact = !!(match.record && isAddressExact(ca, match.record));
				// Treat fuzzy EXACT as a found match (do not require strict equality)
				const found = match.status === 'EXACT' && !!match.record;
				const search_key =
					found && match.record
						? match.record.search_key ||
						  canonicalKey({
						  	name: match.record.name,
						  	address1: match.record.address1,
						  	city: match.record.city,
						  	state: match.record.state,
						  	postal_code: match.record.postal_code,
						  })
						: undefined;
				results.push(
					{
						file: f.name,
						input: block.split(/\n/).slice(0, 3).join(' '),
						parsed: ca,
						match,
						outcome: found ? 'FOUND' : 'RESEARCH',
						search_key,
						name_exact,
						address_exact,
						note: found ? undefined : 'User needs to conduct research.',
					},
				);
			}
		}
		return NextResponse.json({ results });
	} catch (e: any) {
		logger.error('Reconcile route failed', { message: e?.message });
		return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
	}
}


