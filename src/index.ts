import { loadConfig } from './config';
import { getLogger } from './utils/logger';

async function main(): Promise<void> {
	const config = loadConfig();
	const logger = getLogger();
	logger.info(
		`Location Reconciliation Tool ready. Use CLI via "pnpm cli" or run the review UI via "pnpm ui:dev". Active backend: ${config.mr8Driver}`,
	);
}

// Only run when invoked directly (not when imported)
if (import.meta.url === `file://${process.argv[1]}`) {
	// eslint-disable-next-line no-console
	main().catch((err) => {
		// eslint-disable-next-line no-console
		console.error(err);
		process.exitCode = 1;
	});
}

export * from './types.js';
export * from './normalize/address.js';
export * from './match/matcher.js';
export * from './match/locationsDAO.js';


