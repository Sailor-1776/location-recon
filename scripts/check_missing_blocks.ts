import { extractText } from '../src/ingest/pdfReader';
import { extractStructuredFacilities, filterMedicalBlocks } from '../src/ingest/textUtils';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = path.join(__dirname, '../data/MEDICAL PROVIDERS-JAEGER.pdf');

const extraction = await extractText(pdfPath);
const allBlocks = extractStructuredFacilities(extraction.text, extraction.pages);
const filteredBlocks = filterMedicalBlocks(allBlocks);

console.log(`Total blocks extracted: ${allBlocks.length}`);
console.log(`Blocks after medical filter: ${filteredBlocks.length}`);
console.log(`Filtered out: ${allBlocks.length - filteredBlocks.length}\n`);

const missingFacilities = [
  'Chiropractic Associates',
  'Equinox Spine',
  'Fairview Monitoring',
  'Lighthouse Anesthesia',
  'Merge Health',
  'Synnovation'
];

console.log('=== CHECKING MISSING FACILITIES ===\n');
missingFacilities.forEach(facility => {
  const foundBefore = allBlocks.find(b => 
    b.facilityNameLine.toLowerCase().includes(facility.toLowerCase()) ||
    b.block.toLowerCase().includes(facility.toLowerCase())
  );
  const foundAfter = filteredBlocks.find(b => 
    b.facilityNameLine.toLowerCase().includes(facility.toLowerCase()) ||
    b.block.toLowerCase().includes(facility.toLowerCase())
  );
  
  console.log(`${facility}:`);
  console.log(`  Before filter: ${foundBefore ? 'FOUND' : 'MISSING'}`);
  console.log(`  After filter: ${foundAfter ? 'FOUND' : 'MISSING'}`);
  if (foundBefore && !foundAfter) {
    console.log(`  Block content: ${foundBefore.block.substring(0, 200)}`);
    console.log(`  Why filtered: Missing medical keywords`);
  }
  console.log('');
});

console.log('\n=== ALL EXTRACTED BLOCKS (BEFORE FILTER) ===');
allBlocks.forEach((b, i) => {
  console.log(`${i + 1}. ${b.facilityNameLine}`);
});

