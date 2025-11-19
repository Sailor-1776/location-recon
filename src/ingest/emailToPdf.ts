import { PDFDocument, rgb, StandardFonts, PDFPage } from 'pdf-lib';
import type { StructuredEmail } from './emailReader';
import { getLogger } from '../utils/logger';

const logger = getLogger();

// Convert HTML to plain text by stripping tags
function htmlToText(html: string): string {
	// Remove script and style tags and their content
	let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
	text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
	
	// Replace common HTML entities
	text = text.replace(/&nbsp;/g, ' ');
	text = text.replace(/&amp;/g, '&');
	text = text.replace(/&lt;/g, '<');
	text = text.replace(/&gt;/g, '>');
	text = text.replace(/&quot;/g, '"');
	text = text.replace(/&#39;/g, "'");
	text = text.replace(/&apos;/g, "'");
	
	// Replace block-level elements with newlines
	text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|td|th)[^>]*>/gi, '\n');
	
	// Remove all remaining HTML tags
	text = text.replace(/<[^>]+>/g, '');
	
	// Decode HTML entities (basic ones)
	text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
	text = text.replace(/&#x([a-f\d]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
	
	// Clean up whitespace
	text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
	text = text.replace(/[ \t]+/g, ' ');
	
	return text.trim();
}

function formatDate(date: Date | undefined): string {
	if (!date) return '';
	try {
		return date.toLocaleString('en-US', {
			weekday: 'short',
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short',
		});
	} catch {
		return String(date);
	}
}

function wrapText(text: string, maxWidth: number, font: any, fontSize: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let currentLine = '';

	for (const word of words) {
		const testLine = currentLine ? `${currentLine} ${word}` : word;
		const width = font.widthOfTextAtSize(testLine, fontSize);
		
		if (width > maxWidth && currentLine) {
			lines.push(currentLine);
			currentLine = word;
		} else {
			currentLine = testLine;
		}
	}
	
	if (currentLine) {
		lines.push(currentLine);
	}
	
	return lines;
}

async function addEmailHeaders(
	page: PDFPage,
	email: StructuredEmail,
	font: any,
	boldFont: any,
	fontSize: number,
	startY: number,
	pageWidth: number,
	margin: number
): Promise<number> {
	let y = startY;
	const lineHeight = fontSize * 1.4;
	const labelWidth = 100;
	const valueX = margin + labelWidth;
	const valueWidth = pageWidth - margin * 2 - labelWidth;
	
	// Header section background
	page.drawRectangle({
		x: margin,
		y: y - lineHeight * 0.5,
		width: pageWidth - margin * 2,
		height: lineHeight * 6,
		color: rgb(0.95, 0.95, 0.95),
		opacity: 0.5,
	});
	
	// From
	if (email.headers.from) {
		page.drawText('From:', {
			x: margin,
			y,
			size: fontSize,
			font: boldFont,
			color: rgb(0.2, 0.2, 0.2),
		});
		const fromLines = wrapText(email.headers.from, valueWidth, font, fontSize);
		for (const line of fromLines) {
			page.drawText(line, {
				x: valueX,
				y,
				size: fontSize,
				font,
				color: rgb(0, 0, 0),
			});
			y -= lineHeight;
		}
	}
	
	// To
	if (email.headers.to && email.headers.to.length > 0) {
		page.drawText('To:', {
			x: margin,
			y,
			size: fontSize,
			font: boldFont,
			color: rgb(0.2, 0.2, 0.2),
		});
		const toText = email.headers.to.join(', ');
		const toLines = wrapText(toText, valueWidth, font, fontSize);
		for (const line of toLines) {
			page.drawText(line, {
				x: valueX,
				y,
				size: fontSize,
				font,
				color: rgb(0, 0, 0),
			});
			y -= lineHeight;
		}
	}
	
	// CC
	if (email.headers.cc && email.headers.cc.length > 0) {
		page.drawText('CC:', {
			x: margin,
			y,
			size: fontSize,
			font: boldFont,
			color: rgb(0.2, 0.2, 0.2),
		});
		const ccText = email.headers.cc.join(', ');
		const ccLines = wrapText(ccText, valueWidth, font, fontSize);
		for (const line of ccLines) {
			page.drawText(line, {
				x: valueX,
				y,
				size: fontSize,
				font,
				color: rgb(0, 0, 0),
			});
			y -= lineHeight;
		}
	}
	
	// Subject
	if (email.headers.subject) {
		page.drawText('Subject:', {
			x: margin,
			y,
			size: fontSize,
			font: boldFont,
			color: rgb(0.2, 0.2, 0.2),
		});
		const subjectLines = wrapText(email.headers.subject, valueWidth, font, fontSize);
		for (const line of subjectLines) {
			page.drawText(line, {
				x: valueX,
				y,
				size: fontSize,
				font: boldFont,
				color: rgb(0, 0, 0),
			});
			y -= lineHeight;
		}
	}
	
	// Date
	if (email.headers.date) {
		page.drawText('Date:', {
			x: margin,
			y,
			size: fontSize,
			font: boldFont,
			color: rgb(0.2, 0.2, 0.2),
		});
		page.drawText(formatDate(email.headers.date), {
			x: valueX,
			y,
			size: fontSize,
			font,
			color: rgb(0, 0, 0),
		});
		y -= lineHeight;
	}
	
	return y - lineHeight * 0.5; // Add some spacing after headers
}


async function addAttachments(
	page: PDFPage,
	email: StructuredEmail,
	font: any,
	boldFont: any,
	fontSize: number,
	startY: number,
	pageWidth: number,
	margin: number
): Promise<number> {
	if (email.attachments.length === 0) {
		return startY;
	}
	
	let y = startY;
	const lineHeight = fontSize * 1.4;
	const smallFontSize = fontSize * 0.9;
	
	// Attachments section header
	y -= lineHeight;
	page.drawText('Attachments:', {
		x: margin,
		y,
		size: fontSize,
		font: boldFont,
		color: rgb(0.2, 0.2, 0.2),
	});
	y -= lineHeight * 1.2;
	
	// List attachments
	for (const attachment of email.attachments) {
		const sizeKB = (attachment.size / 1024).toFixed(1);
		const attachmentText = `${attachment.filename} (${sizeKB} KB, ${attachment.contentType})`;
		const lines = wrapText(attachmentText, pageWidth - margin * 2, font, smallFontSize);
		
		for (const line of lines) {
			page.drawText('  • ', {
				x: margin,
				y,
				size: smallFontSize,
				font,
				color: rgb(0.3, 0.3, 0.3),
			});
			page.drawText(line, {
				x: margin + 20,
				y,
				size: smallFontSize,
				font,
				color: rgb(0.3, 0.3, 0.3),
			});
			y -= lineHeight * 0.9;
		}
		y -= lineHeight * 0.3;
	}
	
	return y;
}

export async function convertEmailToPdf(email: StructuredEmail): Promise<Buffer> {
	const pdfDoc = await PDFDocument.create();
	const page = pdfDoc.addPage([612, 792]); // US Letter size
	const { width, height } = page.getSize();
	
	const margin = 50;
	const fontSize = 10;
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
	const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
	
	const pages: PDFPage[] = [page];
	const currentPageIndex = { value: 0 };
	
	// Helper function to get or create a page
	const getOrCreatePage = (index: number): PDFPage => {
		while (pages.length <= index) {
			pages.push(pdfDoc.addPage([612, 792]));
		}
		return pages[index]!;
	};
	
	let y = height - margin;
	
	// Add headers on first page
	y = await addEmailHeaders(pages[0]!, email, font, boldFont, fontSize, y, width, margin);
	
	// Add separator line
	pages[0]!.drawLine({
		start: { x: margin, y },
		end: { x: width - margin, y },
		thickness: 1,
		color: rgb(0.7, 0.7, 0.7),
	});
	y -= 20;
	
	// Add attachments section if present (on first page)
	if (email.attachments.length > 0) {
		y = await addAttachments(pages[0]!, email, font, boldFont, fontSize, y, width, margin);
		
		// Add separator before body
		y -= 10;
		pages[0]!.drawLine({
			start: { x: margin, y },
			end: { x: width - margin, y },
			thickness: 1,
			color: rgb(0.7, 0.7, 0.7),
		});
		y -= 20;
	}
	
	// Add body (supports multi-page with dynamic page creation)
	const bodyText = email.text || (email.html ? htmlToText(email.html) : '');
	if (bodyText) {
		const lineHeight = fontSize * 1.4;
		const maxWidth = width - margin * 2;
		const minY = margin + lineHeight;
		const paragraphs = bodyText.split(/\n\s*\n/).filter(p => p.trim());
		
		for (const paragraph of paragraphs) {
			const lines = wrapText(paragraph.trim(), maxWidth, font, fontSize);
			
			for (const line of lines) {
				// Check if we need a new page
				if (y < minY) {
					currentPageIndex.value++;
					const newPage = getOrCreatePage(currentPageIndex.value);
					y = height - margin;
				}
				
				const currentPage = getOrCreatePage(currentPageIndex.value);
				currentPage.drawText(line, {
					x: margin,
					y,
					size: fontSize,
					font,
					color: rgb(0, 0, 0),
				});
				y -= lineHeight;
			}
			y -= lineHeight * 0.3; // Paragraph spacing
		}
	}
	
	const pdfBytes = await pdfDoc.save();
	return Buffer.from(pdfBytes);
}

