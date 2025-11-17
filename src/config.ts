import * as path from 'node:path';
import * as fs from 'node:fs';
import dotenv from 'dotenv';

export type MR8Driver = 'sqlserver' | 'odbc' | 'csv';

export interface AppConfig {
	mr8Driver: MR8Driver;
	sqlserver?: {
		host: string;
		port: number;
		database: string;
		username: string;
		password: string;
	};
	odbc?: {
		dsn: string;
		uid: string;
		pwd: string;
	};
	csv: {
		path: string;
	};
	logLevel: 'error' | 'warn' | 'info' | 'debug';
	port: number;
}

let loaded = false;

export function loadConfig(): AppConfig {
	if (!loaded) {
		// Load default .env first (if present)
		dotenv.config();
		// Also allow a non-dot fallback file for server-only environments
		try {
			const extraPath = path.join(process.cwd(), 'server.env');
			if (fs.existsSync(extraPath)) {
				dotenv.config({ path: extraPath });
			}
		} catch {
			// ignore
		}
		loaded = true;
	}

	const mr8Driver = (process.env.MR8_DRIVER as MR8Driver) || 'csv';
	const csvPath = process.env.LOCATIONS_CSV_PATH || 'data/locations.sample.csv';

	const resolveRepoPath = (p: string): string => {
		if (path.isAbsolute(p)) return p;
		return path.join(process.cwd(), p);
	};

	const cfg: AppConfig = {
		mr8Driver,
		sqlserver:
			mr8Driver === 'sqlserver'
				? {
						host: process.env.SQLSERVER_HOST || '',
						port: Number(process.env.SQLSERVER_PORT || '1433'),
						database: process.env.SQLSERVER_DATABASE || '',
						username: process.env.SQLSERVER_USERNAME || '',
						password: process.env.SQLSERVER_PASSWORD || '',
				  }
				: undefined,
		odbc:
			mr8Driver === 'odbc'
				? {
						dsn: process.env.ODBC_DSN || '',
						uid: process.env.ODBC_UID || '',
						pwd: process.env.ODBC_PWD || '',
				  }
				: undefined,
		csv: {
			path: resolveRepoPath(csvPath),
		},
		logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',
		port: Number(process.env.PORT || '3000'),
	};

	// Ensure CSV exists when using csv backend
	if (cfg.mr8Driver === 'csv') {
		try {
			const exists = fs.existsSync(cfg.csv.path);
			if (!exists) {
				// eslint-disable-next-line no-console
				console.warn(`CSV backend: file not found at ${cfg.csv.path}`);
			}
		} catch {
			// ignore
		}
	}

	return cfg;
}


