import * as fuzzball from 'fuzzball';
import { CanonicalAddress } from '../types';

const STREET_EXPANSIONS: Record<string, string> = {
	st: 'street',
	street: 'street',
	ave: 'avenue',
	avenue: 'avenue',
	av: 'avenue',
	blvd: 'boulevard',
	boulevard: 'boulevard',
	rd: 'road',
	road: 'road',
	ln: 'lane',
	lane: 'lane',
	pkwy: 'parkway',
	parkway: 'parkway',
	ct: 'court',
	court: 'court',
	dr: 'drive',
	drive: 'drive',
	hwy: 'highway',
	highway: 'highway',
	pkw: 'parkway',
	pky: 'parkway',
	pkway: 'parkway',
	bvd: 'boulevard',
	boulevrd: 'boulevard',
	// directional tokens
	n: 'north',
	north: 'north',
	s: 'south',
	south: 'south',
	e: 'east',
	east: 'east',
	w: 'west',
	west: 'west',
	ne: 'northeast',
	northeast: 'northeast',
	nw: 'northwest',
	northwest: 'northwest',
	se: 'southeast',
	southeast: 'southeast',
	sw: 'southwest',
	southwest: 'southwest',
};

const UNIT_LABELS = ['suite', 'ste', 'unit', '#'];

function normalizeWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function removePunctuation(s: string): string {
	return s.replace(/[.,]/g, ' ');
}

function expandStreetTokens(s: string): string {
	const tokens = s.split(/\s+/);
	const expanded = tokens.map((t) => {
		const key = t.toLowerCase().replace(/[^a-z]/g, '');
		return STREET_EXPANSIONS[key] ? STREET_EXPANSIONS[key] : t;
	});
	return normalizeWhitespace(expanded.join(' '));
}

function normalizeUnit(s: string): { line: string; unit?: string } {
	// Find unit tokens like "Ste 300" or "#500" or "Unit 2"
	const m = s.match(/\b(?:suite|ste|unit)\b\s*([a-z0-9-]+)|#\s*([a-z0-9-]+)/i);
	if (!m) return { line: s };
	const unit = m[1] || m[2];
	let line = s.replace(m[0], '').trim();
	line = line.replace(/,$/, ''); // remove trailing comma
	line = normalizeWhitespace(line);
	return { line, unit };
}

// Mapping of full state names to abbreviations
const STATE_TO_ABBR: Record<string, string> = {
	alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
	connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
	illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
	maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
	mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
	'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
	'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
	pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
	tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
	washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
	'district of columbia': 'DC', 'washington dc': 'DC', dc: 'DC',
};

function extractCityStateZip(line: string): { city: string; state: string; postal_code: string } | null {
	// First try to match 2-letter state abbreviation: "City, ST 12345"
	let m = line.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
	if (m && m[1] && m[2] && m[3]) {
		const city = m[1].trim();
		const state = m[2].toUpperCase();
		const postal_code = m[3];
		return { city, state, postal_code };
	}
	
	// Try to match full state name: "City, StateName 12345"
	m = line.match(/^(.+?),\s*([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d{5})(?:-\d{4})?$/i);
	if (m && m[1] && m[2] && m[3]) {
		const city = m[1].trim();
		const stateName = m[2].toLowerCase().trim();
		const postal_code = m[3];
		// Convert full state name to abbreviation
		const stateAbbr = STATE_TO_ABBR[stateName];
		if (stateAbbr) {
			return { city, state: stateAbbr, postal_code };
		}
	}
	
	return null;
}

/**
 * Extracts department information from a line that contains date ranges and department names.
 * Examples:
 * - "07/13/23 to Present – Radiology Records" -> "Radiology Records"
 * - "01/01/20 to 12/31/22 - Billing Department" -> "Billing Department"
 * - "Radiology Records" -> "Radiology Records"
 */
function extractDepartment(line: string): string | null {
	if (!line || !line.trim()) return null;
	
	// Pattern: date range followed by dash/em-dash/en-dash and department name
	// Matches formats like:
	// - "MM/DD/YY to Present – Department Name"
	// - "MM/DD/YY to MM/DD/YY - Department Name"
	// - "MM/DD/YY to Present - Department Name"
	const dateRangePattern = /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+to\s+(?:Present|\d{1,2}\/\d{1,2}\/\d{2,4})\s*[–—-]\s*(.+)$/i;
	const match = line.match(dateRangePattern);
	if (match && match[1]) {
		return match[1].trim();
	}
	
	// If no date range pattern, check if line looks like a department name
	// (contains common department keywords and doesn't look like an address)
	const departmentKeywords = [
		'records', 'department', 'billing', 'radiology', 'legal', 'hr', 'human resources',
		'medical records', 'health information', 'hims', 'compliance', 'administration'
	];
	const lowerLine = line.toLowerCase();
	const hasKeyword = departmentKeywords.some(keyword => lowerLine.includes(keyword));
	const looksLikeAddress = /\d+\s+\w+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln)/i.test(line);
	
	if (hasKeyword && !looksLikeAddress) {
		return line.trim();
	}
	
	return null;
}

export function normalizeAddress(block: string): CanonicalAddress {
	// Rule-based parser for address normalization
	const lines = block
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	let name: string | undefined;
	let address1 = '';
	let address2: string | undefined;
	let city = '';
	let state = '';
	let postal_code = '';
	let department: string | null = null;

	// Identify city/state/zip line
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (!line) continue;
		const parsed = extractCityStateZip(line);
		if (parsed) {
			city = parsed.city;
			state = parsed.state;
			postal_code = parsed.postal_code;
			// Previous non-empty line(s) form address1/address2
			const addrLine = lines[i - 1] || '';
			const { line, unit } = normalizeUnit(addrLine);
			address1 = line;
			if (unit) address2 = `suite ${unit}`;
			// Name likely the line before address
			const possibleName = lines[i - 2] || '';
			const possibleFacilityName = lines[i - 3] || '';
			
			// Check if possibleName looks like a doctor name (contains M.D., MD, D.O., DO, etc.)
			const looksLikeDoctorName = possibleName && /,\s*(M\.?D\.?|D\.?O\.?|P\.?A\.?|N\.?P\.?)/i.test(possibleName);
			
			// If we have both a facility name and a doctor name, prefer the doctor name
			// because doctor names are more specific and reliable for matching
			// (e.g., "Raul Marquez, MD" matches "Dr. Raul Marquez" better than facility name would)
			if (looksLikeDoctorName && possibleName && !/\d/.test(possibleName)) {
				name = possibleName;
			} else if (possibleFacilityName && !/\d/.test(possibleFacilityName)) {
				name = possibleFacilityName;
			} else if (possibleName && !/\d/.test(possibleName)) {
				name = possibleName;
			}
			break;
		}
	}

	// If address1 still empty, use first line with a number
	if (!address1) {
		const addrLine = lines.find((l) => /\d/.test(l)) || '';
		const { line, unit } = normalizeUnit(addrLine);
		address1 = line;
		if (unit) address2 = `suite ${unit}`;
	}
	// If no name, use first line that lacks numbers
	if (!name) {
		name = lines.find((l) => !/\d/.test(l));
	}

	// Extract department from any line that matches department patterns
	// Check all lines, but prioritize lines that come after address information
	for (const line of lines) {
		const extracted = extractDepartment(line);
		if (extracted) {
			department = extracted;
			break; // Take the first match
		}
	}

	// Normalize address1 tokens
	let addr1 = address1.toLowerCase();
	addr1 = removePunctuation(addr1);
	addr1 = expandStreetTokens(addr1);
	addr1 = addr1.replace(/\bpo\s*box\b/i, 'po box'); // keep PO Box if present
	addr1 = normalizeWhitespace(addr1);

	const addr2 = address2 ? `suite ${String(address2).replace(/^suite\s*/i, '')}` : undefined;

	return {
		name: name?.trim(),
		address1: addr1,
		address2: addr2?.toLowerCase(),
		city: city,
		state: state.toUpperCase(),
		postal_code: postal_code.slice(0, 5),
		country: 'US',
		department: department || undefined,
	};
}

export function compareFields(a: string | null | undefined, b: string | null | undefined): number {
	const aa = (a ?? '').toString().toLowerCase().trim();
	const bb = (b ?? '').toString().toLowerCase().trim();
	if (!aa && !bb) return 100;
	if (!aa || !bb) return 0;
	return fuzzball.ratio(aa, bb);
}


