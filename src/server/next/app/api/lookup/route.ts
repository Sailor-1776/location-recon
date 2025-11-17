import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDAO } from '../../../../../match/locationsDAO';
import { loadConfig } from '../../../../../config';
import { normalizeAddress } from '../../../../../normalize/address';
import { reconcileOne } from '../../../../../match/matcher';
import { canonicalKey, type LocationRecord } from '../../../../../types';
import { getLogger } from '../../../../../utils/logger';
import { isAddressExact, isNameExact } from '../../../../../match/scorers';
import { extractWarningMessage } from '../../../../../llm/assistant';

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
	
		// Helper function to extract warning message for Non-Order departments
		const extractWarningIfNeeded = async (record: LocationRecord | null | undefined): Promise<string | null> => {
			if (!record) return null;
			const departmentLower = (record.department || '').toString().trim().toLowerCase();
			if (departmentLower !== 'non-order') return null;
			
			try {
				return await extractWarningMessage(record);
			} catch (e: any) {
				logger.warn('Failed to extract warning message', { error: e?.message });
				// Fallback to raw warning if LLM extraction fails
				return record.warning || null;
			}
		};
	
		if (match.record) {
			const name_exact = isNameExact(ca.name, match.record.name);
			const address_exact = isAddressExact(ca, match.record);
			const warningMessage = await extractWarningIfNeeded(match.record);
			
			// If fuzzy matching determined an EXACT match, return search_key regardless of strict equality.
			if (match.status === 'EXACT') {
				const key =
					match.record.search_key ||
					canonicalKey({
						name: match.record.name,
						address1: match.record.address1,
						city: match.record.city,
						state: match.record.state,
						postal_code: match.record.postal_code,
					});
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
		
		const warningMessage = await extractWarningIfNeeded(match.record);
		return NextResponse.json({
			status: 'NEEDS_MORE_DATA',
			message: 'Find additional Data',
			diffs: match.diffs,
			candidate: match.record ?? null,
			warning: warningMessage,
		});
	} catch (e: any) {
		logger.error('Lookup route failed', { message: e?.message });
		return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
	}
}


