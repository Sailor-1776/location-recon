import type { CanonicalAddress, LocationRecord } from '../types';
import { compareFields } from '../normalize/address';
import {
	CLOSE_ADDR_MIN,
	CLOSE_GEO_M,
	CLOSE_NAME_MIN,
	EXACT_ADDR_MIN,
	EXACT_NAME_MIN,
	expandAbbrev,
	fullAddressString,
	fullDbAddressString,
	isAddressExact,
	isNameExact,
	tokenSet,
	tokenSort,
} from './scorers';
import * as fuzzball from 'fuzzball';
import type { LocationsDAO } from './locationsDAO';
import { explainCloseMatch } from '../llm/assistant';
import { getLogger } from '../utils/logger';

export type MatchStatus = 'EXACT' | 'CLOSE' | 'NEW';

export interface MatchResult {
	status: MatchStatus;
	mr8_id: string | number | null;
	scores: { name: number; address: number; department: number | null; geodistance_m: number | null };
	diffs: Array<{ field: string; a: string | null; b: string | null; note?: string }>;
	explanation: string;
	record?: LocationRecord | null;
}

function computeScores(
	doc: CanonicalAddress,
	db: LocationRecord,
): { name: number; address: number; department: number | null; geodistance_m: number | null } {
	const nameA = (doc.name || '').toString();
	const nameB = db.name || '';
	const name = fuzzball.token_sort_ratio(nameA, nameB);
	const addrA = expandAbbrev(fullAddressString(doc));
	const addrB = expandAbbrev(fullDbAddressString(db));
	const address = fuzzball.token_set_ratio(addrA, addrB);
	
	// Compute department score if both have department values
	let department: number | null = null;
	const docDept = (doc.department || '').toString().trim().toLowerCase();
	const dbDept = (db.department || '').toString().trim().toLowerCase();
	if (docDept && dbDept) {
		department = fuzzball.token_sort_ratio(docDept, dbDept);
	} else if (!docDept && !dbDept) {
		// Both missing - consider it a match (neutral)
		department = 100;
	} else {
		// One has department, other doesn't - no match
		department = 0;
	}
	
	// No doc lat/lon in this tool; set geodistance null
	return { name, address, department, geodistance_m: null };
}

function decideStatus(scores: { name: number; address: number; department: number | null; geodistance_m: number | null }): MatchStatus {
	if (scores.address >= EXACT_ADDR_MIN && scores.name >= EXACT_NAME_MIN) return 'EXACT';
	if (
		(scores.address >= CLOSE_ADDR_MIN && scores.name >= CLOSE_NAME_MIN) ||
		(scores.geodistance_m != null && scores.geodistance_m <= CLOSE_GEO_M)
	) {
		return 'CLOSE';
	}
	return 'NEW';
}

function buildDiffs(doc: CanonicalAddress, db: LocationRecord): MatchResult['diffs'] {
	const fields: Array<keyof CanonicalAddress | keyof LocationRecord> = [
		'name',
		'address1',
		'address2',
		'city',
		'state',
		'postal_code',
		'department',
	];
	const diffs: MatchResult['diffs'] = [];
	for (const f of fields) {
		const a = (doc as any)[f] ?? null;
		const b = (db as any)[f] ?? null;
		if ((a || '') !== (b || '')) {
			diffs.push({ field: String(f), a, b, note: `${Math.round(compareFields(a, b))}%` });
		}
	}
	return diffs;
}

function departmentsMatch(doc: CanonicalAddress, rec: LocationRecord): boolean {
	const docDept = (doc.department || '').toString().trim().toLowerCase();
	const recDept = (rec.department || '').toString().trim().toLowerCase();
	// If both have departments, they must match exactly
	if (docDept && recDept) {
		return docDept === recDept;
	}
	// If both are missing, consider it a match
	if (!docDept && !recDept) {
		return true;
	}
	// If one has department and the other doesn't, no match
	return false;
}

export async function reconcileOne(doc: CanonicalAddress, dao: LocationsDAO): Promise<MatchResult> {
	const blockingKey = doc.postal_code
		? { city: doc.city, state: doc.state, postal_code: doc.postal_code.slice(0, 5) }
		: { city: doc.city, state: doc.state };
	const allCandidates = await dao.findCandidates(blockingKey);
	
	// Step 1: Filter candidates by department first
	// If doc has a department (non-empty), only consider records with matching department
	// If doc has no department, consider all candidates
	const docHasDepartment = doc.department && doc.department.toString().trim().length > 0;
	const departmentFiltered = docHasDepartment
		? allCandidates.filter((rec) => departmentsMatch(doc, rec))
		: allCandidates;
	
	// Step 2: Check for exact matches (name and address) within department-filtered candidates
	for (const rec of departmentFiltered) {
		const nameExact = isNameExact(doc.name, rec.name);
		const addressExact = isAddressExact(doc, rec);
		
		if (nameExact && addressExact) {
			// Found exact match within department - return immediately
			const scores = computeScores(doc, rec);
			return {
				status: 'EXACT',
				mr8_id: (rec.id as any) ?? null,
				scores,
				diffs: buildDiffs(doc, rec),
				explanation: 'Exact match found within department.',
				record: rec,
			};
		}
	}
	
	// Step 3: If no exact match found, proceed with scoring logic
	let best: { rec: LocationRecord; scores: MatchResult['scores'] } | null = null;

	for (const rec of departmentFiltered) {
		const scores = computeScores(doc, rec);
		if (!best) best = { rec, scores };
		else {
			// Include department in scoring if available
			const sumBest = best.scores.name + best.scores.address + (best.scores.department ?? 0);
			const sumNew = scores.name + scores.address + (scores.department ?? 0);
			if (sumNew > sumBest) best = { rec, scores };
		}
	}

	if (!best) {
		return {
			status: 'NEW',
			mr8_id: null,
			scores: { name: 0, address: 0, department: null, geodistance_m: null },
			diffs: [],
			explanation: 'No candidates in blocking set; new location.',
			record: null,
		};
	}

	const status = decideStatus(best.scores);
	
	// Debug logging for matching issues
	const logger = getLogger();
	if (status !== 'EXACT') {
		logger.info('Match result', {
			status,
			name: best.scores.name,
			address: best.scores.address,
			department: best.scores.department,
			docName: doc.name,
			dbName: best.rec.name,
			docAddr: expandAbbrev(fullAddressString(doc)),
			dbAddr: expandAbbrev(fullDbAddressString(best.rec)),
			thresholds: { EXACT_NAME_MIN, EXACT_ADDR_MIN, CLOSE_NAME_MIN, CLOSE_ADDR_MIN },
		});
	}
	
	let explanation =
		status === 'EXACT'
			? 'High similarity on name and address.'
			: status === 'CLOSE'
				? 'Close match based on thresholds.'
				: 'Below thresholds; treated as new.';

	if (
		status === 'CLOSE' &&
		((best.scores.name >= 85 && best.scores.name <= 92) ||
			(best.scores.address >= 85 && best.scores.address <= 92))
	) {
		try {
			explanation = await explainCloseMatch(doc, best.rec);
		} catch {
			// ignore LLM errors
		}
	}

	return {
		status,
		mr8_id: (best.rec.id as any) ?? null,
		scores: best.scores,
		diffs: buildDiffs(doc, best.rec),
		explanation,
		record: best.rec,
	};
}


