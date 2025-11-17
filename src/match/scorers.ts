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

// Exact-match helpers for deterministic checks used by API routes/UX
export function isNameExact(a?: string | null, b?: string | null): boolean {
	const aa = (a ?? '').toString().trim().toLowerCase();
	const bb = (b ?? '').toString().trim().toLowerCase();
	if (!aa || !bb) return false;
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


