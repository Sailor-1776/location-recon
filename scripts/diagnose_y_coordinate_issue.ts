#!/usr/bin/env tsx
/**
 * Diagnostic script to identify why y-coordinates are not being captured
 * This script provides detailed error information and debugging output
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

async function diagnoseYCoordinateIssue() {
	console.log('Diagnosing Y-Coordinate Capture Issue\n');
	console.log('='.repeat(70));
	
	const testInputPath = path.join(projectRoot, 'data', 'Test_Data_Input.pdf');
	
	// Check if file exists
	try {
		await fs.access(testInputPath);
		console.log(`✓ Found test PDF: ${testInputPath}\n`);
	} catch (e) {
		console.error(`✗ Test PDF not found: ${testInputPath}`);
		process.exit(1);
	}
	
	// Step 1: Check if pdfjs-dist is installed
	console.log('Step 1: Checking pdfjs-dist installation...');
	try {
		const require = createRequire(import.meta.url);
		// Try different possible paths
		let pdfjsDist: string | null = null;
		const pathsToTry = [
			'pdfjs-dist/legacy/build/pdf.mjs',
			'pdfjs-dist/legacy/build/pdf',
			'pdfjs-dist/build/pdf.mjs',
			'pdfjs-dist/build/pdf',
		];
		
		for (const pathToTry of pathsToTry) {
			try {
				pdfjsDist = require.resolve(pathToTry);
				console.log(`✓ pdfjs-dist found at: ${pdfjsDist} (using path: ${pathToTry})\n`);
				break;
			} catch {
				// Try next path
			}
		}
		
		if (!pdfjsDist) {
			throw new Error('Could not resolve pdfjs-dist using any known path');
		}
	} catch (e) {
		console.error('✗ pdfjs-dist not found or cannot be resolved');
		console.error(`  Error: ${e instanceof Error ? e.message : String(e)}\n`);
		process.exit(1);
	}
	
	// Step 2: Try to load pdfjs-dist
	console.log('Step 2: Attempting to load pdfjs-dist...');
	let pdfjsLib: any = null;
	const pathsToTry = [
		'pdfjs-dist/legacy/build/pdf.mjs',
		'pdfjs-dist/legacy/build/pdf',
		'pdfjs-dist/build/pdf.mjs',
	];
	
	for (const pathToTry of pathsToTry) {
		try {
			// Try dynamic import first (for .mjs files)
			if (pathToTry.endsWith('.mjs')) {
				const dynamicImport = new Function('m', 'return import(m)');
				pdfjsLib = await dynamicImport(pathToTry);
			} else {
				const require = createRequire(import.meta.url);
				pdfjsLib = require(pathToTry);
			}
			
			if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
				// Don't set workerSrc for Node.js environments - it's not needed
				// pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
			}
			console.log(`✓ pdfjs-dist loaded successfully (using path: ${pathToTry})`);
			console.log(`  Version: ${pdfjsLib?.version || 'unknown'}\n`);
			break;
		} catch (e) {
			if (pathToTry === pathsToTry[pathsToTry.length - 1]) {
				console.error('✗ Failed to load pdfjs-dist from all attempted paths');
				console.error(`  Last error: ${e instanceof Error ? e.message : String(e)}`);
				if (e instanceof Error && e.stack) {
					console.error(`  Stack: ${e.stack}\n`);
				}
				process.exit(1);
			}
			// Try next path
		}
	}
	
	// Step 3: Try to load the PDF document
	console.log('Step 3: Loading PDF document...');
	let pdf: any = null;
	try {
		const buf = await fs.readFile(testInputPath);
		const loadingTask = pdfjsLib.getDocument({ 
			data: new Uint8Array(buf), 
			useSystemFonts: true, 
			disableWorker: true 
		});
		pdf = await loadingTask.promise;
		console.log(`✓ PDF loaded successfully`);
		console.log(`  Pages: ${pdf.numPages}\n`);
	} catch (e) {
		console.error('✗ Failed to load PDF document');
		console.error(`  Error: ${e instanceof Error ? e.message : String(e)}`);
		if (e instanceof Error && e.stack) {
			console.error(`  Stack: ${e.stack}\n`);
		}
		process.exit(1);
	}
	
	// Step 4: Try to extract text content from first page
	console.log('Step 4: Extracting text content from first page...');
	try {
		const page = await pdf.getPage(1);
		const viewport = page.getViewport({ scale: 1.0 });
		console.log(`✓ Page 1 loaded`);
		console.log(`  Viewport: ${viewport.width.toFixed(2)} x ${viewport.height.toFixed(2)}\n`);
		
		console.log('  Attempting to get text content...');
		const content = await page.getTextContent();
		console.log(`✓ Text content extracted`);
		console.log(`  Items: ${content.items?.length || 0}\n`);
		
		// Analyze the items
		if (content.items && content.items.length > 0) {
			console.log('  Analyzing first 5 text items:');
			for (let i = 0; i < Math.min(5, content.items.length); i++) {
				const item = content.items[i];
				console.log(`    Item ${i + 1}:`);
				console.log(`      Text: "${item.str || ''}"`);
				console.log(`      Transform: ${JSON.stringify(item.transform)}`);
				console.log(`      Text Matrix: ${JSON.stringify(item.textMatrix)}`);
				console.log(`      Width: ${item.width || 'N/A'}`);
			}
			console.log('');
		} else {
			console.warn('  ⚠ No text items found in content!\n');
		}
		
		// Try to group items into lines
		console.log('  Attempting to group items into lines...');
		const items = (content.items ?? []) as any[];
		const processed = items
			.filter((item) => typeof item?.str === 'string' && item.str.trim().length > 0)
			.map((item) => {
				const transform = Array.isArray(item.transform)
					? item.transform
					: Array.isArray(item.textMatrix)
						? item.textMatrix
						: undefined;
				const x = typeof transform?.[4] === 'number' && Number.isFinite(transform[4]) ? transform[4] : 0;
				const y = typeof transform?.[5] === 'number' && Number.isFinite(transform[5]) ? transform[5] : 0;
				const width = typeof item.width === 'number' && item.width > 0 ? item.width : item.str.trim().length * 4;
				return {
					text: item.str.replace(/\s+/g, ' '),
					x,
					y,
					width,
				};
			})
			.sort((a, b) => {
				const deltaY = b.y - a.y;
				if (Math.abs(deltaY) > 2) {
					return deltaY;
				}
				return a.x - b.x;
			});
		
		console.log(`✓ Processed ${processed.length} text items`);
		if (processed.length > 0) {
			console.log('  Sample processed items (first 5):');
			for (let i = 0; i < Math.min(5, processed.length); i++) {
				const item = processed[i];
				console.log(`    "${item.text.substring(0, 40)}" at (${item.x.toFixed(2)}, ${item.y.toFixed(2)})`);
			}
			console.log('');
		} else {
			console.warn('  ⚠ No processed items after filtering!\n');
		}
		
	} catch (e) {
		console.error('✗ Failed to extract text content');
		console.error(`  Error: ${e instanceof Error ? e.message : String(e)}`);
		if (e instanceof Error && e.stack) {
			console.error(`  Stack: ${e.stack}\n`);
		}
		
		// Check if it's the "TT: undefined function" error
		if (e instanceof Error && e.message.includes('TT:')) {
			console.log('\n⚠ DIAGNOSIS: This appears to be a font-related error.');
			console.log('  The PDF may contain fonts that pdfjs-dist cannot parse.');
			console.log('  This is a known issue with some PDFs.\n');
		}
	}
	
	// Step 5: Test the actual extraction function
	console.log('Step 5: Testing extractText function...');
	try {
		const { extractText } = await import('../src/ingest/pdfReader');
		const tmpPath = path.join(projectRoot, 'data', 'test_temp_diagnose.pdf');
		await fs.writeFile(tmpPath, await fs.readFile(testInputPath));
		
		const textExtraction = await extractText(tmpPath);
		await fs.unlink(tmpPath).catch(() => {});
		
		console.log(`✓ extractText completed`);
		console.log(`  Text length: ${textExtraction.text.length}`);
		console.log(`  Pages with positional data: ${textExtraction.pages?.length || 0}`);
		
		if (textExtraction.pages && textExtraction.pages.length > 0) {
			const totalLines = textExtraction.pages.reduce((sum, p) => sum + (p.lines?.length || 0), 0);
			console.log(`  Total lines with coordinates: ${totalLines}`);
			
			if (totalLines > 0) {
				console.log('\n  Sample lines from first page:');
				const firstPage = textExtraction.pages[0];
				if (firstPage && firstPage.lines) {
					for (let i = 0; i < Math.min(5, firstPage.lines.length); i++) {
						const line = firstPage.lines[i];
						console.log(`    "${line.text.substring(0, 40)}" at y=${line.y.toFixed(2)}`);
					}
				}
			}
		} else {
			console.warn('  ⚠ No positional data extracted!');
		}
		console.log('');
		
	} catch (e) {
		console.error('✗ extractText failed');
		console.error(`  Error: ${e instanceof Error ? e.message : String(e)}`);
		if (e instanceof Error && e.stack) {
			console.error(`  Stack: ${e.stack}\n`);
		}
	}
	
	console.log('='.repeat(70));
	console.log('Diagnosis complete!\n');
}

diagnoseYCoordinateIssue().catch(console.error);

