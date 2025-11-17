import { loadConfig } from '../config';
import { redactAddressSummary } from './redact';

type Level = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
	error: (msg: string, meta?: unknown) => void;
	warn: (msg: string, meta?: unknown) => void;
	info: (msg: string, meta?: unknown) => void;
	debug: (msg: string, meta?: unknown) => void;
}

function shouldLog(level: Level, current: Level): boolean {
	const order: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
	return order[level] <= order[current];
}

let singleton: Logger | null = null;

export function getLogger(): Logger {
	if (singleton) return singleton;
	const cfg = loadConfig();
	const currentLevel = cfg.logLevel;
	const log = (lvl: Level, msg: string, meta?: unknown) => {
		if (!shouldLog(lvl, currentLevel)) return;
		const safeMeta =
			meta && typeof meta === 'object'
				? JSON.parse(
						JSON.stringify(meta, (_k, v) => {
							if (typeof v === 'string') return v;
							return v;
						}),
				  )
				: meta;
		// eslint-disable-next-line no-console
		console[lvl](`[${lvl.toUpperCase()}] ${msg}`, safeMeta ?? '');
	};
	singleton = {
		error: (msg, meta) => log('error', msg, meta),
		warn: (msg, meta) => log('warn', msg, meta),
		info: (msg, meta) => log('info', msg, meta),
		debug: (msg, meta) => log('debug', msg, meta),
	};
	return singleton;
}

export function redactForLog(address1: string, postal_code: string): string {
	return redactAddressSummary(address1, postal_code);
}


