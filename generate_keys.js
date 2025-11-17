import fs from 'fs';

// Simple normalization function (copied from types.ts)
function normalizeForKey(s) {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

// Canonical key function (copied from types.ts)
function canonicalKey(rec) {
	return [
		normalizeForKey(rec.name),
		normalizeForKey(rec.address1),
		normalizeForKey(rec.city),
		normalizeForKey(rec.state),
		normalizeForKey(rec.postal_code.slice(0, 5)),
	].join('|');
}

// Read the CSV file
const csv = fs.readFileSync('./data/locations.sample.csv', 'utf8');
const lines = csv.split('\n').filter(line => line.trim());

console.log('Search keys for each row:');
lines.slice(1).forEach((line, index) => {
	if (line.trim()) {
		const parts = line.split(',');
		const name = parts[1];
		const address1 = parts[2];
		const city = parts[4];
		const state = parts[5];
		const postal_code = parts[6];

		const searchKey = canonicalKey({
			name,
			address1,
			city,
			state,
			postal_code
		});

		console.log(`${index + 1}: ${searchKey}`);
	}
});
