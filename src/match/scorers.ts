import * as fuzzball from 'fuzzball';
import { geodistanceMeters } from '../utils/geo';
import type { CanonicalAddress, LocationRecord } from '../types';

export const EXACT_ADDR_MIN = 95;
export const EXACT_NAME_MIN = 94;
export const CLOSE_ADDR_MIN = 92;
export const CLOSE_NAME_MIN = 90;
export const CLOSE_GEO_M = 100;

export function tokenSort(s: string): string {
	return s
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.sort()
		.join(' ');
}

export function expandAbbrev(s: string): string {
	const map: Record<string, string> = {
		st: 'street',
		ave: 'avenue',
		av: 'avenue',
		rd: 'road',
		ln: 'lane',
		blvd: 'boulevard',
		hwy: 'highway',
		pkwy: 'parkway',
		ct: 'court',
		dr: 'drive',
		unit: 'suite',
		ste: 'suite',
		// states (normalize to 2-letter)
		texas: 'tx',
		// directional tokens
		n: 'north',
		s: 'south',
		e: 'east',
		w: 'west',
		ne: 'northeast',
		nw: 'northwest',
		se: 'southeast',
		sw: 'southwest',
		// normalize British vs American spellings
		centre: 'center',
	};
	return s
		.toLowerCase()
		.replace(/[.,]/g, ' ')
		// Normalize suite number variants: "Suite 150-B", "Suite 150B", "Ste 150 B", "Suite 150" -> "suite 150"
		// First handle suite numbers with letter suffixes (150-B, 150B, etc.)
		.replace(/\b(suite|ste|unit)\s+(\d+)[- ]?[a-z]\b/gi, 'suite $2')
		// Then normalize standalone suite numbers to ensure consistency
		.replace(/\b(suite|ste|unit)\s+(\d+)\b/gi, 'suite $2')
		.split(/\s+/)
		.map((t) => map[t] || t)
		.join(' ');
}

export function tokenSet(s: string): string {
	const set = new Set(
		s
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean),
	);
	return Array.from(set).sort().join(' ');
}

export function fullAddressString(a: Pick<CanonicalAddress, 'address1' | 'address2' | 'city' | 'state' | 'postal_code'>): string {
	return [a.address1, a.address2 || '', a.city, a.state, a.postal_code.slice(0, 5)]
		.map((x) => (x || '').toString().trim())
		.filter(Boolean)
		.join(' ');
}

export function fullDbAddressString(r: Pick<LocationRecord, 'address1' | 'address2' | 'city' | 'state' | 'postal_code'>): string {
	return [r.address1, r.address2 || '', r.city, r.state, r.postal_code.slice(0, 5)]
		.map((x) => (x || '').toString().trim())
		.filter(Boolean)
		.join(' ');
}

export function computeScores(
	doc: CanonicalAddress,
	db: LocationRecord,
): { name: number; address: number; geodistance_m: number | null } {
	const nameA = (doc.name || '').toString();
	const nameB = db.name || '';
	
	// Check for doctor pattern match first (e.g., "Rafath Quraishi MD" matches "Dr. Rafath Quraishi")
	// If it matches, boost the score significantly
	if (matchesDoctorPattern(nameA, nameB)) {
		// Give a high score (98) for doctor pattern matches
		const name = 98;
		const addrA = expandAbbrev(fullAddressString(doc));
		const addrB = expandAbbrev(fullDbAddressString(db));
		const address = fuzzball.token_set_ratio(addrA, addrB);
		return { name, address, geodistance_m: null };
	}
	
	// Otherwise use standard fuzzy matching
	const name = fuzzball.token_sort_ratio(nameA, nameB);

	const addrA = expandAbbrev(fullAddressString(doc));
	const addrB = expandAbbrev(fullDbAddressString(db));
	const address = fuzzball.token_set_ratio(addrA, addrB);

	// For this tool, we only compute geodistance when both points are known (doc lacks coords)
	return { name, address, geodistance_m: null };
}

export function computeGeodistanceIfBoth(
	doc: { latitude?: number | null; longitude?: number | null },
	db: LocationRecord,
): number | null {
	if (doc.latitude != null && doc.longitude != null && db.latitude != null && db.longitude != null) {
		return geodistanceMeters(
			{ latitude: doc.latitude, longitude: doc.longitude },
			{ latitude: db.latitude, longitude: db.longitude },
		);
	}
	return null;
}

/**
 * Extracts individual names from a string that may contain multiple names separated by semicolons.
 * Examples:
 * - "Ritesh Prasad, MD; Jared Crook, FNP-C." -> ["Ritesh Prasad, MD", "Jared Crook, FNP-C."]
 * - "John Smith" -> ["John Smith"]
 * - "East Texas Spine Institute, PA" -> ["East Texas Spine Institute, PA"]
 */
export function extractIndividualNames(name?: string | null): string[] {
	if (!name) return [];
	const trimmed = name.toString().trim();
	if (!trimmed) return [];
	
	// Split by semicolon and clean each name
	return trimmed
		.split(';')
		.map(n => n.trim())
		.filter(n => n.length > 0);
}

/**
 * Extracts first and last name from a name string, removing titles and suffixes.
 * Examples:
 * - "Rafath Quraishi MD" -> { first: "Rafath", last: "Quraishi" }
 * - "Dr. Rafath Quraishi" -> { first: "Rafath", last: "Quraishi" }
 * - "John Smith" -> { first: "John", last: "Smith" }
 */
export function extractFirstLastName(name?: string | null): { first: string; last: string } | null {
	if (!name) return null;
	
	const cleaned = name
		.toString()
		.trim()
		// Remove common prefixes
		.replace(/^(dr\.?|doctor|mr\.?|mrs\.?|ms\.?|miss|prof\.?|professor)\s+/i, '')
		// Remove common suffixes (handle optional comma before suffix, e.g., "Sobti, M.D." -> "Sobti")
		.replace(/[,]?\s+(md|m\.?d\.?|do|d\.?o\.?|dc|d\.?c\.?|pa|p\.?a\.?|np|n\.?p\.?|phd|ph\.?d\.?|jr\.?|sr\.?|ii|iii|iv)$/i, '')
		// Remove trailing commas and whitespace
		.replace(/[,]\s*$/, '')
		.trim();
	
	const parts = cleaned.split(/\s+/).filter(Boolean);
	if (parts.length < 2) return null;
	
	// Assume first name is first part, last name is last part
	// Handle middle names/initials by taking first and last
	const first = parts[0];
	const last = parts[parts.length - 1];
	
	return { first, last };
}

/**
 * Checks if a CSV record name matches the "Dr. first_name last_name" pattern
 * when compared to an input name.
 * Returns true if the CSV name starts with "Dr." (or "Doctor") followed by
 * the same first and last name as extracted from the input.
 * Also handles multiple names separated by semicolons - checks if ANY of them match.
 */
export function matchesDoctorPattern(inputName?: string | null, csvName?: string | null): boolean {
	if (!inputName || !csvName) return false;
	
	// Extract individual names from input (handles semicolon-separated names)
	const inputNames = extractIndividualNames(inputName);
	
	// Check each individual name
	for (const individualInputName of inputNames) {
		const inputParts = extractFirstLastName(individualInputName);
		if (!inputParts) continue;
		
		const csvLower = csvName.toString().trim().toLowerCase();
		// Check if CSV name starts with "dr." or "doctor" (already lowercase)
		if (!/^(dr\.?|doctor)\s+/.test(csvLower)) continue;
		
		// Extract first/last from CSV name (after removing "Dr." prefix)
		const csvWithoutPrefix = csvLower.replace(/^(dr\.?|doctor)\s+/, '').trim();
		const csvParts = extractFirstLastName(csvWithoutPrefix);
		if (!csvParts) continue;
		
		// Compare first and last names (case-insensitive)
		if (
			inputParts.first.toLowerCase() === csvParts.first.toLowerCase() &&
			inputParts.last.toLowerCase() === csvParts.last.toLowerCase()
		) {
			return true;
		}
	}
	
	return false;
}

// Exact-match helpers for deterministic checks used by API routes/UX
export function isNameExact(a?: string | null, b?: string | null): boolean {
	const aa = (a ?? '').toString().trim().toLowerCase();
	const bb = (b ?? '').toString().trim().toLowerCase();
	if (!aa || !bb) return false;
	
	// If input has multiple names (semicolon-separated), check if ANY of them match exactly
	const individualNamesA = extractIndividualNames(aa);
	if (individualNamesA.length > 1) {
		// Check if any individual name matches
		return individualNamesA.some(name => name === bb);
	}
	
	return aa === bb;
}

export function isAddressExact(
	doc: Pick<CanonicalAddress, 'address1' | 'address2' | 'city' | 'state' | 'postal_code'>,
	rec: Pick<LocationRecord, 'address1' | 'address2' | 'city' | 'state' | 'postal_code'>,
): boolean {
	const addrA = expandAbbrev(fullAddressString(doc)).trim().toLowerCase();
	const addrB = expandAbbrev(fullDbAddressString(rec)).trim().toLowerCase();
	if (!addrA || !addrB) return false;
	return addrA === addrB;
}


