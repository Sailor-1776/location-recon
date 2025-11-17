import { Command } from 'commander';
import { getDAO } from '../match/locationsDAO';
import { loadConfig } from '../config';
import { getLogger } from '../utils/logger';
import type { LocationRecord } from '../types';
import { pathToFileURL } from 'url';
import path from 'path';

type ViewType = 'table' | 'map' | 'stats' | 'json';

export interface VisualizeOptions {
	view: ViewType;
	limit?: number;
	state?: string;
	city?: string;
}

async function showTableView(locations: LocationRecord[], limit?: number): Promise<void> {
	const data = limit ? locations.slice(0, limit) : locations;

	console.log('\n📍 LOCATIONS DATABASE - TABLE VIEW');
	console.log('=' .repeat(100));
	console.log(
		'ID'.padEnd(5),
		'NAME'.padEnd(25),
		'ADDRESS'.padEnd(30),
		'CITY'.padEnd(15),
		'STATE'.padEnd(5),
		'ZIP'.padEnd(8),
		'LAT/LNG'
	);
	console.log('-'.repeat(100));

	for (const loc of data) {
		const name = (loc.name || 'Unknown').substring(0, 24);
		const address = `${loc.address1}${loc.address2 ? ', ' + loc.address2 : ''}`.substring(0, 29);
		const coords = loc.latitude && loc.longitude ? `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}` : 'N/A';

		console.log(
			String(loc.id || '').padEnd(5),
			name.padEnd(25),
			address.padEnd(30),
			loc.city.substring(0, 14).padEnd(15),
			loc.state.padEnd(5),
			loc.postal_code.padEnd(8),
			coords
		);
	}

	console.log('-'.repeat(100));
	console.log(`Total: ${locations.length} locations${limit && locations.length > limit ? ` (showing first ${limit})` : ''}`);
}

async function showMapView(locations: LocationRecord[]): Promise<void> {
	const validCoords = locations.filter(loc => loc.latitude && loc.longitude);

	console.log('\n🗺️  LOCATIONS DATABASE - MAP VIEW');
	console.log('=' .repeat(80));

	if (validCoords.length === 0) {
		console.log('No locations with valid coordinates found.');
		return;
	}

	// Group by state for clustering info
	const byState = validCoords.reduce((acc, loc) => {
		acc[loc.state] = (acc[loc.state] || 0) + 1;
		return acc;
	}, {} as Record<string, number>);

	console.log('Geographic Distribution:');
	Object.entries(byState)
		.sort(([,a], [,b]) => b - a)
		.forEach(([state, count]) => {
			console.log(`  ${state}: ${count} locations`);
		});

	console.log('\nSample Coordinates (first 10):');
	validCoords.slice(0, 10).forEach(loc => {
		console.log(`  ${loc.name || 'Unknown'}: ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)} (${loc.city}, ${loc.state})`);
	});

	console.log(`\nTotal locations with coordinates: ${validCoords.length}/${locations.length}`);
}

async function showStatsView(locations: LocationRecord[]): Promise<void> {
	console.log('\n📊 LOCATIONS DATABASE - STATISTICS');
	console.log('=' .repeat(60));

	const total = locations.length;
	const withCoords = locations.filter(loc => loc.latitude && loc.longitude).length;
	const withNames = locations.filter(loc => loc.name && loc.name.trim()).length;

	console.log(`Total Locations: ${total}`);
	console.log(`With Names: ${withNames} (${((withNames/total)*100).toFixed(1)}%)`);
	console.log(`With Coordinates: ${withCoords} (${((withCoords/total)*100).toFixed(1)}%)`);

	// States breakdown
	const byState = locations.reduce((acc, loc) => {
		acc[loc.state] = (acc[loc.state] || 0) + 1;
		return acc;
	}, {} as Record<string, number>);

	console.log('\nBy State:');
	Object.entries(byState)
		.sort(([,a], [,b]) => b - a)
		.forEach(([state, count]) => {
			console.log(`  ${state}: ${count}`);
		});

	// Cities breakdown (top 10)
	const byCity = locations.reduce((acc, loc) => {
		const key = `${loc.city}, ${loc.state}`;
		acc[key] = (acc[key] || 0) + 1;
		return acc;
	}, {} as Record<string, number>);

	console.log('\nTop Cities:');
	Object.entries(byCity)
		.sort(([,a], [,b]) => b - a)
		.slice(0, 10)
		.forEach(([city, count]) => {
			console.log(`  ${city}: ${count}`);
		});
}

async function showJsonView(locations: LocationRecord[], limit?: number): Promise<void> {
	const data = limit ? locations.slice(0, limit) : locations;
	console.log(JSON.stringify(data, null, 2));
}

export async function runVisualizeCli(argv: string[]): Promise<number> {
	const program = new Command();
	program
		.name('visualize')
		.description('Visualize the locations database')
		.option('--view <type>', 'view type: table, map, stats, json', 'table')
		.option('--limit <n>', 'limit number of results', (v) => Number(v))
		.option('--state <state>', 'filter by state (2-letter code)')
		.option('--city <city>', 'filter by city');

	program.parse(argv, { from: 'user' });
	const opts = program.opts<VisualizeOptions>();

	const config = loadConfig();
	const logger = getLogger();
	const dao = getDAO(config.mr8Driver);

	try {
		// Load all locations
		const allLocations: LocationRecord[] = [];
		for await (const loc of dao.iterLocations()) {
			allLocations.push(loc);
		}

		// Apply filters
		let filteredLocations = allLocations;
		if (opts.state) {
			filteredLocations = filteredLocations.filter(loc =>
				loc.state.toLowerCase() === opts.state!.toLowerCase()
			);
		}
		if (opts.city) {
			filteredLocations = filteredLocations.filter(loc =>
				loc.city.toLowerCase() === opts.city!.toLowerCase()
			);
		}

		// Show selected view
		switch (opts.view) {
			case 'table':
				await showTableView(filteredLocations, opts.limit);
				break;
			case 'map':
				await showMapView(filteredLocations);
				break;
			case 'stats':
				await showStatsView(filteredLocations);
				break;
			case 'json':
				await showJsonView(filteredLocations, opts.limit);
				break;
			default:
				console.error(`Unknown view type: ${opts.view}`);
				return 1;
		}

		return 0;
	} catch (error: unknown) {
		logger.error('Visualization failed', error);
		console.error('Error:', error);
		return 1;
	}
}

const __filename = path.resolve(process.argv[1]);
const isMain = import.meta.url === pathToFileURL(__filename).href;

if (isMain) {
	runVisualizeCli(process.argv).then(
		(code) => {
			process.exitCode = code;
		},
		(err) => {
			console.error(err);
			process.exitCode = 1;
		},
	);
}
