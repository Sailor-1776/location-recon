import { Command } from 'commander';
import { loadConfig } from '../config';
import { getDAO } from '../match/locationsDAO';
import { normalizeAddress } from '../normalize/address';
import { reconcileOne } from '../match/matcher';
import { canonicalKey } from '../types';

export async function runCli(argv: string[]): Promise<number> {
	const program = new Command();
	program
		.option('--text <block>', 'free-text address block')
		.option('--name <name>', 'location name')
		.option('--address1 <line>', 'address line 1')
		.option('--address2 <line>', 'address line 2')
		.option('--city <city>', 'city')
		.option('--state <state>', 'state (2-letter)')
		.option('--postal <zip>', 'postal/zip code');
	program.parse(argv, { from: 'user' });
	const opts = program.opts<{
		text?: string;
		name?: string;
		address1?: string;
		address2?: string;
		city?: string;
		state?: string;
		postal?: string;
	}>();

	const config = loadConfig();
	const dao = getDAO(config.mr8Driver);

	const ca =
		opts.text && opts.text.trim()
			? normalizeAddress(opts.text)
			: {
					name: opts.name,
					address1: String(opts.address1 || ''),
					address2: opts.address2 ? String(opts.address2) : undefined,
					city: String(opts.city || ''),
					state: String(opts.state || '').toUpperCase(),
					postal_code: String(opts.postal || '').slice(0, 5),
					country: 'US',
			  };

	const match = await reconcileOne(ca, dao);

	if (match.status === 'EXACT' && match.record) {
		const key =
			match.record.search_key ||
			canonicalKey({
				name: match.record.name,
				address1: match.record.address1,
				city: match.record.city,
				state: match.record.state,
				postal_code: match.record.postal_code,
			});
		process.stdout.write(
			JSON.stringify({ status: 'EXACT', search_key: key, id: match.record.id ?? null, record: match.record }) +
				'\n',
		);
		return 0;
	}

	process.stdout.write(
		JSON.stringify({
			status: 'NEEDS_MORE_DATA',
			message: 'Find additional Data',
			diffs: match.diffs,
			candidate: match.record ?? null,
		}) + '\n',
	);
	return 0;
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


