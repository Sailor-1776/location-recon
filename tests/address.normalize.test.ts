import { describe, it, expect } from 'vitest';
import { normalizeAddress } from '../src/normalize/address.js';

describe('normalizeAddress fallback', () => {
	it('expands street abbreviations and unit to suite', () => {
		const block = `Springfield Clinic
200 Oak Ave, Ste 300
Springfield, IL 62704`;
		const ca = normalizeAddress(block);
		expect(ca.address1).toContain('avenue');
		expect(ca.address2).toBe('suite 300');
		expect(ca.state).toBe('IL');
		expect(ca.postal_code).toBe('62704');
	});

	it('handles St. and Blvd to full forms', () => {
		const block = `Seaside Hospital
42 Ocean Blvd #2
Miami, FL 33132`;
		const ca = normalizeAddress(block);
		expect(ca.address1).toContain('boulevard');
		expect(ca.address2).toBe('suite 2');
		expect(ca.city).toBe('Miami');
		expect(ca.state).toBe('FL');
		expect(ca.postal_code).toBe('33132');
	});

	it('trims ZIP+4 to 5-digit', () => {
		const block = `General Hospital
123 Main St.
Springfield, IL 62701-1234`;
		const ca = normalizeAddress(block);
		expect(ca.postal_code).toBe('62701');
		expect(ca.address1).toContain('street');
	});

	it('expands Hwy to highway', () => {
		const block = `Prairie Health
9100 W Hwy 50
O'Fallon, IL 62269`;
		const ca = normalizeAddress(block);
		expect(ca.address1).toContain('highway');
	});
});


