import { extractText } from '../src/ingest/pdfReader';
import { extractStructuredFacilities, extractCandidateBlocks, filterMedicalBlocks } from '../src/ingest/textUtils';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzePdf() {
	const pdfPath = path.join(__dirname, '../data/MEDICAL PROVIDERS-JAEGER.pdf');
	
	console.log('Extracting text from PDF...\n');
	const extraction = await extractText(pdfPath);
	
	console.log('=== EXTRACTED TEXT ===');
	console.log(extraction.text.substring(0, 2000));
	console.log('\n...\n');
	console.log('Total text length:', extraction.text.length);
	console.log('Has positional data:', !!extraction.pages);
	console.log('Number of pages:', extraction.pages?.length || 0);
	
	if (extraction.pages) {
		console.log('\n=== PAGE LINE COUNTS ===');
		extraction.pages.forEach((page, idx) => {
			console.log(`Page ${idx + 1}: ${page.lines.length} lines`);
		});
	}
	
	// Show all lines to understand structure
	const lines = extraction.text.split(/\r?\n/).filter(l => l.trim().length > 0);
	
	console.log('\n=== CHECKING FOR NUMBERED LIST ITEMS ===');
	const numberedLines = lines.filter((line, idx) => {
		const matches = /^\d+[.,]\s*[A-Z]/.test(line.trim());
		if (matches) {
			console.log(`Line ${idx + 1}: ${line}`);
		}
		return matches;
	});
	console.log(`Found ${numberedLines.length} numbered list items\n`);
	
	console.log('\n=== TESTING STRUCTURED EXTRACTION ===');
	const structuredBlocks = extractStructuredFacilities(extraction.text, extraction.pages);
	console.log(`Found ${structuredBlocks.length} structured blocks`);
	structuredBlocks.forEach((block, idx) => {
		console.log(`\nBlock ${idx + 1}:`);
		console.log(`  Text: ${block.block.substring(0, 150)}...`);
		console.log(`  Facility Name: ${block.facilityNameLine}`);
		console.log(`  Page: ${block.pageIndex}, Y: ${block.y}`);
	});
	
	console.log('\n=== TESTING CANDIDATE EXTRACTION ===');
	const candidateBlocks = extractCandidateBlocks(extraction.text, extraction.pages);
	console.log(`Found ${candidateBlocks.length} candidate blocks`);
	candidateBlocks.forEach((block, idx) => {
		console.log(`\nBlock ${idx + 1}:`);
		console.log(`  Text: ${block.block.substring(0, 150)}...`);
		console.log(`  Facility Name: ${block.facilityNameLine}`);
		console.log(`  Page: ${block.pageIndex}, Y: ${block.y}`);
	});
	
	console.log('\n=== AFTER MEDICAL FILTER ===');
	const filteredStructured = filterMedicalBlocks(structuredBlocks);
	const filteredCandidate = filterMedicalBlocks(candidateBlocks);
	console.log(`Structured blocks after filter: ${filteredStructured.length}`);
	console.log(`Candidate blocks after filter: ${filteredCandidate.length}`);
	
	// Show all lines to understand structure
	console.log('\n=== FIRST 100 LINES OF TEXT ===');
	lines.slice(0, 100).forEach((line, idx) => {
		console.log(`${idx + 1}: ${line}`);
	});
}

analyzePdf().catch(console.error);

