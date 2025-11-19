import type { CanonicalAddress, LocationRecord } from '../types';
import { normalizeAddress } from '../normalize/address';
import { getLogger } from '../utils/logger';

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

/**
 * Extracts and formats the warning message from a location record.
 * If an LLM API is configured, it will use the LLM to clean up and format the warning.
 * Otherwise, it returns the warning as-is.
 */
export async function extractWarningMessage(record: LocationRecord): Promise<string | null> {
	if (!record.warning || !record.warning.trim()) {
		return null;
	}

	const warningText = record.warning.trim();
	const logger = getLogger();

	// Check if LLM API is configured (OpenAI or Anthropic)
	const openaiApiKey = process.env.OPENAI_API_KEY;
	const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

	if (openaiApiKey) {
		try {
			// Use OpenAI to format the warning
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${openaiApiKey}`,
				},
				body: JSON.stringify({
					model: 'gpt-4o-mini',
					messages: [
						{
							role: 'system',
							content: 'You are a helpful assistant that extracts and formats warning messages from location records. Return only the cleaned and formatted warning message, preserving all important information.',
						},
						{
							role: 'user',
							content: `Extract and format the warning message from this location record:\n\nLocation: ${record.name}\nAddress: ${record.address1}${record.address2 ? ', ' + record.address2 : ''}, ${record.city}, ${record.state} ${record.postal_code}\nDepartment: ${record.department || 'N/A'}\n\nWarning text: ${warningText}`,
						},
					],
					temperature: 0.3,
					max_tokens: 500,
				}),
			});

			if (response.ok) {
				const data = await response.json();
				const formatted = data.choices?.[0]?.message?.content?.trim();
				if (formatted) {
					return formatted;
				}
			}
		} catch (e: any) {
			logger.warn('OpenAI API call failed, falling back to raw warning', { error: e?.message });
		}
	} else if (anthropicApiKey) {
		try {
			// Use Anthropic Claude to format the warning
			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': anthropicApiKey,
					'anthropic-version': '2023-06-01',
				},
				body: JSON.stringify({
					model: 'claude-3-5-sonnet-20241022',
					max_tokens: 500,
					messages: [
						{
							role: 'user',
							content: `Extract and format the warning message from this location record:\n\nLocation: ${record.name}\nAddress: ${record.address1}${record.address2 ? ', ' + record.address2 : ''}, ${record.city}, ${record.state} ${record.postal_code}\nDepartment: ${record.department || 'N/A'}\n\nWarning text: ${warningText}\n\nReturn only the cleaned and formatted warning message, preserving all important information.`,
						},
					],
				}),
			});

			if (response.ok) {
				const data = await response.json();
				const formatted = data.content?.[0]?.text?.trim();
				if (formatted) {
					return formatted;
				}
			}
		} catch (e: any) {
			logger.warn('Anthropic API call failed, falling back to raw warning', { error: e?.message });
		}
	}

	// Fallback: return the warning as-is
	return warningText;
}

/**
 * Extracts search-key-like patterns from a warning message.
 * Looks for patterns like "SVPT-M", "UTPHYS-M", "COLLACARE-M" that appear after "Issue to:" 
 * or similar prefixes in the warning text.
 * 
 * @param warningText - The warning text to search
 * @param searchKey - The search key to compare against (optional, for similarity matching)
 * @returns The extracted search-key-like pattern, or null if none found
 */
export function extractSearchKeyFromWarning(warningText: string, searchKey?: string): string | null {
	if (!warningText || !warningText.trim()) {
		return null;
	}

	const text = warningText.trim();
	
	// Pattern to match search-key-like strings:
	// - Uppercase letters and numbers
	// - May contain dashes
	// - Typically appears after "Issue to:" or similar prefixes
	// - Examples: "SVPT-M", "UTPHYS-M", "COLLACARE-M", "ABILENERMC-M"
	const searchKeyPattern = /\b([A-Z0-9]+(?:-[A-Z0-9]+)*)\b/g;
	
	// Look for patterns after common prefixes
	const prefixes = [
		/Issue\s+to:\s*/i,
		/Issue\s+to\s*/i,
		/Send\s+to:\s*/i,
		/Send\s+to\s*/i,
	];
	
	let candidates: Array<{ match: string; position: number; similarity?: number }> = [];
	
	// First, try to find patterns after known prefixes
	for (const prefix of prefixes) {
		const prefixMatch = text.match(prefix);
		if (prefixMatch) {
			const afterPrefix = text.substring(prefixMatch.index! + prefixMatch[0].length);
			// Look for search key pattern, but stop at separators like "---" or "--"
			const separatorMatch = afterPrefix.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s*---|\s*--|\s*$)/);
			if (separatorMatch) {
				const candidate = separatorMatch[1];
				if (candidate && candidate.length >= 3) {
					candidates.push({
						match: candidate,
						position: 0,
					});
					// If we found a candidate after a prefix, use it
					break;
				}
			} else {
				// Fallback: try the regex pattern match
				const matches = Array.from(afterPrefix.matchAll(searchKeyPattern));
				const firstMatch = matches[0];
				if (matches.length > 0 && firstMatch && firstMatch[1] && firstMatch.index !== undefined) {
					const candidate = firstMatch[1];
					const matchIndex = firstMatch.index;
					// Extract up to the first separator if present
					const separatorIndex = afterPrefix.indexOf('---', matchIndex);
					const dashIndex = afterPrefix.indexOf('--', matchIndex);
					let endIndex = separatorIndex !== -1 ? separatorIndex : (dashIndex !== -1 ? dashIndex : undefined);
					
					if (endIndex !== undefined && endIndex > matchIndex) {
						const beforeSeparator = afterPrefix.substring(matchIndex, endIndex).trim();
						const cleanMatch = beforeSeparator.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)/);
						if (cleanMatch && cleanMatch[1] && cleanMatch[1].length >= 3) {
							candidates.push({
								match: cleanMatch[1],
								position: 0,
							});
							break;
						}
					} else if (candidate.length >= 3) {
						candidates.push({
							match: candidate,
							position: 0,
						});
						break;
					}
				}
			}
		}
	}
	
	// If no prefix match, search the entire text for search-key-like patterns
	if (candidates.length === 0) {
		const matches = Array.from(text.matchAll(searchKeyPattern));
		for (const match of matches) {
			const candidate = match[1];
			const matchIndex = match.index;
			// Filter out very short matches and common false positives
			if (candidate && candidate.length >= 3 && 
			    !/^(THE|AND|OR|TO|FOR|WITH|FROM)$/i.test(candidate) &&
			    matchIndex !== undefined) {
				candidates.push({
					match: candidate,
					position: matchIndex,
				});
			}
		}
	}
	
	if (candidates.length === 0) {
		return null;
	}
	
	// If we have a search key to compare against, find the most similar candidate
	if (searchKey) {
		const searchKeyBase = searchKey.replace(/-non$/, '').toUpperCase();
		
		for (const candidate of candidates) {
			// Calculate similarity (simple character overlap)
			const candidateUpper = candidate.match.toUpperCase();
			const similarity = calculateSimilarity(searchKeyBase, candidateUpper);
			candidate.similarity = similarity;
		}
		
		// Sort by similarity (highest first) and return the best match
		candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
		const bestCandidate = candidates[0];
		return bestCandidate ? bestCandidate.match : null;
	}
	
	// Otherwise, return the first candidate (usually the one after "Issue to:")
	const firstCandidate = candidates[0];
	return firstCandidate ? firstCandidate.match : null;
}

/**
 * Calculates a simple similarity score between two strings.
 * Returns a value between 0 and 1, where 1 is identical.
 */
function calculateSimilarity(str1: string, str2: string): number {
	if (!str1 || !str2) return 0;
	if (str1 === str2) return 1.0;
	
	// Check if one contains the other
	if (str1.includes(str2) || str2.includes(str1)) {
		return 0.8;
	}
	
	// Count common characters
	const set1 = new Set(str1);
	const set2 = new Set(str2);
	const intersection = new Set([...set1].filter(x => set2.has(x)));
	const union = new Set([...set1, ...set2]);
	
	if (union.size === 0) return 0;
	return intersection.size / union.size;
}


