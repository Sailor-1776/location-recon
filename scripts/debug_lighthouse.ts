import { extractText } from '../src/ingest/pdfReader';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = path.join(__dirname, '../data/MEDICAL PROVIDERS-JAEGER.pdf');

const extraction = await extractText(pdfPath);
const lines = extraction.text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

console.log('Lines around Lighthouse (with indices):');
lines.forEach((line, idx) => {
  if (idx >= 36 && idx <= 42) {
    const isNumbered = /^\d+[.,]\s*[A-Z]/.test(line.trim());
    const isPOBox = /^P\.?O\.?\s+Box/i.test(line);
    const isCityStateZip = /,\s*([A-Z]{2}|[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+\d{5}(?:-\d{4})?$/i.test(line);
    console.log(`[${idx}] "${line}" | numbered:${isNumbered} poBox:${isPOBox} cityStateZip:${isCityStateZip}`);
  }
});

// Simulate the extraction logic
const i = 37; // Index of "8.    Lighthouse Anesthesia, PLLC"
let currentIndex = i + 1; // Should be 38
console.log(`\nSimulating extraction for line ${i}:`);
console.log(`  Facility line: "${lines[i]}"`);
console.log(`  Starting currentIndex: ${currentIndex}`);
console.log(`  Line at currentIndex: "${lines[currentIndex]}"`);

// Check doctor names
let doctorNameLines = [];
let lastDoctorLine = '';
while (currentIndex < lines.length) {
  const nextLine = lines[currentIndex];
  console.log(`  Checking line ${currentIndex}: "${nextLine}"`);
  
  if (/^\d+[.,]\s*[A-Z]/.test(nextLine.trim())) {
    console.log(`    -> Break: numbered list item`);
    break;
  }
  if (/,\s*([A-Z]{2}|[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+\d{5}(?:-\d{4})?$/i.test(nextLine)) {
    console.log(`    -> Break: city/state/zip`);
    break;
  }
  if (/^\d+\s+[A-Za-z]/.test(nextLine)) {
    console.log(`    -> Break: address line`);
    break;
  }
  
  // Check if doctor name
  const isDoctorName = /,\s*(M\.?D\.?|D\.?O\.?|P\.?A\.?|N\.?P\.?|RN|CCMA|FNP|FNP-C|DC\.?)/i.test(nextLine) ||
                       /\b(M\.?D\.?|D\.?O\.?|P\.?A\.?|N\.?P\.?|RN|CCMA|FNP|FNP-C|DC\.?)\b/i.test(nextLine) ||
                       /;/.test(nextLine);
  
  if (isDoctorName) {
    console.log(`    -> Doctor name, incrementing`);
    doctorNameLines.push(nextLine);
    lastDoctorLine = nextLine;
    currentIndex++;
  } else {
    console.log(`    -> Not doctor name, breaking`);
    break;
  }
}

console.log(`\nAfter doctor name loop:`);
console.log(`  currentIndex: ${currentIndex}`);
console.log(`  Line at currentIndex: "${lines[currentIndex]}"`);
console.log(`  Is P.O. Box: ${/^P\.?O\.?\s+Box/i.test(lines[currentIndex])}`);

