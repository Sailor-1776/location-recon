import { NextRequest, NextResponse } from 'next/server';
import { extractCandidateBlocks, extractStructuredFacilities, filterMedicalBlocks, blocksToStrings, type BlockWithPosition } from '../../../../../ingest/textUtils';
import { normalizeAddress } from '../../../../../normalize/address';
import { getDAO } from '../../../../../match/locationsDAO';
import { loadConfig } from '../../../../../config';
import { reconcileOne } from '../../../../../match/matcher';
import { canonicalKey } from '../../../../../types';
import { getLogger } from '../../../../../utils/logger';
import { isAddressExact, isNameExact } from '../../../../../match/scorers';
import { extractText } from '../../../../../ingest/pdfReader';
import type { PdfTextExtraction } from '../../../../../ingest/pdfReader';
import { annotatePdfWithSearchKeysImproved } from '../../../../../ingest/pdfAnnotator';
import { parseEmailStructuredFromBuffer } from '../../../../../ingest/emailReader';
import { convertEmailToPdf } from '../../../../../ingest/emailToPdf';
import { extractWarningMessage, extractSearchKeyFromWarning } from '../../../../../llm/assistant';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Log that module loaded successfully
console.log('[RECONCILE ROUTE] Module loaded successfully');

export const runtime = 'nodejs';

// Handle unhandled promise rejections at the module level
if (typeof process !== 'undefined') {
	process.on('unhandledRejection', (reason, promise) => {
		console.error('Unhandled Rejection at:', promise, 'reason:', reason);
	});
}

export async function POST(req: NextRequest) {
	// Wrap everything to ensure we always return JSON, even if logger initialization fails
	let logger: ReturnType<typeof getLogger>;
	try {
		logger = getLogger();
		logger.info('Reconcile route called');
	} catch (e: any) {
		// If logger fails, use console as fallback
		console.error('Failed to initialize logger:', e?.message);
		// Create a minimal logger
		logger = {
			info: (msg: string) => console.log(`[INFO] ${msg}`),
			warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta),
			error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta),
			debug: (msg: string, meta?: any) => console.debug(`[DEBUG] ${msg}`, meta),
		} as ReturnType<typeof getLogger>;
	}
	
	// Wrap in try-catch to catch any synchronous errors during initialization
	try {
		// Ensure we always return a response, even if there's an unhandled rejection
		return await (async () => {
			try {
		let formData: FormData;
		try {
			formData = await req.formData();
		} catch (e: any) {
			logger.error('Failed to parse formData', { message: e?.message });
			return NextResponse.json({ 
				error: 'Bad Request',
				message: `Failed to parse form data: ${e?.message || 'Unknown error'}`,
			}, { status: 400 });
		}
		let dao: ReturnType<typeof getDAO>;
		try {
			dao = getDAO(loadConfig().mr8Driver);
		} catch (e: any) {
			logger.error('Failed to initialize DAO', { message: e?.message, stack: e?.stack });
			return NextResponse.json({ 
				error: 'Configuration Error',
				message: `Failed to initialize database connection: ${e?.message || 'Unknown error'}`,
			}, { status: 500 });
		}
		const results: any[] = [];
		const inputText = formData.get('text');
		if (typeof inputText === 'string' && inputText.trim()) {
			const blocks = extractCandidateBlocks(inputText);
			for (const blockWithPos of blocks) {
				try {
					const block = blockWithPos.block;
					const canonical = normalizeAddress(block);
					const match = await reconcileOne(canonical, dao);
				const name_exact = !!(match.record && isNameExact(canonical.name, match.record.name));
				const address_exact = !!(match.record && isAddressExact(canonical, match.record));
				// Treat fuzzy EXACT as a found match (do not require strict equality)
				const found = match.status === 'EXACT' && !!match.record;
				const search_key =
					found && match.record
						? match.record.search_key ||
						  canonicalKey({
						  	name: match.record.name,
						  	address1: match.record.address1,
						  	city: match.record.city,
						  	state: match.record.state,
						  	postal_code: match.record.postal_code,
						  })
						: undefined;
				results.push({
					input: block.split(/\n/).slice(0, 3).join(' '),
					parsed: canonical,
					match,
					outcome: found ? 'FOUND' : 'RESEARCH',
					search_key,
					name_exact,
					address_exact,
					note: found ? undefined : 'User needs to conduct research.',
				});
				} catch (e: any) {
					logger.error('Failed to process text block', { message: e?.message, block: blockWithPos.block.substring(0, 100) });
					// Continue processing other blocks
				}
			}
		}
		const files = formData.getAll('files');
		const pdfFiles: Array<{
			file: File;
			buffer: Buffer;
			text: string;
			textExtraction: PdfTextExtraction;
			blocks: Array<{ block: string; searchKey?: string; warningMessage?: string; pageIndex?: number; y?: number; x?: number; maxX?: number; facilityNameLine?: string }>;
		}> = [];
		
		for (const f of files) {
			if (!(f instanceof File)) continue;
			const buf = Buffer.from(await f.arrayBuffer());
			let text = '';
			let textExtraction: PdfTextExtraction | undefined;
			let processedBuffer = buf;
			let processedFileName = f.name;
			
			// Check if it's an email file
			const isEmail = f.name.toLowerCase().endsWith('.eml') || f.type === 'message/rfc822';
			
			// Check if it's a PDF file
			const isPdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
			
			if (isEmail) {
				// Parse email and convert to PDF
				try {
					logger.info('Processing email file', { fileName: f.name });
					const structuredEmail = await parseEmailStructuredFromBuffer(buf);
					
					// Convert email to PDF
					const emailPdfBuffer = await convertEmailToPdf(structuredEmail);
					processedBuffer = emailPdfBuffer;
					processedFileName = f.name.replace(/\.eml$/i, '.pdf');
					
					// Extract text from the converted PDF
					const tmpPath = path.join(os.tmpdir(), `email-pdf-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`);
					await fs.writeFile(tmpPath, emailPdfBuffer);
					textExtraction = await extractText(tmpPath);
					text = textExtraction.text;
					// Clean up temp file
					await fs.unlink(tmpPath).catch(() => {});
					
					logger.info('Email converted to PDF', {
						originalFileName: f.name,
						convertedFileName: processedFileName,
						textLength: text.length,
						attachmentCount: structuredEmail.attachments.length,
						hasHtml: !!structuredEmail.html,
					});
					
					// Handle PDF attachments separately
					for (const attachment of structuredEmail.attachments) {
						if (attachment.contentType === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf')) {
							logger.info('Found PDF attachment in email', {
								fileName: attachment.filename,
								size: attachment.size,
							});
							// PDF attachments could be processed separately if needed
							// For now, we'll just log them
						}
					}
				} catch (e: any) {
					logger.error('Email processing failed', { message: e?.message, stack: e?.stack, file: f.name });
					// Fallback to text extraction
					try {
						const structuredEmail = await parseEmailStructuredFromBuffer(buf);
						text = structuredEmail.extractedText;
						textExtraction = { text };
					} catch (fallbackError: any) {
						logger.warn('Email fallback extraction failed', { message: fallbackError?.message, file: f.name });
						text = '';
						textExtraction = { text };
					}
				}
			} else if (isPdf) {
				// Extract text from PDF using pdfReader
				try {
					// Write buffer to temp file for pdfReader
					const tmpPath = path.join(os.tmpdir(), `pdf-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`);
					await fs.writeFile(tmpPath, buf);
					textExtraction = await extractText(tmpPath);
					text = textExtraction.text;
					// Clean up temp file
					await fs.unlink(tmpPath).catch(() => {});
				} catch (e: any) {
					logger.warn('PDF extraction failed', { message: e?.message, file: f.name });
					text = '';
					textExtraction = { text };
				}
			} else {
				// For non-PDF files, treat as text
				try {
					text = buf.toString('utf8');
				} catch {
					text = '';
				}
			}
			
			// Use structured facility extraction for PDFs (including converted emails), fallback to candidate blocks for other formats
			// Pass positional pages data if available for accurate Y-axis positioning
			const pages = textExtraction?.pages;
			let blocks: BlockWithPosition[] = (isPdf || isEmail) && text.trim()
				? extractStructuredFacilities(text, pages)
				: extractCandidateBlocks(text, pages);
			// Fallback: if structured extraction finds nothing for PDFs, try candidate heuristics
			if ((isPdf || isEmail) && blocks.length === 0 && text.trim()) {
				logger.warn('Structured facility extraction returned no blocks; falling back to candidate block extraction');
				blocks = extractCandidateBlocks(text, pages);
			}
			
			// Filter blocks to only include those with medical/healthcare keywords
			const blocksBeforeFilter = blocks.length;
			blocks = filterMedicalBlocks(blocks);
			if (blocksBeforeFilter > blocks.length) {
				logger.info('Filtered blocks to medical/healthcare only', {
					before: blocksBeforeFilter,
					after: blocks.length,
					filteredOut: blocksBeforeFilter - blocks.length
				});
			}

			logger.info('Extracted blocks from file', {
				fileName: f.name,
				isPdf,
				isEmail,
				blocksCount: blocks.length,
				textLength: text.length,
				hasPositionData: blocks.some(b => b.y > 0),
				blocks: blocks.map((block, idx) => ({
					index: idx + 1,
					preview: block.block.substring(0, 200),
					fullBlock: block.block,
					lineCount: block.block.split(/\r?\n/).length,
					hasPosition: block.y > 0,
					pageIndex: block.pageIndex,
					y: block.y
				}))
			});

			// Debug: log extracted text content
			if (isPdf || isEmail) {
				const lines = text.split(/\r?\n/);
				logger.info('PDF text preview', {
					fileName: f.name,
					textLength: text.length,
					lineCount: lines.length,
					firstLines: lines.slice(0, 20).join('\n'),
					// Look for medical record patterns
					hasHospital: /hospital|medical|records|radiology/i.test(text),
					hasAddresses: /\d+\s+[A-Za-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd)/gi.test(text),
					hasPhone: /\(\d{3}\)\s*\d{3}[-]\d{4}/g.test(text),
					hasDepartment: /radiology|records|billing|medical records/i.test(text),
					// Show lines that might contain medical records
					sampleLines: lines.slice(20, 50).join('\n')
				});
			}
			
			// Track PDF files (including converted emails) and their location blocks for annotation
			if (isPdf || isEmail) {
				pdfFiles.push({
					file: new File([processedBuffer], processedFileName, { type: 'application/pdf' }),
					buffer: processedBuffer,
					text,
					textExtraction: textExtraction ?? { text },
					blocks: [],
				});
			}
			
			for (const blockWithPos of blocks) {
				try {
					const block = blockWithPos.block;
					logger.info('Processing block', {
						blockIndex: blocks.indexOf(blockWithPos) + 1,
						totalBlocks: blocks.length,
						blockPreview: block.substring(0, 150),
						hasPosition: blockWithPos.y > 0,
						pageIndex: blockWithPos.pageIndex,
						y: blockWithPos.y
					});
					const ca = normalizeAddress(block);
					logger.info('Normalized address', {
						normalized: ca
					});
					const match = await reconcileOne(ca, dao);
					logger.info('Match result', {
						blockPreview: block.substring(0, 50),
						matchStatus: match.status,
						hasRecord: !!match.record,
						nameScore: match.scores?.name,
						addressScore: match.scores?.address,
						departmentScore: match.scores?.department,
						recordName: match.record?.name,
						recordDepartment: match.record?.department
					});
				const name_exact = !!(match.record && isNameExact(ca.name, match.record.name));
				const address_exact = !!(match.record && isAddressExact(ca, match.record));
				// Treat fuzzy EXACT or CLOSE as a found match (department already checked before fuzzy matching)
				// Department filtering happens in reconcileOne before fuzzy matching, so if we get a match, department already matches
				const found = (match.status === 'EXACT' || match.status === 'CLOSE') && !!match.record;
				
				// Check department first: if matched record's department is "Non-Order", return full warning text instead of search key
				const matchedDepartment = match.record ? (match.record.department || '').toString().trim().toLowerCase() : '';
				const isNonOrder = matchedDepartment === 'non-order';
				
				let warningMessage: string | undefined = undefined;
				let search_key: string | undefined = undefined;
				
				if (isNonOrder && match.record) {
					// Department column says "Non-Order": return search key with "-non" suffix
					// First, get or generate the search key from the Search Key column
					const baseSearchKey = match.record.search_key ||
						canonicalKey({
							name: match.record.name,
							address1: match.record.address1,
							city: match.record.city,
							state: match.record.state,
							postal_code: match.record.postal_code,
						});
					
					// Append "-non" if not already present
					search_key = baseSearchKey.endsWith('-non') ? baseSearchKey : `${baseSearchKey}-non`;
					
					// Extract search-key-like pattern from warning field and append to search_key
					if (match.record.warning) {
						try {
							const extractedFromWarning = extractSearchKeyFromWarning(match.record.warning, search_key);
							if (extractedFromWarning) {
								logger.info('Extracted search key pattern from warning', {
									searchKey: search_key,
									extractedFromWarning,
									warning: match.record.warning.substring(0, 100)
								});
								// Append the extracted pattern to the right of SEARCHKEY-non
								search_key = `${search_key} ${extractedFromWarning}`;
							}
						} catch (e: any) {
							logger.warn('Failed to extract search key from warning', { error: e?.message });
						}
					}
				} else if (found && match.record) {
					// Department is not "Non-Order" and we have a match: return search key
					// Return search key for both EXACT and CLOSE matches (department already verified in reconcileOne)
					search_key =
						match.record.search_key ||
						canonicalKey({
							name: match.record.name,
							address1: match.record.address1,
							city: match.record.city,
							state: match.record.state,
							postal_code: match.record.postal_code,
						});
				} else {
					// No match found (NEW status or edge case): annotate with research required message
					warningMessage = 'RESEARCH REQUIRED';
				}
				
				// Track blocks for PDF annotation
				if (isPdf && pdfFiles.length > 0) {
					const pdfFile = pdfFiles[pdfFiles.length - 1];
					// Only add blocks that have searchKey or warningMessage for annotation
					if (search_key || warningMessage) {
						logger.info('Adding block to PDF annotation', { 
							blockIndex: blocks.indexOf(blockWithPos) + 1,
							totalBlocks: blocks.length,
							block: block, // Full block text
							blockPreview: block.substring(0, 150),
							searchKey: search_key,
							warningMessage: warningMessage,
							hasWarning: !!warningMessage,
							matchStatus: match.status,
							parsedName: ca.name,
							parsedAddress: `${ca.address1}, ${ca.city}, ${ca.state} ${ca.postal_code}`,
							hasPosition: blockWithPos.y > 0,
							pageIndex: blockWithPos.pageIndex,
							y: blockWithPos.y
						});
						// Include position data in the annotation block
						pdfFile.blocks.push({ 
							block, 
							searchKey: search_key, 
							warningMessage,
							pageIndex: blockWithPos.pageIndex,
							y: blockWithPos.y,
							x: blockWithPos.x,
							maxX: blockWithPos.maxX,
							facilityNameLine: blockWithPos.facilityNameLine
						});
					} else {
						logger.info('Skipping block (no searchKey or warningMessage)', { 
							blockIndex: blocks.indexOf(blockWithPos) + 1,
							totalBlocks: blocks.length,
							block: block, // Full block text
							blockPreview: block.substring(0, 150),
							matchStatus: match.status,
							hasRecord: !!match.record,
							found: found,
							isNonOrder: isNonOrder,
							parsedName: ca.name,
							parsedAddress: `${ca.address1}, ${ca.city}, ${ca.state} ${ca.postal_code}`
						});
					}
				}
				
				results.push(
					{
						file: f.name,
						input: block.split(/\n/).slice(0, 3).join(' '),
						parsed: ca,
						match,
						outcome: found ? 'FOUND' : 'RESEARCH',
						search_key,
						name_exact,
						address_exact,
						note: found ? undefined : 'User needs to conduct research.',
					},
				);
				} catch (e: any) {
					logger.error('Failed to process file block', { message: e?.message, file: f.name, block: blockWithPos.block.substring(0, 100) });
					// Continue processing other blocks
				}
			}
		}
		
		// If we have exactly one PDF file, return the annotated PDF
		if (pdfFiles.length === 1 && files.length === 1) {
			const pdfFile = pdfFiles[0];
			const blocksWithKeys = pdfFile.blocks.filter(b => b.searchKey || b.warningMessage);
			logger.info('Annotating PDF', { 
				fileName: pdfFile.file.name, 
				blocksCount: pdfFile.blocks.length,
				blocksWithKeys: blocksWithKeys.length,
				blocks: pdfFile.blocks.map(b => ({
					blockPreview: b.block.substring(0, 100),
					hasSearchKey: !!b.searchKey,
					hasWarning: !!b.warningMessage,
					searchKey: b.searchKey,
					warningMessage: b.warningMessage?.substring(0, 50)
				}))
			});
			
			if (blocksWithKeys.length === 0) {
				// Force a minimal annotation so users can verify behavior even when extraction fails
				logger.warn('No blocks with search keys or warnings; forcing fallback annotation with RESEARCH REQUIRED');
				const fallbackBlocks = [{ block: 'RESEARCH REQUIRED', warningMessage: 'RESEARCH REQUIRED' as const }];
				try {
					const annotatedPdf = await annotatePdfWithSearchKeysImproved(pdfFile.buffer, fallbackBlocks, pdfFile.textExtraction);
					logger.info('PDF annotation (forced fallback) successful', { 
						fileName: pdfFile.file.name,
						bufferSize: annotatedPdf.length
					});
					return new NextResponse(annotatedPdf, {
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Disposition': `attachment; filename="${pdfFile.file.name}"`,
						},
					});
				} catch (e: any) {
					logger.error('PDF fallback annotation failed', { message: e?.message, stack: e?.stack });
					// Fall through to JSON response if fallback also fails
				}
			} else {
				try {
					const annotatedPdf = await annotatePdfWithSearchKeysImproved(pdfFile.buffer, pdfFile.blocks, pdfFile.textExtraction);
					
					logger.info('PDF annotation successful', { 
						fileName: pdfFile.file.name,
						bufferSize: annotatedPdf.length
					});
					return new NextResponse(annotatedPdf, {
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Disposition': `attachment; filename="annotated-${pdfFile.file.name}"`,
						},
					});
				} catch (e: any) {
					logger.error('PDF annotation failed', { message: e?.message, stack: e?.stack });
					// Fall back to JSON response if annotation fails
				}
			}
		}
		
		// For multiple files or non-PDF files, return JSON with results
		// If we have PDFs but multiple files, include annotated PDFs as base64
		const annotatedPdfs: Record<string, string> = {};
		if (pdfFiles.length > 0) {
			for (const pdfFile of pdfFiles) {
				try {
					const annotatedPdf = await annotatePdfWithSearchKeysImproved(pdfFile.buffer, pdfFile.blocks, pdfFile.textExtraction);
					annotatedPdfs[pdfFile.file.name] = annotatedPdf.toString('base64');
				} catch (e: any) {
					logger.error('PDF annotation failed', { message: e?.message, file: pdfFile.file.name });
				}
			}
		}
		
				return NextResponse.json({ results, annotatedPdfs: Object.keys(annotatedPdfs).length > 0 ? annotatedPdfs : undefined });
			} catch (e: any) {
				logger.error('Reconcile route failed', { message: e?.message, stack: e?.stack, name: e?.name, cause: e?.cause });
				// Ensure we always return JSON, not HTML
				return NextResponse.json({ 
					error: 'Internal Server Error',
					message: e?.message || 'Unknown error',
					stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined
				}, { 
					status: 500,
					headers: {
						'Content-Type': 'application/json',
					}
				});
			}
		})();
	} catch (e: any) {
		// Catch any errors that happen during the async wrapper
		console.error('Fatal error in reconcile route:', e?.message, e?.stack);
		return NextResponse.json({ 
			error: 'Internal Server Error',
			message: e?.message || 'Fatal error occurred',
			stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined
		}, { 
			status: 500,
			headers: {
				'Content-Type': 'application/json',
			}
		});
	}
}


