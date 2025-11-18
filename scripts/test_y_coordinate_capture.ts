#!/usr/bin/env tsx
/**
 * Test script to verify that y-coordinates are being captured during block identification
 * This script extracts blocks from a PDF and checks whether each block has a valid y-coordinate
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

// Import the extraction functions
import { extractText } from '../src/ingest/pdfReader';
import { extractStructuredFacilities, extractCandidateBlocks, type BlockWithPosition } from '../src/ingest/textUtils';

interface TestResult {
	blockIndex: number;
	block: string;
	facilityNameLine: string;
	hasYCoordinate: boolean;
	yCoordinate: number;
	pageIndex: number;
	hasXCoordinate: boolean;
	xCoordinate?: number;
	maxX?: number;
}

async function testYCoordinateCapture() {
	console.log('Testing Y-Coordinate Capture During Block Identification\n');
	console.log('=' .repeat(70));
	
	const testInputPath = path.join(projectRoot, 'data', 'Test_Data_Input.pdf');
	
	// Check if file exists
	try {
		await fs.access(testInputPath);
		console.log(`✓ Found test PDF: ${testInputPath}\n`);
	} catch (e) {
		console.error(`✗ Test PDF not found: ${testInputPath}`);
		console.error('Please ensure Test_Data_Input.pdf exists in the data directory.');
		process.exit(1);
	}
	
	try {
		// Step 1: Extract text with positional data
		console.log('Step 1: Extracting text with positional data from PDF...');
		const tmpPath = path.join(projectRoot, 'data', 'test_temp_y_coord.pdf');
		await fs.writeFile(tmpPath, await fs.readFile(testInputPath));
		
		const textExtraction = await extractText(tmpPath);
		const extractedText = textExtraction.text;
		const pages = textExtraction.pages;
		
		await fs.unlink(tmpPath).catch(() => {});
		
		console.log(`✓ Extracted ${extractedText.length} characters of text`);
		console.log(`✓ Positional data: ${pages ? `${pages.length} pages with ${pages.reduce((sum, p) => sum + (p.lines?.length || 0), 0)} total lines` : 'No positional data available'}\n`);
		
		if (!pages || pages.length === 0) {
			console.warn('⚠ WARNING: No positional data extracted from PDF!');
			console.warn('  Y-coordinates cannot be captured without positional data.\n');
			console.log('This could happen if:');
			console.log('  1. pdfjs-dist is not installed or failed to load');
			console.log('  2. The PDF format is not supported');
			console.log('  3. There was an error during PDF parsing\n');
		}
		
		// Step 2: Extract structured facilities (primary method)
		console.log('Step 2: Extracting structured facilities...');
		const structuredBlocks = extractStructuredFacilities(extractedText, pages);
		console.log(`✓ Found ${structuredBlocks.length} blocks using extractStructuredFacilities\n`);
		
		// Step 3: Extract candidate blocks (alternative method)
		console.log('Step 3: Extracting candidate blocks (alternative method)...');
		const candidateBlocks = extractCandidateBlocks(extractedText, pages);
		console.log(`✓ Found ${candidateBlocks.length} blocks using extractCandidateBlocks\n`);
		
		// Step 4: Analyze blocks for y-coordinate capture
		console.log('Step 4: Analyzing blocks for y-coordinate capture...\n');
		console.log('=' .repeat(70));
		
		// Test structured blocks
		console.log('\n📊 RESULTS: extractStructuredFacilities');
		console.log('-'.repeat(70));
		
		const structuredResults: TestResult[] = structuredBlocks.map((block, idx) => ({
			blockIndex: idx + 1,
			block: block.block,
			facilityNameLine: block.facilityNameLine,
			hasYCoordinate: typeof block.y === 'number' && block.y > 0,
			yCoordinate: block.y,
			pageIndex: block.pageIndex,
			hasXCoordinate: typeof block.x === 'number',
			xCoordinate: block.x,
			maxX: block.maxX,
		}));
		
		const structuredWithY = structuredResults.filter(r => r.hasYCoordinate);
		const structuredWithoutY = structuredResults.filter(r => !r.hasYCoordinate);
		
		console.log(`Total blocks: ${structuredResults.length}`);
		console.log(`✓ Blocks with y-coordinate: ${structuredWithY.length} (${((structuredWithY.length / structuredResults.length) * 100).toFixed(1)}%)`);
		console.log(`✗ Blocks without y-coordinate: ${structuredWithoutY.length} (${((structuredWithoutY.length / structuredResults.length) * 100).toFixed(1)}%)\n`);
		
		// Show detailed results for first 10 blocks
		console.log('Detailed results (first 10 blocks):');
		console.log('-'.repeat(70));
		structuredResults.slice(0, 10).forEach(result => {
			console.log(`\nBlock ${result.blockIndex}:`);
			console.log(`  Facility Name: "${result.facilityNameLine.substring(0, 60)}${result.facilityNameLine.length > 60 ? '...' : ''}"`);
			console.log(`  Y-Coordinate: ${result.hasYCoordinate ? `✓ ${result.yCoordinate.toFixed(2)}` : '✗ NOT CAPTURED (0)'}`);
			console.log(`  Page Index: ${result.pageIndex}`);
			console.log(`  X-Coordinate: ${result.hasXCoordinate ? `✓ ${result.xCoordinate?.toFixed(2)}` : '✗ NOT CAPTURED'}`);
			console.log(`  Max X: ${result.maxX ? `✓ ${result.maxX.toFixed(2)}` : '✗ NOT CAPTURED'}`);
			console.log(`  Block Preview: "${result.block.substring(0, 100)}${result.block.length > 100 ? '...' : ''}"`);
		});
		
		if (structuredResults.length > 10) {
			console.log(`\n... and ${structuredResults.length - 10} more blocks`);
		}
		
		// Test candidate blocks
		console.log('\n\n📊 RESULTS: extractCandidateBlocks');
		console.log('-'.repeat(70));
		
		const candidateResults: TestResult[] = candidateBlocks.map((block, idx) => ({
			blockIndex: idx + 1,
			block: block.block,
			facilityNameLine: block.facilityNameLine,
			hasYCoordinate: typeof block.y === 'number' && block.y > 0,
			yCoordinate: block.y,
			pageIndex: block.pageIndex,
			hasXCoordinate: typeof block.x === 'number',
			xCoordinate: block.x,
			maxX: block.maxX,
		}));
		
		const candidateWithY = candidateResults.filter(r => r.hasYCoordinate);
		const candidateWithoutY = candidateResults.filter(r => !r.hasYCoordinate);
		
		console.log(`Total blocks: ${candidateResults.length}`);
		console.log(`✓ Blocks with y-coordinate: ${candidateWithY.length} (${candidateResults.length > 0 ? ((candidateWithY.length / candidateResults.length) * 100).toFixed(1) : '0'}%)`);
		console.log(`✗ Blocks without y-coordinate: ${candidateWithoutY.length} (${candidateResults.length > 0 ? ((candidateWithoutY.length / candidateResults.length) * 100).toFixed(1) : '0'}%)\n`);
		
		// Show detailed results for first 10 candidate blocks
		if (candidateResults.length > 0) {
			console.log('Detailed results (first 10 blocks):');
			console.log('-'.repeat(70));
			candidateResults.slice(0, 10).forEach(result => {
				console.log(`\nBlock ${result.blockIndex}:`);
				console.log(`  Facility Name: "${result.facilityNameLine.substring(0, 60)}${result.facilityNameLine.length > 60 ? '...' : ''}"`);
				console.log(`  Y-Coordinate: ${result.hasYCoordinate ? `✓ ${result.yCoordinate.toFixed(2)}` : '✗ NOT CAPTURED (0)'}`);
				console.log(`  Page Index: ${result.pageIndex}`);
				console.log(`  X-Coordinate: ${result.hasXCoordinate ? `✓ ${result.xCoordinate?.toFixed(2)}` : '✗ NOT CAPTURED'}`);
				console.log(`  Max X: ${result.maxX ? `✓ ${result.maxX.toFixed(2)}` : '✗ NOT CAPTURED'}`);
				console.log(`  Block Preview: "${result.block.substring(0, 100)}${result.block.length > 100 ? '...' : ''}"`);
			});
			
			if (candidateResults.length > 10) {
				console.log(`\n... and ${candidateResults.length - 10} more blocks`);
			}
		}
		
		// Summary and recommendations
		console.log('\n\n📋 SUMMARY');
		console.log('='.repeat(70));
		
		const totalBlocks = structuredResults.length + candidateResults.length;
		const totalWithY = structuredWithY.length + candidateWithY.length;
		const totalWithoutY = structuredWithoutY.length + candidateWithoutY.length;
		
		console.log(`Total blocks identified: ${totalBlocks}`);
		console.log(`Blocks with y-coordinate: ${totalWithY} (${totalBlocks > 0 ? ((totalWithY / totalBlocks) * 100).toFixed(1) : '0'}%)`);
		console.log(`Blocks without y-coordinate: ${totalWithoutY} (${totalBlocks > 0 ? ((totalWithoutY / totalBlocks) * 100).toFixed(1) : '0'}%)\n`);
		
		if (totalWithY > 0) {
			console.log('✓ SUCCESS: Y-coordinates ARE being captured during block identification!');
			console.log(`  ${totalWithY} out of ${totalBlocks} blocks have valid y-coordinates.\n`);
		} else {
			console.log('✗ ISSUE: Y-coordinates are NOT being captured during block identification.');
			console.log('  All blocks have y-coordinate = 0, which means positional matching failed.\n');
		}
		
		if (totalWithoutY > 0) {
			console.log('⚠ WARNING: Some blocks do not have y-coordinates.');
			console.log('  This could happen if:');
			console.log('    1. The facility name line could not be matched in the PDF positional data');
			console.log('    2. The similarity threshold was too high');
			console.log('    3. The text format in the PDF differs from the extracted text\n');
		}
		
		// Show sample blocks without y-coordinates for debugging
		if (structuredWithoutY.length > 0) {
			console.log('Sample blocks WITHOUT y-coordinates (for debugging):');
			console.log('-'.repeat(70));
			structuredWithoutY.slice(0, 5).forEach(result => {
				console.log(`\nBlock ${result.blockIndex}:`);
				console.log(`  Facility Name: "${result.facilityNameLine}"`);
				console.log(`  Block: "${result.block.substring(0, 200)}${result.block.length > 200 ? '...' : ''}"`);
			});
			console.log('');
		}
		
		console.log('='.repeat(70));
		console.log('✓ Test completed!\n');
		
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('\n✗ Test failed:', message);
		if (error instanceof Error && error.stack) {
			console.error(error.stack);
		}
		process.exit(1);
	}
}

testYCoordinateCapture().catch(console.error);

