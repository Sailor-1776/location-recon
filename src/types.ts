import { z } from 'zod';

export const LocationRecordSchema = z.object({
	id: z.union([z.string(), z.number()]).nullable(),
	name: z.string(),
	address1: z.string(),
	address2: z.string().optional().nullable(),
	city: z.string(),
	state: z.string(),
	postal_code: z.string(),
	country: z.string().default('US').optional(),
	latitude: z.number().nullable().optional(),
	longitude: z.number().nullable().optional(),
	search_key: z.string().optional(),
	department: z.string().optional().nullable(),
});

export type LocationRecord = z.infer<typeof LocationRecordSchema>;

export interface CanonicalAddress {
	name?: string;
	address1: string;
	address2?: string | null;
	city: string;
	state: string;
	postal_code: string;
	country?: string; // default US
	department?: string | null;
}

export function fromRow(row: unknown): LocationRecord {
	const obj = row as Record<string, unknown>;

	// Helper: fetch first defined value from possible keys
	const pick = (keys: string[]): unknown => {
		for (const k of keys) {
			if (Object.prototype.hasOwnProperty.call(obj, k) && (obj as any)[k] != null) return (obj as any)[k];
		}
		return undefined;
	};

	// Normalize US State names to 2-letter abbreviations
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
	const normalizeState = (v: unknown): string => {
		const s = (v ?? '').toString().trim();
		if (!s) return '';
		if (s.length === 2) return s.toUpperCase();
		const m = STATE_TO_ABBR[s.toLowerCase()];
		return m ? m : s.toUpperCase();
	};

	// Extract address1/address2 from a single-line "Address" if needed
	const parseAddressLine = (v: unknown): { address1: string; address2: string | null } => {
		const raw = (v ?? '').toString().trim();
		if (!raw) return { address1: '', address2: null };
		// Prefer splitting before comma that precedes unit tokens
		// Examples: "123 Main St, Suite 200", "123 Main St Suite 200", "123 Main St, Ste 200", "123 Main St #500"
		// Try comma split first
		let a1 = raw;
		let a2: string | null = null;
		const commaParts = raw.split(',');
		if (commaParts.length >= 2) {
			const tail = commaParts.slice(1).join(',').trim();
			if (/\b(suite|ste|unit|#)\b/i.test(tail)) {
				a1 = commaParts[0].trim();
				a2 = tail;
			}
		}
		// If still no a2, try regex inline
		if (!a2) {
			const m = raw.match(/^(.*?)(?:,?\s*)(suite|ste|unit|#)\s*([a-z0-9\-]+.*)$/i);
			if (m) {
				a1 = m[1].trim();
				a2 = `${m[2]} ${m[3]}`.trim();
			}
		}
		return { address1: a1, address2: a2 };
	};

	const idRaw =
		pick(['id', 'ID', 'Id', 'Loc No.', 'Loc No']) ?? null;
	const nameRaw = pick(['name', 'Name', 'Location Name']) ?? '';

	// Prefer explicit address1/address2, else derive from "Address"
	const address1Raw = pick(['address1', 'Address1', 'street', 'Street']) ?? '';
	const address2Raw = pick(['address2', 'Address2', 'Street2']) ?? null;
	let address1 = (address1Raw ?? '').toString();
	let address2 = (address2Raw ?? '') as string | null;
	if (!address1) {
		const addr = parseAddressLine(pick(['Address']));
		address1 = addr.address1;
		address2 = address2 || addr.address2;
	}

	const cityRaw = pick(['city', 'City', 'City/Town']) ?? '';
	const stateRaw = pick(['state', 'State', 'State/Province']) ?? '';
	const postalRaw = pick(['postal_code', 'zip', 'Zip', 'zip_code', 'Postal Code']) ?? '';
	const departmentRaw = pick(['department', 'Department']) ?? null;

	const normalized: Record<string, unknown> = {
		id: idRaw,
		name: nameRaw,
		address1,
		address2: (address2 ?? undefined) as any,
		city: cityRaw,
		state: normalizeState(stateRaw),
		postal_code: (postalRaw ?? '').toString(),
		country: (pick(['country', 'Country']) ?? 'US') as string,
		latitude:
			obj.latitude !== undefined && obj.latitude !== null
				? Number(obj.latitude)
				: (obj as any).Latitude !== undefined
					? Number((obj as any).Latitude)
					: null,
		longitude:
			obj.longitude !== undefined && obj.longitude !== null
				? Number(obj.longitude)
				: (obj as any).Longitude !== undefined
					? Number((obj as any).Longitude)
					: null,
		search_key: pick(['search_key', 'searchKey', 'SearchKey', 'Search Key']) ?? null,
		department: departmentRaw ? String(departmentRaw).trim() : null,
	};
	return LocationRecordSchema.parse(normalized);
}

function normalizeForKey(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function canonicalKey(rec: Pick<LocationRecord, 'name' | 'address1' | 'city' | 'state' | 'postal_code'>): string {
	return [
		normalizeForKey(rec.name),
		normalizeForKey(rec.address1),
		normalizeForKey(rec.city),
		normalizeForKey(rec.state),
		normalizeForKey(rec.postal_code.slice(0, 5)),
	].join('|');
}


