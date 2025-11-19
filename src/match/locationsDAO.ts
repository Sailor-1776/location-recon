import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { AppConfig, MR8Driver } from '../config';
import { loadConfig } from '../config';
import { getLogger } from '../utils/logger';
import { LocationRecord, fromRow } from '../types';

// Use an eval-wrapped require so bundlers (Next/Webpack) don't statically analyze
// and attempt to bundle native modules like 'odbc' or 'mssql'.
const nodeRequire = (id: string): any => (eval('require') as any)(id);

export interface LocationsDAO {
	iterLocations(): AsyncGenerator<LocationRecord>;
	findCandidates(blockingKey: {
		city: string;
		state: string;
		postal_code?: string;
	}): Promise<LocationRecord[]>;
	healthCheck(): Promise<{ ok: boolean; details: string }>;
}

class MSSQLBackend implements LocationsDAO {
	private pool: any | null = null;
	private cfg: NonNullable<AppConfig['sqlserver']>;
	private logger = getLogger();
	constructor(cfg: NonNullable<AppConfig['sqlserver']>) {
		this.cfg = cfg;
	}
	private async ensurePool(): Promise<any> {
		if (this.pool) return this.pool;
		const sql = nodeRequire('mssql');
		this.pool = await new sql.ConnectionPool({
			server: this.cfg.host,
			port: this.cfg.port,
			database: this.cfg.database,
			user: this.cfg.username,
			password: this.cfg.password,
			options: {
				encrypt: true,
				trustServerCertificate: true,
			},
		}).connect();
		return this.pool;
	}
	async *iterLocations(): AsyncGenerator<LocationRecord> {
		try {
			const pool = await this.ensurePool();
			// Table name unknown; use a safe read-only view name convention if available, or generic query
			const result = await pool
				.request()
				.query(
					'SELECT id, name, address1, address2, city, state, postal_code, country, latitude, longitude, search_key, department, warning FROM Locations',
				);
			for (const row of result.recordset) {
				yield fromRow(row);
			}
		} catch (e) {
			this.logger.warn('MSSQL iterLocations failed', e);
		}
	}
	async findCandidates(blockingKey: {
		city: string;
		state: string;
		postal_code?: string;
	}): Promise<LocationRecord[]> {
		try {
			const pool = await this.ensurePool();
			if (blockingKey.postal_code) {
				const result = await pool
					.request()
					.input('zip', blockingKey.postal_code.slice(0, 5))
					.query(
						'SELECT id, name, address1, address2, city, state, postal_code, country, latitude, longitude, search_key, department, warning FROM Locations WHERE postal_code LIKE @zip + \'%\'',
					);
				return result.recordset.map(fromRow);
			}
			const result = await pool
				.request()
				.input('city', blockingKey.city)
				.input('state', blockingKey.state)
				.query(
					'SELECT id, name, address1, address2, city, state, postal_code, country, latitude, longitude, search_key, department, warning FROM Locations WHERE city = @city AND state = @state',
				);
			return result.recordset.map(fromRow);
		} catch (e) {
			this.logger.warn('MSSQL findCandidates failed', e);
			return [];
		}
	}
	async healthCheck(): Promise<{ ok: boolean; details: string }> {
		try {
			await this.ensurePool();
			return { ok: true, details: 'MSSQL connected' };
		} catch (e: any) {
			return { ok: false, details: `MSSQL error: ${e?.message || String(e)}` };
		}
	}
}

class ODBCBackend implements LocationsDAO {
	private conn: any | null = null;
	private cfg: NonNullable<AppConfig['odbc']>;
	private logger = getLogger();
	constructor(cfg: NonNullable<AppConfig['odbc']>) {
		this.cfg = cfg;
	}
	private async ensureConn(): Promise<any> {
		if (this.conn) return this.conn;
		const odbc = nodeRequire('odbc');
		this.conn = await odbc.connect(
			`DSN=${this.cfg.dsn};UID=${this.cfg.uid};PWD=${this.cfg.pwd};`,
		);
		return this.conn;
	}
	async *iterLocations(): AsyncGenerator<LocationRecord> {
		try {
			const conn = await this.ensureConn();
			const result = await conn.query(
				'SELECT id, name, address1, address2, city, state, postal_code, country, latitude, longitude, search_key, department, warning FROM Locations',
			);
			for (const row of result) {
				yield fromRow(row);
			}
		} catch (e) {
			this.logger.warn('ODBC iterLocations failed', e);
		}
	}
	async findCandidates(blockingKey: {
		city: string;
		state: string;
		postal_code?: string;
	}): Promise<LocationRecord[]> {
		try {
			const conn = await this.ensureConn();
			if (blockingKey.postal_code) {
				const result = await conn.query(
					`SELECT id, name, address1, address2, city, state, postal_code, country, latitude, longitude, search_key, department, warning
           FROM Locations WHERE postal_code LIKE ?`,
					[`${blockingKey.postal_code.slice(0, 5)}%`],
				);
				return result.map(fromRow);
			}
			const result = await conn.query(
				`SELECT id, name, address1, address2, city, state, postal_code, country, latitude, longitude, search_key, department, warning
         FROM Locations WHERE city = ? AND state = ?`,
				[blockingKey.city, blockingKey.state],
			);
			return result.map(fromRow);
		} catch (e) {
			this.logger.warn('ODBC findCandidates failed', e);
			return [];
		}
	}
	async healthCheck(): Promise<{ ok: boolean; details: string }> {
		try {
			await this.ensureConn();
			return { ok: true, details: 'ODBC connected' };
		} catch (e: any) {
			return { ok: false, details: `ODBC error: ${e?.message || String(e)}` };
		}
	}
}

class CSVBackend implements LocationsDAO {
	private filePath: string;
	private loaded: LocationRecord[] | null = null;
	constructor(filePath: string) {
		this.filePath = path.resolve(filePath);
	}
	private async ensureLoaded(): Promise<LocationRecord[]> {
		if (this.loaded) return this.loaded;
		const buf = await fs.readFile(this.filePath, 'utf8');
		const rows: any[] = parse(buf, { columns: true, skip_empty_lines: true });
		this.loaded = rows.map(fromRow);
		return this.loaded;
	}
	async *iterLocations(): AsyncGenerator<LocationRecord> {
		const rows = await this.ensureLoaded();
		for (const r of rows) {
			yield r;
		}
	}
	async findCandidates(blockingKey: {
		city: string;
		state: string;
		postal_code?: string;
	}): Promise<LocationRecord[]> {
		const rows = await this.ensureLoaded();
		if (blockingKey.postal_code) {
			const zip5 = blockingKey.postal_code.slice(0, 5).trim();
			const postalMatches = rows.filter((r) => {
				if (!r.postal_code || r.postal_code.trim() === '') return false;
				return r.postal_code.slice(0, 5).trim() === zip5;
			});
			// If postal code matching found results, return them
			if (postalMatches.length > 0) {
				return postalMatches;
			}
			// Fall back to city/state if postal code match found nothing
			// (handles cases where CSV has empty postal codes)
		}
		// Match by city and state
		return rows.filter(
			(r) => r.city.toLowerCase().trim() === blockingKey.city.toLowerCase().trim() &&
			        r.state.toUpperCase().trim() === blockingKey.state.toUpperCase().trim(),
		);
	}
	async healthCheck(): Promise<{ ok: boolean; details: string }> {
		try {
			await this.ensureLoaded();
			return { ok: true, details: 'CSV loaded' };
		} catch (e: any) {
			return { ok: false, details: `CSV error: ${e?.message || String(e)}` };
		}
	}
}

export function getDAO(driver?: MR8Driver): LocationsDAO {
	const cfg = loadConfig();
	const logger = getLogger();
	const drv = driver || cfg.mr8Driver;
	if (drv === 'sqlserver' && cfg.sqlserver) {
		logger.info('Using MSSQL backend');
		return new MSSQLBackend(cfg.sqlserver);
	}
	if (drv === 'odbc' && cfg.odbc) {
		logger.info('Using ODBC backend');
		return new ODBCBackend(cfg.odbc);
	}
	logger.info('Using CSV backend');
	return new CSVBackend(cfg.csv.path);
}

export { MSSQLBackend, ODBCBackend, CSVBackend };


