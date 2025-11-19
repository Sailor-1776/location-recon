import { extractText } from '../src/ingest/pdfReader';
import { extractStructuredFacilities } from '../src/ingest/textUtils';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = path.join(__dirname, '../data/MEDICAL PROVIDERS-JAEGER.pdf');

const extraction = await extractText(pdfPath);
const lines = extraction.text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

console.log('Lines around Lighthouse:');
lines.forEach((line, idx) => {
  if (idx >= 37 && idx <= 42) {
    console.log(`${idx + 1}: "${line}"`);
  }
});

// Monkey-patch to add debug logging
const originalExtract = extractStructuredFacilities;
const blocks = originalExtract(extraction.text, extraction.pages);
console.log(`\nTotal blocks: ${blocks.length}`);

// Check all blocks for P.O. Box
const poBoxBlocks = blocks.filter(b => b.block.includes('P.O. Box') || b.block.includes('Box'));
console.log(`\nP.O. Box blocks: ${poBoxBlocks.length}`);
poBoxBlocks.forEach((b, i) => {
  console.log(`\nP.O. Box Block ${i + 1}:`);
  console.log(`  Facility: ${b.facilityNameLine}`);
  console.log(`  Full block:\n${b.block}`);
});

const lighthouseBlocks = blocks.filter(b => 
  b.facilityNameLine.toLowerCase().includes('lighthouse') ||
  b.block.toLowerCase().includes('lighthouse')
);

console.log(`\nLighthouse blocks: ${lighthouseBlocks.length}`);
lighthouseBlocks.forEach((b, i) => {
  console.log(`\nLighthouse Block ${i + 1}:`);
  console.log(`  Facility: ${b.facilityNameLine}`);
  console.log(`  Block preview: ${b.block.substring(0, 200)}`);
  console.log(`  Has address: ${b.block.includes('P.O. Box') || b.block.includes('731475')}`);
  console.log(`  Has city/state/zip: ${b.block.includes('Dallas') && b.block.includes('TX') && b.block.includes('75373')}`);
});

