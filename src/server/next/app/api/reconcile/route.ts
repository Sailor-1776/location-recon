import { NextRequest, NextResponse } from 'next/server';
import { extractCandidateBlocks } from '../../../../../ingest/textUtils';
import { normalizeAddress } from '../../../../../normalize/address';
import { getDAO } from '../../../../../match/locationsDAO';
import { loadConfig } from '../../../../../config';
import { reconcileOne } from '../../../../../match/matcher';
import { canonicalKey } from '../../../../../types';
import { getLogger } from '../../../../../utils/logger';
import { isAddressExact, isNameExact } from '../../../../../match/scorers';

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
			// Minimal: treat as text for now (UI demo). CLI handles PDFs/emails fully.
			try {
				text = buf.toString('utf8');
			} catch {
				text = '';
			}
			const blocks = extractCandidateBlocks(text);
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


