import crypto from 'node:crypto';

export function maskZip5(zip: string): string {
	const m = zip?.match(/(\d{5})/);
	return m ? m[1] : '';
}

export function hashAddress1(address1: string): string {
	const hash = crypto.createHash('sha256').update(address1.toLowerCase().trim()).digest('hex');
	return hash.slice(0, 12);
}

export function redactAddressSummary(address1: string, postal_code: string): string {
	return `hash:${hashAddress1(address1)}|zip:${maskZip5(postal_code)}`;
}


