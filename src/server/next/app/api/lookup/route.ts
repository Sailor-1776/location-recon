import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDAO } from '../../../../../match/locationsDAO';
import { loadConfig } from '../../../../../config';
import { normalizeAddress } from '../../../../../normalize/address';
import { reconcileOne } from '../../../../../match/matcher';
import { canonicalKey, type LocationRecord } from '../../../../../types';
import { getLogger } from '../../../../../utils/logger';
import { isAddressExact, isNameExact } from '../../../../../match/scorers';
import { extractWarningMessage, extractSearchKeyFromWarning } from '../../../../../llm/assistant';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
	const logger = getLogger();
	try {
		const dao = getDAO(loadConfig().mr8Driver);
		let body: Record<string, unknown> = {};
		try {
			body = await req.json();
		} catch {
			body = {};
		}
		const { text, name, address1, address2, city, state, postal_code, postal, department } = body || {};
		const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
		const asOptString = (v: unknown): string | undefined =>
			typeof v === 'string' && v.trim() ? v : undefined;
	
		const ca =
			typeof text === 'string' && text.trim()
				? normalizeAddress(text)
				: {
						name: asOptString(name),
						address1: asString(address1),
						address2: asOptString(address2),
						city: asString(city),
						state: asString(state).toUpperCase(),
						postal_code: asString(postal_code || postal).slice(0, 5),
						country: 'US',
						department: asOptString(department),
				  };
	
		const match = await reconcileOne(ca, dao);
	
		// Helper function to handle Non-Order departments
		const handleNonOrder = (record: LocationRecord): { searchKey: string; extractedFromWarning: string | null } => {
			const baseSearchKey = record.search_key ||
				canonicalKey({
					name: record.name,
					address1: record.address1,
					city: record.city,
					state: record.state,
					postal_code: record.postal_code,
				});
			
			// Append "-non" if not already present
			let searchKey = baseSearchKey.endsWith('-non') ? baseSearchKey : `${baseSearchKey}-non`;
			
			// Extract search-key-like pattern from warning field and append to searchKey
			let extractedFromWarning: string | null = null;
			if (record.warning) {
				try {
					extractedFromWarning = extractSearchKeyFromWarning(record.warning, searchKey);
					if (extractedFromWarning) {
						// Append the extracted pattern to the right of SEARCHKEY-non
						searchKey = `${searchKey} ${extractedFromWarning}`;
					}
				} catch (e: any) {
					logger.warn('Failed to extract search key from warning', { error: e?.message });
				}
			}
			
			return { searchKey, extractedFromWarning };
		};
	
		if (match.record) {
			const name_exact = isNameExact(ca.name, match.record.name);
			const address_exact = isAddressExact(ca, match.record);
			const departmentLower = (match.record.department || '').toString().trim().toLowerCase();
			const isNonOrder = departmentLower === 'non-order';
			
			// If fuzzy matching determined an EXACT match, return search_key regardless of strict equality.
			if (match.status === 'EXACT') {
				let key: string;
				let warningMessage: string | null = null;
				
				if (isNonOrder) {
					// For Non-Order departments, return search key with "-non" suffix plus extracted warning key
					const nonOrderResult = handleNonOrder(match.record);
					key = nonOrderResult.searchKey;
					// Don't set warningMessage for non-orders - the extracted key is already in searchKey
				} else {
					// For regular departments, use standard search key
					key =
						match.record.search_key ||
						canonicalKey({
							name: match.record.name,
							address1: match.record.address1,
							city: match.record.city,
							state: match.record.state,
							postal_code: match.record.postal_code,
						});
				}
				
				return NextResponse.json({
					status: 'EXACT',
					search_key: key,
					id: match.record.id ?? null,
					record: match.record,
					name_exact,
					address_exact,
					scores: match.scores,
					department_match: match.scores.department,
					warning: warningMessage,
				});
			}
		}
		
		return NextResponse.json({
			status: 'NEEDS_MORE_DATA',
			message: 'Find additional Data',
			diffs: match.diffs,
			candidate: match.record ?? null,
			warning: null,
		});
	} catch (e: any) {
		logger.error('Lookup route failed', { message: e?.message });
		return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
	}
}


