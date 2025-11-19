# Debugging PDF Block Extraction

This guide explains how to confirm what blocks are being found in PDFs.

## Viewing Logs

Logs are written to the console where your Next.js server is running. To see detailed block information:

1. **Start your Next.js server** (if not already running):
   ```bash
   cd location-recon
   npm run dev
   ```

2. **Set log level to 'info' or 'debug'** (if needed):
   - Set environment variable: `LOG_LEVEL=info` or `LOG_LEVEL=debug`
   - Or edit `.env` file: `LOG_LEVEL=info`

3. **Upload a PDF** through the web interface

4. **Check the server console** for detailed logs showing:
   - All extracted blocks from the PDF
   - Which blocks are being processed
   - Which blocks have search keys or warnings
   - Which blocks are being added to PDF annotation
   - Which blocks are found/not found in the PDF

## Key Log Messages to Look For

### 1. Extracted Blocks from File
```
[INFO] Extracted blocks from file
```
This shows:
- `blocksCount`: Total number of blocks found
- `blocks`: Array of all extracted blocks with:
  - `index`: Block number
  - `preview`: First 200 characters
  - `fullBlock`: Complete block text
  - `lineCount`: Number of lines in the block

### 2. Adding Block to PDF Annotation
```
[INFO] Adding block to PDF annotation
```
This shows:
- `block`: Full block text
- `blockPreview`: First 150 characters
- `searchKey`: The search key assigned (if found)
- `warningMessage`: Warning message (if applicable)
- `matchStatus`: EXACT, CLOSE, or NEW
- `parsedName`: Normalized facility name
- `parsedAddress`: Normalized address

### 3. Skipping Block
```
[INFO] Skipping block (no searchKey or warningMessage)
```
This shows blocks that were extracted but don't have search keys or warnings to annotate.

### 4. PDF Annotation Process
```
[INFO] Starting PDF annotation
```
This shows all blocks being sent to the annotation function.

### 5. Block Position Finding
```
[INFO] Processing block for annotation
[DEBUG] Found block position via text matching
[DEBUG] Block position not found via text matching, trying fallback
[WARN] Could not find block in extracted text, skipping annotation
```

## Example Log Output

When you upload a PDF, you should see logs like:

```
[INFO] Extracted blocks from file {
  fileName: 'example.pdf',
  isPdf: true,
  blocksCount: 5,
  blocks: [
    {
      index: 1,
      preview: 'Rio Grande Regional Hospital\n101 E. Ridge Road\nMcAllen, Texas 78503...',
      fullBlock: 'Rio Grande Regional Hospital\n101 E. Ridge Road\nMcAllen, Texas 78503\nP: (956) 632-6000\n07/13/23 to Present – Radiology Records',
      lineCount: 5
    },
    ...
  ]
}

[INFO] Adding block to PDF annotation {
  blockIndex: 1,
  totalBlocks: 5,
  block: 'Rio Grande Regional Hospital\n101 E. Ridge Road\nMcAllen, Texas 78503...',
  searchKey: 'RIO_GRANDE_REGIONAL_HOSPITAL_MCALLEN_TX_78503',
  matchStatus: 'EXACT',
  parsedName: 'Rio Grande Regional Hospital',
  parsedAddress: '101 E. Ridge Road, McAllen, Texas 78503'
}
```

## Troubleshooting

### No blocks found?
- Check `PDF text preview` log to see if text was extracted from the PDF
- Verify the PDF contains readable text (not just images)
- Check if `hasAddresses`, `hasHospital`, etc. patterns match

### Blocks found but not annotated?
- Check if blocks have `searchKey` or `warningMessage`
- Look for `Skipping block (no searchKey or warningMessage)` messages
- Verify blocks are being matched in the database

### Blocks not found in PDF for positioning?
- Check `Block position not found via text matching` messages
- The system will fall back to simple annotation method if positions can't be found
- Simple method still adds annotations, just with estimated positions

## Filtering Logs

To see only block-related logs, you can filter the console output:
- In terminal: `npm run dev | grep -i "block\|annotation"`
- Or use a log viewer that supports filtering

