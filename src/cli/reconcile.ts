import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../config';
import { getLogger } from '../utils/logger';
import * as pdfReader from '../ingest/pdfReader';
import * as emailReader from '../ingest/emailReader';
import { extractCandidateBlocks } from '../ingest/textUtils';
import { normalizeAddress } from '../normalize/address';
import { getDAO } from '../match/locationsDAO';
import { reconcileOne } from '../match/matcher';
import { canonicalKey, type CanonicalAddress } from '../types';
import { stringify } from 'csv-stringify';

type Format = 'jsonl';

export interface CLIOptions {
	input: string;
	format: Format;
	limit?: number;
	saveCsv?: string | null;
}

async function readTextForFile(filePath: string): Promise<string> {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === '.pdf') return pdfReader.extractText(filePath);
	if (ext === '.eml' || ext === '.msg') return emailReader.extractText(filePath);
	// default: text
	return fsp.readFile(filePath, 'utf8');
}

function* iterFiles(input: string): Generator<string> {
	const stat = fs.statSync(input);
	if (stat.isFile()) {
		yield input;
	} else if (stat.isDirectory()) {
		const entries = fs.readdirSync(input, { withFileTypes: true });
		for (const e of entries) {
			if (e.isFile()) {
				const ext = path.extname(e.name).toLowerCase();
				if (['.pdf', '.eml', '.msg', '.txt'].includes(ext)) {
					yield path.join(input, e.name);
				}
			}
		}
	}
}

export async function runCli(argv: string[]): Promise<number> {
	const program = new Command();
	program
		.requiredOption('--input <file|dir|->', 'input file, directory, or "-" for stdin')
		.option('--format <fmt>', 'output format', 'jsonl')
		.option('--limit <n>', 'limit number of candidate blocks', (v) => Number(v))
		.option('--save-csv <path>', 'write NEW items to CSV', undefined);
	program.parse(argv, { from: 'user' });
	const opts = program.opts<{
		input: string;
		format: string;
		limit?: number;
		saveCsv?: string;
	}>();

	const config = loadConfig();
	const logger = getLogger();
	const dao = getDAO(config.mr8Driver);
	const outFmt = (opts.format as Format) || 'jsonl';
	const writer = process.stdout;

	let fileTexts: Array<{ file: string; text: string }> = [];
	if (opts.input === '-') {
		const buf = await fsp.readFile(0, 'utf8');
		fileTexts.push({ file: '<stdin>', text: buf });
	} else {
		for (const fp of iterFiles(opts.input)) {
			const text = await readTextForFile(fp);
			fileTexts.push({ file: fp, text });
		}
	}

	const newItems: CanonicalAddress[] = [];
	const printedKeys = new Set<string>();
	let total = 0;
	for (const { file, text } of fileTexts) {
		const blocks = extractCandidateBlocks(text);
		for (const block of blocks.slice(0, opts.limit || blocks.length)) {
			const ca = normalizeAddress(block);
			const match = await reconcileOne(ca, dao);
			const line = {
				file,
				block: block.split(/\n/).slice(0, 3).join(' '),
				parsed: ca,
				match,
			};
			if (outFmt === 'jsonl') {
				writer.write(JSON.stringify(line) + '\n');
			}
			if (match.status === 'NEW') {
				const key = canonicalKey({
					name: ca.name || '',
					address1: ca.address1,
					city: ca.city,
					state: ca.state,
					postal_code: ca.postal_code,
				});
				if (!printedKeys.has(key)) {
					newItems.push(ca);
					printedKeys.add(key);
				}
			}
			total++;
		}
	}

	if (opts.saveCsv) {
		await new Promise<void>((resolve, reject) => {
			const csv = stringify(
				newItems.map((n) => ({
					name: n.name || '',
					address1: n.address1,
					address2: n.address2 || '',
					city: n.city,
					state: n.state,
					postal_code: n.postal_code,
					country: n.country || 'US',
					search_key: canonicalKey({
						name: n.name || '',
						address1: n.address1,
						city: n.city,
						state: n.state,
						postal_code: n.postal_code,
					}),
				})),
				{ header: true, columns: ['name', 'address1', 'address2', 'city', 'state', 'postal_code', 'country', 'search_key'] },
			);
			const out = fs.createWriteStream(opts.saveCsv!);
			csv.pipe(out);
			out.on('finish', resolve);
			out.on('error', reject);
		});
		logger.info(`Wrote NEW items to ${opts.saveCsv}`);
	}

	return total > 0 ? 0 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runCli(process.argv).then(
		(code) => {
			process.exitCode = code;
		},
		(err) => {
			// eslint-disable-next-line no-console
			console.error(err);
			process.exitCode = 1;
		},
	);
}


