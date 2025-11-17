import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { normalizeAddress } from '../src/normalize/address.js';
import { getDAO, CSVBackend } from '../src/match/locationsDAO.js';
import { reconcileOne } from '../src/match/matcher.js';

describe('matching rules', () => {
	const csvPath = 'data/locations.sample.csv';

	it('EXACT match for hospital_1', async () => {
		const dao = new CSVBackend(csvPath);
		const text = await fs.readFile('data/fixtures/texts/hospital_1.txt', 'utf8');
		const ca = normalizeAddress(text);
		const res = await reconcileOne(ca, dao);
		expect(res.status).toBe('EXACT');
		expect(res.scores.name).toBeGreaterThanOrEqual(94);
		expect(res.scores.address).toBeGreaterThanOrEqual(95);
	});

	it('CLOSE match for ocean blvd unit hash variation', async () => {
		const dao = new CSVBackend(csvPath);
		const text = await fs.readFile('data/fixtures/texts/ocean_blvd_unit_hash.txt', 'utf8');
		const ca = normalizeAddress(text);
		const res = await reconcileOne(ca, dao);
		expect(['EXACT', 'CLOSE']).toContain(res.status);
		// account for unit vs suite token normalization; should be at least close
		expect(res.scores.address).toBeGreaterThanOrEqual(92);
		expect(res.scores.name).toBeGreaterThanOrEqual(90);
	});

	it('handles Hwy vs Highway equivalence', async () => {
		const dao = new CSVBackend(csvPath);
		const text = await fs.readFile('data/fixtures/texts/hwy_vs_highway.txt', 'utf8');
		const ca = normalizeAddress(text);
		const res = await reconcileOne(ca, dao);
		expect(['EXACT', 'CLOSE']).toContain(res.status);
		expect(res.scores.address).toBeGreaterThanOrEqual(92);
	});
});


