const STATE_ABBRS = new Set([
	'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

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

function looksLikeCityStateZip(line: string): boolean {
	// First try to match 2-letter state abbreviation: "City, ST 12345"
	let m = line.match(/,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/i);
	if (m) {
		const st = m[1].toUpperCase();
		if (STATE_ABBRS.has(st)) return true;
	}
	
	// Try to match full state name: "City, StateName 12345"
	// Match: comma, optional whitespace, state name (one or more words), whitespace, 5-digit zip
	m = line.match(/,\s*([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d{5})(?:-\d{4})?$/i);
	if (m) {
		const stateName = m[1].toLowerCase().trim();
		// Check if it's a valid state name
		if (STATE_TO_ABBR[stateName]) return true;
	}
	
	return false;
}

function hasUnit(line: string): boolean {
	return /\b(suite|ste|unit|#)\b\s*\w+/i.test(line);
}

function looksLikeDepartment(line: string): boolean {
	if (!line || !line.trim()) return false;
	
	// Pattern: date range followed by dash/em-dash/en-dash and department name
	const dateRangePattern = /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+to\s+(?:Present|\d{1,2}\/\d{1,2}\/\d{2,4})\s*[–—-]\s*(.+)$/i;
	if (dateRangePattern.test(line)) return true;
	
	// Check if line contains department keywords and doesn't look like an address
	const departmentKeywords = [
		'records', 'department', 'billing', 'radiology', 'legal', 'hr', 'human resources',
		'medical records', 'health information', 'hims', 'compliance', 'administration'
	];
	const lowerLine = line.toLowerCase();
	const hasKeyword = departmentKeywords.some(keyword => lowerLine.includes(keyword));
	const looksLikeAddress = /\d+\s+\w+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln)/i.test(line);
	
	return hasKeyword && !looksLikeAddress;
}

export function extractCandidateBlocks(text: string): string[] {
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	const blocks: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		// Heuristic: if a line looks like city, state zip, include previous 1-2 lines
		if (looksLikeCityStateZip(l)) {
			const prev1 = lines[i - 1] || '';
			const prev2 = lines[i - 2] || '';
			const nameOrAddr = prev2 && !/\d/.test(prev2) ? prev2 : prev1 && !/\d/.test(prev1) ? prev1 : '';
			const addrLine = prev2 && /\d/.test(prev2) ? prev2 : prev1 && /\d/.test(prev1) ? prev1 : '';
			const name = nameOrAddr || (addrLine ? (lines[i - 3] || '') : '');
			const blockParts = [name, addrLine, l].filter((x) => x && x.trim());
			
			// Check if the next line(s) look like department information
			// Include up to 2 lines after city/state/zip if they look like departments
			const next1 = lines[i + 1] || '';
			const next2 = lines[i + 2] || '';
			if (looksLikeDepartment(next1)) {
				blockParts.push(next1);
				// If next2 also looks like department, include it too (for multi-line departments)
				if (looksLikeDepartment(next2)) {
					blockParts.push(next2);
				}
			}
			
			blocks.push(blockParts.join('\n'));
		} else if (hasUnit(l)) {
			// If a line has a unit and the next line is city/state/zip, include this one.
			const next = lines[i + 1] || '';
			if (looksLikeCityStateZip(next)) {
				const name = lines[i - 1] || '';
				const blockParts = [name, l, next].filter((x) => x && x.trim());
				
				// Check for department lines after city/state/zip
				const nextAfterCityState = lines[i + 2] || '';
				const nextAfterCityState2 = lines[i + 3] || '';
				if (looksLikeDepartment(nextAfterCityState)) {
					blockParts.push(nextAfterCityState);
					if (looksLikeDepartment(nextAfterCityState2)) {
						blockParts.push(nextAfterCityState2);
					}
				}
				
				blocks.push(blockParts.join('\n'));
			}
		}
	}
	// Deduplicate while preserving order
	const seen = new Set<string>();
	return blocks.filter((b) => {
		const key = b.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}


