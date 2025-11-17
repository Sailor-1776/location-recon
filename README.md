Location Reconciliation Tool (MR8)
==================================

Production-quality tool to ingest documents (PDF/EML/MSG/Text), extract and normalize addresses and organization names, and reconcile them against MR8 “Setup → Locations”. Deterministic first; LLM only assists in ambiguous gray zones. Includes a CLI and a minimal review UI (Next.js).

Quick start
-----------

Prereqs: Node 20.x, pnpm or npm.

1) Install

```bash
pnpm i
```

2) Configure env

Copy `.env.example` to `.env` and adjust as needed. By default, CSV backend is used with `data/locations.sample.csv`.

3) Run tests

```bash
pnpm lint
pnpm test
```

4) CLI

```bash
# Process a directory of files and emit JSONL; write NEW to CSV
pnpm cli -- --input data/fixtures/texts --format jsonl --save-csv new_locs.csv

# Read from stdin
cat data/fixtures/texts/hospital_1.txt | pnpm cli -- --input - --format jsonl
```

5) Review UI (minimal)

```bash
# Dev server on http://localhost:3000
pnpm ui:dev
```

Environment
-----------

See `.env.example`. Key variables:

- `MR8_DRIVER=sqlserver|odbc|csv` (default csv)
- SQL Server (mssql): `SQLSERVER_HOST, SQLSERVER_PORT, SQLSERVER_DATABASE, SQLSERVER_USERNAME, SQLSERVER_PASSWORD`
- ODBC: `ODBC_DSN, ODBC_UID, ODBC_PWD`
- CSV fallback: `LOCATIONS_CSV_PATH` (default `data/locations.sample.csv`)
- `LOG_LEVEL=info` controls log verbosity

Data model
----------

`LocationRecord`:

```ts
{
  id: string | number | null
  name: string
  address1: string
  address2?: string | null
  city: string
  state: string
  postal_code: string
  country?: string // default "US"
  latitude?: number | null
  longitude?: number | null
}
```

Deterministic matching policy
-----------------------------

- Blocking: same `postal_code` OR same `city`+`state`
- Scoring:
  - `nameScore = Levenshtein normalizedSimilarity(tokenSort(nameA), tokenSort(nameB)) * 100`
  - `addrScore = Levenshtein normalizedSimilarity(tokenSet(fullAddressA), tokenSet(fullAddressB)) * 100`
  - If both have lat/lon, compute `geodistanceM` (haversine)
- Decision thresholds:
  - EXACT if `addrScore ≥ 95` AND `nameScore ≥ 94`
  - CLOSE if (`addrScore ≥ 92` AND `nameScore ≥ 90`) OR (`geodistanceM ≤ 100`)
  - else NEW

Privacy and redaction
---------------------

- Logs never contain full PII. Addresses are hashed and ZIP codes masked to 5 digits. See `src/utils/redact.ts`.
- Never write to MR8; DB access is read-only. NEW items are exported to CSV.

Backends and dependencies
-------------------------

- Preferred address normalization: `node-postal` (libpostal). If not available, fallback to a robust ruleset.
- PDF text via `pdf-parse`. If low density and OCR available, `tesseract.js`. If neither are present, we degrade gracefully and return empty or partial text without failing tests.
- SQL Server via `mssql` (tedious); ODBC via `odbc`. If not configured, CSV backend is used.

Windows notes (SQL Server and ODBC)
-----------------------------------

- SQL Server: ensure TCP/IP enabled and firewall allows `SQLSERVER_PORT` (default 1433). Use `encrypt: true` in production.
- ODBC DSN: install MS ODBC Driver 18 or later. Create a System DSN and set `ODBC_DSN`. Provide `ODBC_UID` and `ODBC_PWD`.

Scripts
-------

```json
{
  "dev": "tsx watch src/index.ts",
  "cli": "tsx src/cli/reconcile.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "test": "vitest run",
  "lint": "eslint . --ext .ts",
  "format": "prettier -w .",
  "ui:dev": "next dev src/server/next"
}
```

CI
--

```bash
pnpm i && pnpm lint && pnpm test
```

Project layout
--------------

See repository tree. Core logic under `src/` is shared by CLI and UI.



