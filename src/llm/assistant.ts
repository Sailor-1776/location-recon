import type { CanonicalAddress, LocationRecord } from '../types';
import { normalizeAddress } from '../normalize/address';

export async function repairAddress(text: string): Promise<CanonicalAddress> {
	// No external LLM by default. Best-effort repair via deterministic parser.
	return normalizeAddress(text);
}

export async function explainCloseMatch(doc: CanonicalAddress, db: LocationRecord): Promise<string> {
	const diffs: string[] = [];
	if ((doc.name || '').toLowerCase() !== db.name.toLowerCase()) {
		diffs.push(`name differs: "${doc.name || ''}" vs "${db.name}"`);
	}
	const addrA = [doc.address1, doc.address2].filter(Boolean).join(', ');
	const addrB = [db.address1, db.address2].filter(Boolean).join(', ');
	if (addrA.toLowerCase() !== addrB.toLowerCase()) {
		diffs.push(`address differs: "${addrA}" vs "${addrB}"`);
	}
	if (doc.city.toLowerCase() !== db.city.toLowerCase() || doc.state !== db.state) {
		diffs.push(`city/state: ${doc.city}, ${doc.state} vs ${db.city}, ${db.state}`);
	}
	if (doc.postal_code.slice(0, 5) !== db.postal_code.slice(0, 5)) {
		diffs.push(`zip: ${doc.postal_code} vs ${db.postal_code}`);
	}
	return diffs.length ? `Close match with minor differences: ${diffs.join('; ')}` : 'Close match.';
}


