'use client';
import React, { useState, useRef, useCallback } from 'react';

type Result = {
	file?: string;
	input?: string;
	parsed: {
		name?: string;
		address1: string;
		address2?: string | null;
		city: string;
		state: string;
		postal_code: string;
	};
	match: {
		status: 'EXACT' | 'CLOSE' | 'NEW';
		scores: { name: number; address: number; geodistance_m: number | null };
		explanation: string;
		record?: { id: string | number | null; name: string } | null;
	};
	outcome?: 'FOUND' | 'RESEARCH';
	search_key?: string;
	name_exact?: boolean;
	address_exact?: boolean;
	note?: string;
};

type Message = {
	id: string;
	type: 'user' | 'assistant';
	content: string;
	files?: File[];
	results?: Result[];
	annotatedPdf?: { blob: Blob; filename: string };
	annotatedPdfs?: Record<string, string>; // base64 encoded PDFs
	timestamp: Date;
};

export default function ChatInterface() {
	const [messages, setMessages] = useState<Message[]>([
		{
			id: '1',
			type: 'assistant',
			content: 'Hello! I\'m here to help you reconcile location data. You can drop files or paste text containing addresses, and I\'ll process them for you.',
			timestamp: new Date(),
		},
	]);
	const [inputText, setInputText] = useState('');
	const [isDragOver, setIsDragOver] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
	}, []);

	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);

		const files = Array.from(e.dataTransfer.files);
		const validFiles = files.filter(file =>
			['application/pdf', 'message/rfc822', 'application/vnd.ms-outlook', 'text/plain']
				.includes(file.type) || file.name.match(/\.(pdf|eml|msg|txt)$/i)
		);

		if (validFiles.length > 0) {
			setAttachedFiles(prev => [...prev, ...validFiles]);
		}
	}, []);

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files || []);
		setAttachedFiles(prev => [...prev, ...files]);
	};

	const removeFile = (index: number) => {
		setAttachedFiles(prev => prev.filter((_, i) => i !== index));
	};

	const processFiles = async (files: File[], text?: string): Promise<{ results: Result[]; annotatedPdf?: { blob: Blob; filename: string }; annotatedPdfs?: Record<string, string> }> => {
		const formData = new FormData();
		files.forEach(file => formData.append('files', file));
		if (text?.trim()) {
			formData.append('text', text.trim());
		}

		try {
			const res = await fetch('/api/reconcile', { method: 'POST', body: formData });
			if (!res.ok) {
				// Always try to extract error message from response
				let errorMessage = `HTTP ${res.status}`;
				try {
					const errorText = await res.text();
					console.error('API Error Response:', { status: res.status, statusText: res.statusText, text: errorText });
					if (errorText) {
						try {
							const errorJson = JSON.parse(errorText);
							errorMessage = errorJson.message || errorJson.error || errorMessage;
							console.error('Parsed error JSON:', errorJson);
						} catch (parseError) {
							// If not JSON, use the text as error message if it's reasonable
							const trimmed = errorText.trim();
							if (trimmed && trimmed.length < 500) {
								errorMessage = trimmed;
							}
						}
					}
				} catch (readError) {
					console.error('Failed to read error response:', readError);
					// If we can't read the response, use the status code
				}
				throw new Error(errorMessage);
			}
			
			// Check if response is a PDF (single PDF file uploaded)
			const contentType = res.headers.get('content-type');
			if (contentType === 'application/pdf') {
				const blob = await res.blob();
				const contentDisposition = res.headers.get('content-disposition');
				const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
				const filename = filenameMatch ? filenameMatch[1] : 'annotated.pdf';
				
				return {
					results: [],
					annotatedPdf: { blob, filename },
				};
			}
			
			// Otherwise, it's JSON
			const json = await res.json();
			return {
				results: json.results || [],
				annotatedPdfs: json.annotatedPdfs,
			};
		} catch (err: any) {
			throw new Error(err?.message || 'Processing failed');
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!inputText.trim() && attachedFiles.length === 0) return;

		const userMessage: Message = {
			id: Date.now().toString(),
			type: 'user',
			content: inputText,
			files: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
			timestamp: new Date(),
		};

		setMessages(prev => [...prev, userMessage]);
		setInputText('');
		setAttachedFiles([]);
		setIsProcessing(true);

		try {
			const response = await processFiles(attachedFiles, inputText);

			// Handle single PDF response
			if (response.annotatedPdf) {
				// Create download link
				const url = URL.createObjectURL(response.annotatedPdf.blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = response.annotatedPdf.filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				
				const assistantMessage: Message = {
					id: (Date.now() + 1).toString(),
					type: 'assistant',
					content: `I've processed your PDF and annotated it with search keys. The annotated PDF has been downloaded.`,
					annotatedPdf: response.annotatedPdf,
					timestamp: new Date(),
				};
				setMessages(prev => [...prev, assistantMessage]);
				return;
			}

			// For text-only inputs, return simplified output per exercise:
			if (attachedFiles.length === 0) {
				const lines = (response.results as Result[]).map((r) => {
					const p = r.parsed;
					const name = p.name ? `${p.name} — ` : '';
					const addr2 = p.address2 ? `, ${p.address2}` : '';
					if (r.outcome === 'FOUND') {
						return `${name}FOUND${r.search_key ? ` — ${r.search_key}` : ''}`;
					}
					return `${name}User needs to conduct research. (${p.address1}${addr2}, ${p.city}, ${p.state} ${p.postal_code})`;
				});
				const assistantMessage: Message = {
					id: (Date.now() + 1).toString(),
					type: 'assistant',
					content: lines.length > 0 ? lines.join(' | ') : 'No locations were found in your input.',
					timestamp: new Date(),
				};
				setMessages(prev => [...prev, assistantMessage]);
				return;
			}

			// Handle multiple files with annotated PDFs
			if (response.annotatedPdfs && Object.keys(response.annotatedPdfs).length > 0) {
				// Create download links for each annotated PDF
				for (const [filename, base64] of Object.entries(response.annotatedPdfs)) {
					const binaryString = atob(base64);
					const bytes = new Uint8Array(binaryString.length);
					for (let i = 0; i < binaryString.length; i++) {
						bytes[i] = binaryString.charCodeAt(i);
					}
					const blob = new Blob([bytes], { type: 'application/pdf' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = filename;
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
					URL.revokeObjectURL(url);
				}
			}

			const assistantMessage: Message = {
				id: (Date.now() + 1).toString(),
				type: 'assistant',
				content: response.results.length > 0
					? `I've processed your files and found ${response.results.length} location${response.results.length !== 1 ? 's' : ''}.${response.annotatedPdfs && Object.keys(response.annotatedPdfs).length > 0 ? ' Annotated PDFs have been downloaded.' : ''}`
					: 'No locations were found in your input.',
				results: response.results.length > 0 ? response.results : undefined,
				annotatedPdfs: response.annotatedPdfs,
				timestamp: new Date(),
			};

			setMessages(prev => [...prev, assistantMessage]);
		} catch (error: any) {
			const errorMessage: Message = {
				id: (Date.now() + 1).toString(),
				type: 'assistant',
				content: `Sorry, I encountered an error: ${error.message}`,
				timestamp: new Date(),
			};
			setMessages(prev => [...prev, errorMessage]);
		} finally {
			setIsProcessing(false);
		}
	};

	const formatAddress = (parsed: Result['parsed']) => (
		<div className="text-sm text-gray-600">
			<div className="font-medium text-gray-900">{parsed.name || 'Unknown'}</div>
			<div>{parsed.address1}{parsed.address2 ? `, ${parsed.address2}` : ''}</div>
			<div>{parsed.city}, {parsed.state} {parsed.postal_code}</div>
		</div>
	);

	return (
		<div className="flex flex-col h-screen bg-gray-50">
			{/* Header */}
			<header className="bg-white border-b border-gray-200 px-6 py-4">
				<h1 className="text-xl font-semibold text-gray-900">Location Reconciliation Assistant</h1>
				<p className="text-sm text-gray-600">Upload files or paste text to reconcile location data</p>
			</header>

			{/* Chat Messages */}
			<div className="flex-1 overflow-y-auto px-6 py-6">
				<div className="mx-auto w-full max-w-[90vw] space-y-6">
					{messages.map((message) => (
						<div key={message.id} className="flex justify-center items-center animate-slide-up">
							<div className={`flex flex-col items-center ${message.type === 'user' ? 'order-2' : 'order-1'}`}>
								{/* Message Bubble */}
								<div className={`w-[1000px] max-w-[80vw] rounded-2xl px-4 py-3 transition-all duration-200 ${
									message.type === 'user'
										? 'bg-blue-600 text-white'
										: 'bg-white border border-gray-200 text-gray-900 shadow-sm'
								}`}>
									{message.content}
								</div>

								{/* Attached Files */}
								{message.files && message.files.length > 0 && (
									<div className="mt-2 space-y-1 w-[1000px] max-w-[80vw]">
										{message.files.map((file, idx) => (
											<div key={idx} className={`text-xs px-3 py-1 rounded-full ${
												message.type === 'user'
													? 'bg-blue-500 text-blue-100'
													: 'bg-gray-100 text-gray-600'
											}`}>
												📎 {file.name}
											</div>
										))}
									</div>
								)}

								{/* Annotated PDF Download Link */}
								{message.annotatedPdf && (
									<div className="mt-4 w-[1000px] max-w-[80vw]">
										<a
											href={URL.createObjectURL(message.annotatedPdf.blob)}
											download={message.annotatedPdf.filename}
											className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
										>
											📄 Download Annotated PDF: {message.annotatedPdf.filename}
										</a>
									</div>
								)}

								{/* Results */}
								{message.results && message.results.length > 0 && (
									<div className="mt-4 space-y-3 w-[1000px] max-w-[80vw]">
										{message.results.map((result, idx) => (
											<div key={idx} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow duration-200">
												<div className="flex items-start justify-between mb-2">
													<span className="text-sm font-medium text-gray-900">{result.file}</span>
													<span className={`text-xs px-2 py-1 rounded-full ${
														result.match.status === 'EXACT' ? 'bg-green-100 text-green-800' :
														result.match.status === 'CLOSE' ? 'bg-yellow-100 text-yellow-800' :
														'bg-red-100 text-red-800'
													}`}>
														{result.match.status}
													</span>
												</div>
												{formatAddress(result.parsed)}
												<div className="mt-2 text-xs text-gray-500">
													Scores: Name {result.match.scores.name.toFixed(1)}, Address {result.match.scores.address.toFixed(1)}
												</div>
												<div className="mt-1 text-xs text-gray-600">{result.match.explanation}</div>
											</div>
										))}
									</div>
								)}

								{/* Timestamp */}
								<div 
									className={`text-xs mt-1 w-[1000px] max-w-[80vw] ${message.type === 'user' ? 'text-right text-blue-200' : 'text-left text-gray-500'}`}
									suppressHydrationWarning
								>
									{message.timestamp.toLocaleTimeString()}
								</div>
							</div>
						</div>
					))}

					{/* Processing Indicator */}
					{isProcessing && (
						<div className="flex justify-center">
							<div className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 max-w-2xl">
								<div className="flex items-center space-x-2">
									<div className="flex space-x-1">
										<div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
										<div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
										<div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
									</div>
									<span className="text-sm text-gray-600">Processing your data...</span>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Input Area */}
			<div className="border-t border-gray-200 bg-white px-6 py-4">
				<div className="mx-auto w-full max-w-[90vw]">
					<form onSubmit={handleSubmit}>
						{/* File Attachments */}
						{attachedFiles.length > 0 && (
							<div className="mb-3 flex flex-wrap gap-2">
								{attachedFiles.map((file, idx) => (
									<div key={idx} className="flex items-center bg-gray-100 rounded-lg px-3 py-1">
										<span className="text-sm text-gray-700 mr-2">📎 {file.name}</span>
										<button
											type="button"
											onClick={() => removeFile(idx)}
											className="text-gray-500 hover:text-gray-700"
										>
											×
										</button>
									</div>
								))}
							</div>
						)}

						{/* Drag and Drop Zone */}
						<div
							className={`relative border-2 border-dashed rounded-xl p-4 transition-all duration-200 ${
								isDragOver
									? 'border-blue-400 bg-blue-50 shadow-lg scale-[1.01]'
									: 'border-gray-300 hover:border-gray-400 hover:shadow-sm'
							}`}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
						>
							<div className="flex items-end space-x-3">
								{/* Text Input */}
								<div className="flex-1">
									<textarea
										ref={textareaRef}
										value={inputText}
										onChange={(e) => setInputText(e.target.value)}
										placeholder="Paste text containing addresses or drop files here..."
										className="w-full resize-none border-0 bg-transparent outline-none placeholder-gray-400 text-gray-900"
										rows={1}
										onKeyDown={(e) => {
											if (e.key === 'Enter' && !e.shiftKey) {
												e.preventDefault();
												handleSubmit(e as any);
											}
										}}
										style={{
											minHeight: '24px',
											maxHeight: '120px',
											height: 'auto',
											overflow: textareaRef.current && textareaRef.current.scrollHeight > 120 ? 'auto' : 'hidden'
										}}
										onInput={(e) => {
											const target = e.target as HTMLTextAreaElement;
											target.style.height = 'auto';
											target.style.height = Math.min(target.scrollHeight, 120) + 'px';
										}}
									/>
								</div>

								{/* Action Buttons */}
								<div className="flex items-center space-x-2">
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-200"
										title="Attach files"
									>
										📎
									</button>
									<button
										type="submit"
										disabled={(!inputText.trim() && attachedFiles.length === 0) || isProcessing}
										className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 transition-all duration-200 hover:shadow-sm active:scale-95"
									>
										{isProcessing ? 'Processing...' : 'Send'}
									</button>
								</div>
							</div>

							{/* Hidden File Input */}
							<input
								ref={fileInputRef}
								type="file"
								multiple
								accept=".pdf,.eml,.msg,.txt"
								onChange={handleFileSelect}
								className="hidden"
							/>
						</div>

						{/* Help Text */}
						<div className="mt-2 text-xs text-gray-500 text-center">
							Supports PDF, EML, MSG, and TXT files • Press Enter to send, Shift+Enter for new line
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
