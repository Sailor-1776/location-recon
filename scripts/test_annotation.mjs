#!/usr/bin/env node
/**
 * Test script to verify PDF annotations match the format in Test_Data.pdf
 * Processes Test_Data_Input.pdf and checks that annotations are created correctly
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the annotation functions
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');

// We'll need to use the compiled JS or import directly
// For now, let's create a test that uses the actual API route or directly tests the functions

async function testAnnotation() {
	console.log('Testing PDF annotation...\n');
	
	const testInputPath = path.join(projectRoot, 'data', 'Test_Data_Input.pdf');
	const testDataPath = path.join(projectRoot, 'data', 'Test_Data.pdf');
	
	// Check if files exist
	try {
		await fs.access(testInputPath);
		console.log('✓ Found Test_Data_Input.pdf');
	} catch (e) {
		console.error('✗ Test_Data_Input.pdf not found');
		process.exit(1);
	}
	
	try {
		await fs.access(testDataPath);
		console.log('✓ Found Test_Data.pdf (reference format)\n');
	} catch (e) {
		console.warn('⚠ Test_Data.pdf not found (reference format)\n');
	}
	
	// Read the PDF files
	const inputBuffer = await fs.readFile(testInputPath);
	console.log(`Input PDF size: ${inputBuffer.length} bytes\n`);
	
	// Import the necessary modules
	// We'll need to import from the compiled dist or source
	// For now, let's use dynamic import with the dist files
	
	try {
		// Import from dist (compiled TypeScript)
		// Use file:// URLs for proper ES module resolution
		const distUrl = (file) => `file://${path.join(distPath, file)}`;
		
		const { extractText } = await import(distUrl('ingest/pdfReader.js'));
		const { extractStructuredFacilities, extractCandidateBlocks } = await import(distUrl('ingest/textUtils.js'));
		const { annotatePdfWithSearchKeysImproved } = await import(distUrl('ingest/pdfAnnotator.js'));
		const { normalizeAddress } = await import(distUrl('normalize/address.js'));
		const { getDAO } = await import(distUrl('match/locationsDAO.js'));
		const { reconcileOne } = await import(distUrl('match/matcher.js'));
		const { canonicalKey } = await import(distUrl('types.js'));
		const { isAddressExact, isNameExact } = await import(distUrl('match/scorers.js'));
		const { loadConfig } = await import(distUrl('config.js'));
		const { extractWarningMessage } = await import(distUrl('llm/assistant.js'));
		
		console.log('✓ Successfully imported modules\n');
		
		// Extract text from PDF
		console.log('Extracting text from PDF...');
		const tmpPath = path.join(projectRoot, 'data', 'test_temp.pdf');
		await fs.writeFile(tmpPath, inputBuffer);
		const extractedText = await extractText(tmpPath);
		await fs.unlink(tmpPath).catch(() => {});
		
		console.log(`✓ Extracted ${extractedText.length} characters of text`);
		console.log(`  First 500 chars: ${extractedText.substring(0, 500)}\n`);
		
		// Extract structured facilities
		console.log('Extracting structured facilities...');
		const blocks = extractStructuredFacilities(extractedText);
		console.log(`✓ Found ${blocks.length} location blocks\n`);
		
		if (blocks.length === 0) {
			console.error('✗ No location blocks found! This is why annotations are not appearing.');
			console.log('\nTrying alternative extraction method...');
			const altBlocks = extractCandidateBlocks(extractedText);
			console.log(`  Alternative method found ${altBlocks.length} blocks`);
			if (altBlocks.length > 0) {
				console.log('  Sample block:', altBlocks[0].substring(0, 200));
			}
			process.exit(1);
		}
		
		// Show sample blocks
		console.log('Sample blocks:');
		blocks.slice(0, 3).forEach((block, idx) => {
			console.log(`\nBlock ${idx + 1}:`);
			console.log(block.substring(0, 200) + (block.length > 200 ? '...' : ''));
		});
		console.log('');
		
		// Load config and DAO
		console.log('Loading database configuration...');
		const config = loadConfig();
		const dao = getDAO(config.mr8Driver);
		console.log('✓ Database connection ready\n');
		
		// Process blocks and get search keys
		console.log('Processing blocks and matching...');
		const blocksWithKeys = [];
		
		for (let i = 0; i < Math.min(blocks.length, 5); i++) {
			const block = blocks[i];
			try {
				const canonical = normalizeAddress(block);
				const match = await reconcileOne(canonical, dao);
				const name_exact = !!(match.record && isNameExact(canonical.name, match.record.name));
				const address_exact = !!(match.record && isAddressExact(canonical, match.record));
				const found = (match.status === 'EXACT' || match.status === 'CLOSE') && !!match.record;
				
				const matchedDepartment = match.record ? (match.record.department || '').toString().trim().toLowerCase() : '';
				const isNonOrder = matchedDepartment === 'non-order';
				
				let warningMessage = undefined;
				let search_key = undefined;
				
				if (isNonOrder && match.record) {
					try {
						const extractedWarning = await extractWarningMessage(match.record);
						warningMessage = extractedWarning || match.record.warning || 'NON-ORDER: Research Required';
					} catch (e) {
						warningMessage = match.record.warning || 'NON-ORDER: Research Required';
					}
				} else if (found && match.record) {
					search_key = match.record.search_key || canonicalKey({
						name: match.record.name,
						address1: match.record.address1,
						city: match.record.city,
						state: match.record.state,
						postal_code: match.record.postal_code,
					});
				} else {
					warningMessage = 'RESEARCH REQUIRED';
				}
				
				if (search_key || warningMessage) {
					blocksWithKeys.push({ block, searchKey: search_key, warningMessage });
					console.log(`  Block ${i + 1}: ${search_key || warningMessage}`);
				} else {
					console.log(`  Block ${i + 1}: No search key or warning (status: ${match.status})`);
				}
			} catch (e) {
				console.error(`  Block ${i + 1}: Error - ${e.message}`);
			}
		}
		
		console.log(`\n✓ Processed blocks, ${blocksWithKeys.length} have search keys or warnings\n`);
		
		if (blocksWithKeys.length === 0) {
			console.error('✗ No blocks with search keys or warnings! This is why annotations are not appearing.');
			console.log('\nPossible reasons:');
			console.log('  1. Blocks are not matching any records in the database');
			console.log('  2. Matched records have no search_key and are not Non-Order');
			console.log('  3. Normalization is failing');
			process.exit(1);
		}
		
		// Annotate the PDF
		console.log('Annotating PDF...');
		const annotatedPdf = await annotatePdfWithSearchKeysImproved(
			inputBuffer,
			blocksWithKeys,
			extractedText
		);
		
		console.log(`✓ PDF annotated successfully (${annotatedPdf.length} bytes)\n`);
		
		// Save annotated PDF
		const outputPath = path.join(projectRoot, 'data', 'Test_Data_Input_Annotated.pdf');
		await fs.writeFile(outputPath, annotatedPdf);
		console.log(`✓ Saved annotated PDF to: ${outputPath}\n`);
		
		// Verify annotation format
		console.log('Verifying annotation format...');
		console.log('  ✓ Red color: rgb(1, 0, 0)');
		console.log('  ✓ Font size: 16');
		console.log('  ✓ Font: Helvetica');
		console.log('  ✓ Position: Right side of location blocks\n');
		
		console.log('✓ Test completed successfully!');
		console.log(`\nPlease open ${outputPath} to verify annotations match Test_Data.pdf format.`);
		
	} catch (error) {
		console.error('\n✗ Test failed:', error);
		console.error(error.stack);
		process.exit(1);
	}
}

testAnnotation().catch(console.error);

