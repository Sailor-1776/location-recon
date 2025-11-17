/* eslint-disable @next/next/no-img-element */
'use client';
import React from 'react';

type Result = {
	file: string;
	block: string;
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
};

export default function Upload() {
	const [results, setResults] = React.useState<Result[]>([]);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		const form = e.currentTarget;
		const data = new FormData(form);
		try {
			const res = await fetch('/api/reconcile', { method: 'POST', body: data });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = await res.json();
			setResults(json.results);
		} catch (err: any) {
			setError(err?.message || 'Upload failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div>
			<form onSubmit={onSubmit} className="border rounded p-4 bg-white flex gap-2 items-center">
				<input type="file" name="files" multiple accept=".pdf,.eml,.msg,.txt" className="border p-2" />
				<button
					type="submit"
					disabled={loading}
					className="bg-blue-600 disabled:opacity-60 text-white px-4 py-2 rounded"
				>
					{loading ? 'Processing…' : 'Process'}
				</button>
			</form>
			{error && <p className="text-red-600 mt-2">{error}</p>}

			{results.length > 0 && (
				<div className="mt-6">
					<table className="w-full text-left border bg-white">
						<thead>
							<tr className="border-b bg-gray-50">
								<th className="p-2">File</th>
								<th className="p-2">Parsed</th>
								<th className="p-2">Status</th>
								<th className="p-2">Scores</th>
								<th className="p-2">Explanation</th>
							</tr>
						</thead>
						<tbody>
							{results.map((r, i) => (
								<tr className="border-b" key={i}>
									<td className="p-2">{r.file}</td>
									<td className="p-2 text-sm">
										<div className="font-medium">{r.parsed.name}</div>
										<div>
											{r.parsed.address1} {r.parsed.address2 ? `, ${r.parsed.address2}` : ''}
										</div>
										<div>
											{r.parsed.city}, {r.parsed.state} {r.parsed.postal_code}
										</div>
									</td>
									<td className="p-2">{r.match.status}</td>
									<td className="p-2 text-sm">
										name {r.match.scores.name.toFixed(1)}; addr {r.match.scores.address.toFixed(1)}
									</td>
									<td className="p-2 text-sm">{r.match.explanation}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}


