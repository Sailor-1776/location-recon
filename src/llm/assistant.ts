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


