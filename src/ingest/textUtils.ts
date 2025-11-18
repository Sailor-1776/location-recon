import type { PdfTextPage } from './pdfReader';

export type BlockWithPosition = {
	block: string;
	facilityNameLine: string;
	pageIndex: number;
	y: number;
	x?: number;
	maxX?: number;
};

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

/**
 * Helper function to normalize text for matching
 */
function normalizeForMatch(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Calculates similarity between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
	const norm1 = normalizeForMatch(str1);
	const norm2 = normalizeForMatch(str2);
	if (norm1 === norm2) return 1.0;
	if (norm1.includes(norm2) || norm2.includes(norm1)) {
		return Math.min(norm1.length, norm2.length) / Math.max(norm1.length, norm2.length);
	}
	// Token-based similarity
	const tokens1 = new Set(norm1.split(/\s+/).filter(Boolean));
	const tokens2 = new Set(norm2.split(/\s+/).filter(Boolean));
	if (tokens1.size === 0 || tokens2.size === 0) return 0;
	let intersection = 0;
	for (const token of tokens1) {
		if (tokens2.has(token)) intersection++;
	}
	return intersection / Math.max(tokens1.size, tokens2.size);
}

/**
 * Finds the position of a text line in the PDF positional data
 * Uses context-aware matching to find the correct facility name line
 */
function findLinePosition(
	lineText: string,
	pages: PdfTextPage[] | undefined,
	lineIndexInText: number,
	contextLines?: string[] // Optional: nearby lines for context matching
): { pageIndex: number; y: number; x?: number; maxX?: number } | null {
	if (!pages || pages.length === 0 || !lineText || !lineText.trim()) {
		return null;
	}

	const normalizedTarget = normalizeForMatch(lineText);
	if (!normalizedTarget || normalizedTarget.length < 3) {
		return null;
	}

	let bestMatch: { pageIndex: number; y: number; x?: number; maxX?: number; score: number } | null = null;
	const MIN_SIMILARITY = 0.5; // Lower threshold to 50% similarity to catch more matches

	// Search through all pages for the best matching line
	for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
		const page = pages[pageIdx];
		if (!page || !page.lines) continue;

		for (let lineIdx = 0; lineIdx < page.lines.length; lineIdx++) {
			const line = page.lines[lineIdx];
			if (!line || !line.text) continue;

			const normalizedLine = normalizeForMatch(line.text);
			if (!normalizedLine) continue;

			// Calculate similarity score
			let score = calculateSimilarity(lineText, line.text);

			// Boost score if we have context and the next line matches context
			if (contextLines && contextLines.length > 0 && lineIdx + 1 < page.lines.length) {
				const nextLine = page.lines[lineIdx + 1];
				if (nextLine && nextLine.text) {
					const nextLineNorm = normalizeForMatch(nextLine.text);
					for (const contextLine of contextLines) {
						const contextNorm = normalizeForMatch(contextLine);
						// More lenient context matching
						if (nextLineNorm.includes(contextNorm) || 
						    contextNorm.includes(nextLineNorm) ||
						    calculateSimilarity(nextLineNorm, contextNorm) > 0.4) {
							score += 0.3; // Larger boost for context match
							break;
						}
					}
				}
			}
			
			// Also check previous line for context (sometimes facility name comes after address in PDF)
			if (contextLines && contextLines.length > 0 && lineIdx > 0) {
				const prevLine = page.lines[lineIdx - 1];
				if (prevLine && prevLine.text) {
					const prevLineNorm = normalizeForMatch(prevLine.text);
					for (const contextLine of contextLines) {
						const contextNorm = normalizeForMatch(contextLine);
						if (prevLineNorm.includes(contextNorm) || 
						    contextNorm.includes(prevLineNorm) ||
						    calculateSimilarity(prevLineNorm, contextNorm) > 0.4) {
							score += 0.2; // Boost for previous line context match
							break;
						}
					}
				}
			}

			// Only consider matches above minimum similarity threshold
			if (score >= MIN_SIMILARITY) {
				if (!bestMatch || score > bestMatch.score) {
					bestMatch = {
						pageIndex: pageIdx,
						y: line.y,
						x: line.x,
						maxX: line.maxX,
						score,
					};
				}
			}
		}
	}

	return bestMatch ? {
		pageIndex: bestMatch.pageIndex,
		y: bestMatch.y,
		x: bestMatch.x,
		maxX: bestMatch.maxX,
	} : null;
}

/**
 * Extracts structured facility information from text following the pattern:
 * Facility name
 * Facility Address
 * Facility city, state, zip code
 * Facility Phone Number (optional)
 * Department (optional)
 * 
 * Example:
 * Rio Grande Regional Hospital
 * 101 E. Ridge Road
 * McAllen, Texas 78503
 * P: (956) 632-6000
 * 07/13/23 to Present – Radiology Records
 */
export function extractStructuredFacilities(text: string, pages?: PdfTextPage[]): BlockWithPosition[] {
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	const blocks: BlockWithPosition[] = [];
	
	// Look for patterns where we have:
	// 1. A facility name (line without numbers, or with minimal numbers)
	// 2. An address line (contains street number and street name)
	// 3. City, state, zip line
	// 4. Optional phone number
	// 5. Optional department
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		
		// If we find a city/state/zip line, look backwards for facility info
		if (looksLikeCityStateZip(line)) {
			const cityStateZipLine = line;
			const addressLine = lines[i - 1] || '';
			const potentialNameLine = lines[i - 2] || '';
			const potentialFacilityNameLine = lines[i - 3] || '';
			const phoneLine = lines[i + 1] || '';
			const departmentLine = lines[i + 2] || '';
			
			// Address should have a street number
			const hasValidAddress = addressLine && /^\d+/.test(addressLine);
			
			if (!hasValidAddress) continue;
			
			// Determine the facility name line
			// Check if potentialNameLine looks like a doctor name (contains M.D., MD, D.O., DO, etc.)
			const looksLikeDoctorName = /,\s*(M\.?D\.?|D\.?O\.?|P\.?A\.?|N\.?P\.?)/i.test(potentialNameLine);
			
			let nameLine: string;
			let blockParts: string[];
			
			if (looksLikeDoctorName && potentialFacilityNameLine) {
				// We have: facility name, doctor name, address, city/state/zip
				nameLine = potentialFacilityNameLine;
				blockParts = [nameLine, potentialNameLine, addressLine, cityStateZipLine];
			} else {
				// Standard case: facility name, address, city/state/zip
				nameLine = potentialNameLine;
				// Name should not look like an address (no street numbers)
				const hasValidName = nameLine && !/^\d+\s/.test(nameLine) && nameLine.length > 3;
				if (!hasValidName) continue;
				blockParts = [nameLine, addressLine, cityStateZipLine];
			}
			
			// Add phone if present (starts with P:, Phone:, Tel:, etc. or matches phone pattern)
			if (phoneLine && /^P:?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i.test(phoneLine)) {
				blockParts.push(phoneLine);
			}
			
			// Add department if present
			if (looksLikeDepartment(departmentLine)) {
				blockParts.push(departmentLine);
			} else if (looksLikeDepartment(phoneLine) && !/^P:?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i.test(phoneLine)) {
				// Sometimes department is on the phone line if phone wasn't there
				blockParts.push(phoneLine);
			}
			
			const blockText = blockParts.join('\n');
			
			// Try to find position of facility name line in PDF
			// Pass address line as context to improve matching accuracy
			const contextLines = addressLine ? [addressLine] : undefined;
			const position = findLinePosition(nameLine, pages, i - (looksLikeDoctorName ? 3 : 2), contextLines);
			
			if (position && position.y > 0) {
				blocks.push({
					block: blockText,
					facilityNameLine: nameLine,
					pageIndex: position.pageIndex,
					y: position.y,
					x: position.x,
					maxX: position.maxX,
				});
			} else {
				// Fallback: create block without position (will use search fallback)
				blocks.push({
					block: blockText,
					facilityNameLine: nameLine,
					pageIndex: 0,
					y: 0,
				});
			}
		}
	}
	
	// Deduplicate while preserving order
	const seen = new Set<string>();
	return blocks.filter((b) => {
		const key = b.block.toLowerCase().replace(/\s+/g, ' ');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Checks if a block contains medical/healthcare-related keywords
 */
function containsMedicalKeywords(block: string): boolean {
	const medicalKeywords = [
		'hospital',
		'dr.',
		'dr ',
		'doctor',
		'medical',
		'billing',
		'radiology',
		'pharmacy',
		'pharmacist',
		'clinic',
		'healthcare',
		'health care',
		'physician',
		'surgeon',
		'nurse',
		'nursing',
		'emergency',
		'er ',
		'urgent care',
		'laboratory',
		'lab ',
		'pathology',
		'cardiology',
		'orthopedic',
		'pediatric',
		'obstetric',
		'gynecology',
		'neurology',
		'oncology',
		'dermatology',
		'psychiatry',
		'mental health',
		'therapy',
		'rehabilitation',
		'physical therapy',
		'occupational therapy',
		'medical records',
		'health information',
		'hims',
		'm.d.',
		'md ',
		'd.o.',
		'do ',
		'p.a.',
		'pa ',
		'n.p.',
		'np ',
		'rn ',
		'registered nurse',
		'practice',
		'facility',
		'center',
		'centre',
		'medical center',
		'health center',
		'surgical',
		'surgery',
		'operating room',
		'or ',
		'icu',
		'intensive care',
		'x-ray',
		'xray',
		'mri',
		'ct scan',
		'ultrasound',
		'mammography',
		'diagnostic',
		'imaging',
		'pharmaceutical',
		'prescription',
		'medication',
		'home health',
		'hospice',
		'nursing home',
		'assisted living',
		'skilled nursing',
		'rehab',
		'primary care',
		'specialist',
		'specialty',
		'medical group',
		'medical practice',
		'group practice',
		'private practice',
		'medical office',
		'outpatient',
		'inpatient',
		'ambulatory',
		'procedure',
		'treatment',
		'patient',
		'provider',
	];

	const blockLower = block.toLowerCase();
	return medicalKeywords.some(keyword => blockLower.includes(keyword));
}

/**
 * Filters blocks to only include those containing medical/healthcare keywords
 */
export function filterMedicalBlocks(blocks: BlockWithPosition[]): BlockWithPosition[] {
	return blocks.filter(block => containsMedicalKeywords(block.block));
}

/**
 * Converts BlockWithPosition[] to string[] for backward compatibility
 */
export function blocksToStrings(blocks: BlockWithPosition[]): string[] {
	return blocks.map(b => b.block);
}

export function extractCandidateBlocks(text: string, pages?: PdfTextPage[]): BlockWithPosition[] {
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	const blocks: BlockWithPosition[] = [];
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
			
			const blockText = blockParts.join('\n');
			const nameLine = name || blockParts[0] || '';
			
			// Try to find position of facility name line in PDF
			// Pass address line as context to improve matching accuracy
			const nameLineIndex = name ? (nameOrAddr === prev2 ? i - 2 : i - 1) : (addrLine === prev2 ? i - 3 : i - 2);
			const contextLines = addrLine ? [addrLine] : undefined;
			const position = nameLine ? findLinePosition(nameLine, pages, nameLineIndex, contextLines) : null;
			
			if (position && position.y > 0) {
				blocks.push({
					block: blockText,
					facilityNameLine: nameLine,
					pageIndex: position.pageIndex,
					y: position.y,
					x: position.x,
					maxX: position.maxX,
				});
			} else {
				// Fallback: create block without position (will use search fallback)
				blocks.push({
					block: blockText,
					facilityNameLine: nameLine,
					pageIndex: 0,
					y: 0,
				});
			}
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
				
				const blockText = blockParts.join('\n');
				const nameLine = name || blockParts[0] || '';
				
				// Try to find position of facility name line in PDF
				// Pass unit line as context to improve matching accuracy
				const contextLines = l ? [l] : undefined;
				const position = nameLine ? findLinePosition(nameLine, pages, i - 1, contextLines) : null;
				
				if (position) {
					blocks.push({
						block: blockText,
						facilityNameLine: nameLine,
						pageIndex: position.pageIndex,
						y: position.y,
						x: position.x,
						maxX: position.maxX,
					});
				} else {
					// Fallback: create block without position (will use search fallback)
					blocks.push({
						block: blockText,
						facilityNameLine: nameLine,
						pageIndex: 0,
						y: 0,
					});
				}
			}
		}
	}
	// Deduplicate while preserving order
	const seen = new Set<string>();
	return blocks.filter((b) => {
		const key = b.block.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}


