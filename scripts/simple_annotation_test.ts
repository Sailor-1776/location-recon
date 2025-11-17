#!/usr/bin/env tsx
/**
 * Simple test script to add annotations to a PDF file
 * Takes a PDF file path and adds test annotations directly to verify visibility
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

async function simpleAnnotationTest(inputPdfPath: string, outputPdfPath?: string) {
	console.log('Simple PDF Annotation Test\n');
	console.log(`Input PDF: ${inputPdfPath}`);
	
	// Check if input file exists
	try {
		await fs.access(inputPdfPath);
		console.log('✓ Input PDF found\n');
	} catch (e) {
		console.error('✗ Input PDF not found:', inputPdfPath);
		process.exit(1);
	}
	
	// Read the PDF
	const pdfBuffer = await fs.readFile(inputPdfPath);
	console.log(`PDF size: ${pdfBuffer.length} bytes\n`);
	
	try {
		// Load PDF
		console.log('Loading PDF...');
		const pdfDoc = await PDFDocument.load(pdfBuffer);
		const pages = pdfDoc.getPages();
		console.log(`✓ Loaded PDF with ${pages.length} page(s)\n`);
		
		// Set up font and styling
		const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
		const fontSize = 16;
		const textColor = rgb(1, 0, 0); // Red color
		
		console.log('Font settings:');
		console.log(`  Font: Helvetica`);
		console.log(`  Size: ${fontSize}pt`);
		console.log(`  Color: rgb(1, 0, 0) - Red\n`);
		
		// Add test annotations to each page
		console.log('Adding test annotations...');
		let annotationCount = 0;
		
		for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
			const page = pages[pageIndex];
			const { width, height } = page.getSize();
			
			console.log(`\nPage ${pageIndex + 1} (${width.toFixed(0)} x ${height.toFixed(0)}):`);
			
			// Add multiple test annotations at different positions
			const testAnnotations = [
				{ text: 'TEST ANNOTATION 1', x: width * 0.7, y: height - 100 },
				{ text: 'RESEARCH REQUIRED', x: width * 0.7, y: height - 150 },
				{ text: 'SEARCH KEY: TEST123', x: width * 0.7, y: height - 200 },
			];
			
			for (const annotation of testAnnotations) {
				const textToDisplay = annotation.text;
				
				console.log(`  Adding: "${textToDisplay}" at (${annotation.x.toFixed(0)}, ${annotation.y.toFixed(0)})`);
				
				// Draw red text annotation matching Test_Data.pdf format
				// Simple red text without backgrounds or borders for clean, interactive annotations
				page.drawText(textToDisplay, {
					x: annotation.x,
					y: annotation.y,
					size: fontSize,
					font: font,
					color: textColor,
					opacity: 1.0,
				});
				
				annotationCount++;
			}
		}
		
		console.log(`\n✓ Added ${annotationCount} test annotations\n`);
		
		// Save the annotated PDF
		console.log('Saving annotated PDF...');
		const pdfBytes = await pdfDoc.save();
		
		const outputPath = outputPdfPath || inputPdfPath.replace(/\.pdf$/i, '_annotated.pdf');
		await fs.writeFile(outputPath, pdfBytes);
		
		console.log(`✓ Saved annotated PDF to: ${outputPath}`);
		console.log(`  Output size: ${pdfBytes.length} bytes\n`);
		
		console.log('✓ Test completed successfully!');
		console.log(`\nPlease open ${outputPath} to verify the annotations are visible.`);
		console.log('You should see red text annotations on the right side of each page.');
		console.log('The text should be selectable/interactive, matching Test_Data.pdf format.');
		
	} catch (error: any) {
		console.error('\n✗ Test failed:', error);
		console.error(error.stack);
		process.exit(1);
	}
}

// Get input file from command line argument or use default
const inputFile = process.argv[2] || path.join(projectRoot, 'data', 'Test_Data_Input.pdf');
const outputFile = process.argv[3];

simpleAnnotationTest(inputFile, outputFile).catch(console.error);

