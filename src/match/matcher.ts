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
	matchesDoctorPattern,
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

/**
 * Normalizes department names to canonical forms to handle common variations.
 * Examples:
 * - "Radiology Records", "Radiology Dept.", "Radiology Department" -> "radiology"
 * - "Medical Records", "Medical Record Department" -> "medical records"
 * - "Billing Records", "Billing Department", "Billing" -> "billing"
 * - "Patient Accounts", "Patient Account Department" -> "patient accounts"
 */
function normalizeDepartment(dept: string): string {
	if (!dept) return '';
	
	const normalized = dept.toLowerCase().trim();
	
	// Remove common suffixes/prefixes and normalize abbreviations
	const cleaned = normalized
		.replace(/\b(dept|dept\.|department)\b/g, '')
		.replace(/\b(records?|record)\b/g, '')
		.trim();
	
	// Map core department names to canonical forms
	const coreMappings: Record<string, string> = {
		'radiology': 'radiology',
		'medical': 'medical records',
		'billing': 'billing',
		'patient account': 'patient accounts',
		'patient accounts': 'patient accounts',
		'record': 'records department',
		'records': 'records department',
		'legal': 'legal department',
		'human resource': 'human resources',
		'human resources': 'human resources',
		'hr': 'human resources',
		'pharmacy': 'pharmacy',
	};
	
	// Check for exact match in core mappings
	if (coreMappings[cleaned]) {
		return coreMappings[cleaned];
	}
	
	// Check if cleaned string contains any core department name
	for (const [key, value] of Object.entries(coreMappings)) {
		if (cleaned.includes(key) || normalized.includes(key)) {
			return value;
		}
	}
	
	// Special handling for common patterns
	if (normalized.includes('radiology')) {
		return 'radiology';
	}
	if (normalized.includes('medical') && (normalized.includes('record') || normalized.includes('records'))) {
		return 'medical records';
	}
	if (normalized.includes('billing')) {
		return 'billing';
	}
	if (normalized.includes('patient') && (normalized.includes('account') || normalized.includes('accounts'))) {
		return 'patient accounts';
	}
	if (normalized.includes('record') || normalized.includes('records')) {
		if (!normalized.includes('medical') && !normalized.includes('billing') && !normalized.includes('radiology')) {
			return 'records department';
		}
	}
	if (normalized.includes('legal')) {
		return 'legal department';
	}
	if (normalized.includes('human resource') || normalized.includes('hr')) {
		return 'human resources';
	}
	if (normalized.includes('pharmacy')) {
		return 'pharmacy';
	}
	
	// If no mapping found, return normalized version
	return normalized;
}

function computeScores(
	doc: CanonicalAddress,
	db: LocationRecord,
): { name: number; address: number; department: number | null; geodistance_m: number | null } {
	const nameA = (doc.name || '').toString();
	const nameB = db.name || '';
	
	// Check for doctor pattern match first (e.g., "Rafath Quraishi MD" matches "Dr. Rafath Quraishi")
	// If it matches, boost the score significantly
	let name: number;
	if (matchesDoctorPattern(nameA, nameB)) {
		// Give a high score (98) for doctor pattern matches
		name = 98;
	} else {
		// Otherwise use standard fuzzy matching
		name = fuzzball.token_sort_ratio(nameA, nameB);
	}
	
	const addrA = expandAbbrev(fullAddressString(doc));
	const addrB = expandAbbrev(fullDbAddressString(db));
	const address = fuzzball.token_set_ratio(addrA, addrB);
	
	// Compute department score if both have department values
	let department: number | null = null;
	const docDept = (doc.department || '').toString().trim();
	const dbDept = (db.department || '').toString().trim();
	
	// Normalize both department names to canonical forms
	const normalizedDocDept = normalizeDepartment(docDept);
	const normalizedDbDept = normalizeDepartment(dbDept);
	
	if (normalizedDocDept && normalizedDbDept) {
		// If normalized forms match exactly, give perfect score
		if (normalizedDocDept === normalizedDbDept) {
			department = 100;
		} else {
			// Otherwise use fuzzy matching
			department = fuzzball.token_sort_ratio(normalizedDocDept, normalizedDbDept);
		}
	} else if (!normalizedDocDept && !normalizedDbDept) {
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
	const docDept = (doc.department || '').toString().trim();
	const recDept = (rec.department || '').toString().trim();
	
	// Normalize both department names to canonical forms
	const normalizedDocDept = normalizeDepartment(docDept);
	const normalizedRecDept = normalizeDepartment(recDept);
	
	// If both have departments, check for match
	if (normalizedDocDept && normalizedRecDept) {
		// First try exact match after normalization
		if (normalizedDocDept === normalizedRecDept) {
			return true;
		}
		// Fallback to fuzzy matching with a threshold (85% similarity) for edge cases
		const similarity = fuzzball.token_sort_ratio(normalizedDocDept, normalizedRecDept);
		return similarity >= 85;
	}
	// If both are missing, consider it a match
	if (!normalizedDocDept && !normalizedRecDept) {
		return true;
	}
	// If one has department and the other doesn't, no match
	return false;
}

export async function reconcileOne(doc: CanonicalAddress, dao: LocationsDAO): Promise<MatchResult> {
	const logger = getLogger();
	const blockingKey = doc.postal_code
		? { city: doc.city, state: doc.state, postal_code: doc.postal_code.slice(0, 5) }
		: { city: doc.city, state: doc.state };
	
	logger.info('Finding candidates', {
		blockingKey,
		docName: doc.name,
		docDepartment: doc.department
	});
	
	const allCandidates = await dao.findCandidates(blockingKey);

	logger.info('Found candidates', {
		candidatesCount: allCandidates.length,
		sampleNames: allCandidates.slice(0, 5).map(c => c.name)
	});

	// Step 1: Check for exact matches (name and address) FIRST, before department filtering
	// Exact matches should always be returned regardless of department differences
	// Also check for doctor pattern matches (e.g., "Rafath Quraishi MD" matches "Dr. Rafath Quraishi")
	for (const rec of allCandidates) {
		const nameExact = isNameExact(doc.name, rec.name) || matchesDoctorPattern(doc.name, rec.name);
		const addressExact = isAddressExact(doc, rec);

		if (nameExact && addressExact) {
			// Found exact match - return immediately (department doesn't matter for exact matches)
			const scores = computeScores(doc, rec);
			logger.info('Exact match found (before department filtering)', {
				docName: doc.name,
				recName: rec.name,
				docDept: doc.department,
				recDept: rec.department,
				doctorPatternMatch: matchesDoctorPattern(doc.name, rec.name)
			});
			return {
				status: 'EXACT',
				mr8_id: (rec.id as any) ?? null,
				scores,
				diffs: buildDiffs(doc, rec),
				explanation: 'Exact match found.',
				record: rec,
			};
		}
	}

	// Step 2: If no exact match found, filter candidates by department for fuzzy matching
	// If doc has a department (non-empty), only consider records with matching department
	// If doc has no department, consider all candidates
	const docHasDepartment = doc.department && doc.department.toString().trim().length > 0;
	const departmentFiltered = docHasDepartment
		? allCandidates.filter((rec) => {
			const matches = departmentsMatch(doc, rec);
			logger.debug('Department match check', {
				docDept: doc.department,
				recDept: rec.department,
				recName: rec.name,
				matches
			});
			return matches;
		})
		: allCandidates;

	logger.info('After department filtering', {
		docHasDepartment,
		departmentFilteredCount: departmentFiltered.length,
		filteredNames: departmentFiltered.slice(0, 5).map(c => ({ name: c.name, dept: c.department }))
	});
	
	// Step 3: If no exact match found, proceed with scoring logic for fuzzy matches
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


