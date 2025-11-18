# PDF Annotation Y-Axis Alignment Prompt

## Objective
Ensure that PDF annotations are placed on the same y-axis plane as their corresponding text blocks, with precise alignment to the facility name (the top line of each text block).

## Critical Requirement
**Annotations MUST align with the facility name line (first line of the text block), not with any other line in the block.**

## Current Problem
The `findAnchor` function in `pdfAnnotator.ts` searches for both the first line (facility name) and second line (address) of a block, and selects whichever has the highest similarity score. This can result in annotations being placed at the wrong vertical position if the address line matches better than the facility name line.

## Solution: Prioritize Facility Name Line

### Primary Matching Strategy
1. **First Priority**: Always attempt to match the facility name (first line of the block) first
2. **Fallback Only**: Only use the second line (address) if the facility name cannot be found with sufficient confidence
3. **Y-Coordinate Source**: The Y coordinate used for annotation placement MUST come from the facility name line match, not from any other line

### Implementation Guidelines

#### For the `findAnchor` function:
- Search for `blockLines[0]` (facility name) first with a minimum similarity threshold
- Only if the facility name match fails (score < MIN_SIMILARITY), then search for `blockLines[1]` (address)
- When returning the anchor, ensure the Y coordinate corresponds to the facility name line, even if the address line was used for page/block identification
- If both lines match but you need to choose, prioritize the facility name line's Y coordinate

#### For the `preparePlacements` function:
- When an anchor is found, verify that the Y coordinate (`anchor.line.y`) corresponds to the facility name line
- If the anchor was found via the address line but you have access to the facility name line's Y coordinate, use the facility name Y coordinate instead
- The annotation text should visually align with the top of the text block (facility name), creating a horizontal alignment

### Visual Alignment Rules
1. **Baseline Alignment**: The annotation's baseline should align with the facility name's baseline
2. **Top-Line Priority**: Even if multiple lines in a block match, always use the Y coordinate of the top line (facility name)
3. **Consistent Positioning**: All annotations for facility blocks should follow the same alignment rule for visual consistency

### Edge Cases to Handle
- **Single-line blocks**: If a block only has one line, that line is the facility name
- **Multi-line facility names**: If the facility name spans multiple lines, use the Y coordinate of the first line
- **Missing facility name**: If the first line is empty or doesn't match, fall back to the second line but log a warning
- **No Y coordinate available**: If positional data is unavailable, calculate Y based on line index, ensuring it represents the top of the block

### Code Modification Approach

```typescript
// Pseudo-code for improved findAnchor:
function findAnchor(block: string, pageLines: PageLines) {
  const blockLines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (blockLines.length === 0) return null;
  
  const facilityName = blockLines[0];
  const addressLine = blockLines[1];
  
  // PRIORITY 1: Find facility name match
  let facilityMatch = findBestMatch(facilityName, pageLines);
  
  if (facilityMatch && facilityMatch.score >= MIN_SIMILARITY) {
    // Use facility name Y coordinate - this is the correct alignment
    return {
      pageIndex: facilityMatch.pageIndex,
      lineIndex: facilityMatch.lineIndex,
      score: facilityMatch.score,
      line: facilityMatch.line, // This line's Y coordinate aligns with facility name
    };
  }
  
  // PRIORITY 2: Fallback to address line only if facility name fails
  if (addressLine) {
    let addressMatch = findBestMatch(addressLine, pageLines);
    if (addressMatch && addressMatch.score >= MIN_SIMILARITY) {
      // Even when using address match, try to find facility name on same page
      // and use facility name Y coordinate if available
      const facilityOnSamePage = findFacilityNameOnPage(
        facilityName, 
        pageLines[addressMatch.pageIndex]
      );
      
      if (facilityOnSamePage) {
        return {
          pageIndex: addressMatch.pageIndex,
          lineIndex: facilityOnSamePage.lineIndex,
          score: addressMatch.score, // Keep address match score for confidence
          line: facilityOnSamePage.line, // But use facility name Y coordinate
        };
      }
      
      // Last resort: use address line Y coordinate but log warning
      logger.warn('Using address line Y coordinate; facility name not found', {
        block: block.substring(0, 100),
      });
      return addressMatch;
    }
  }
  
  return null;
}
```

### Testing Criteria
- ✅ Annotations appear at the same vertical level as the facility name
- ✅ Annotations do not appear aligned with address lines or other block content
- ✅ Multiple annotations on the same page maintain consistent alignment relative to their facility names
- ✅ Visual inspection confirms annotations are horizontally aligned with the top line of each block

### Expected Outcome
When viewing the annotated PDF:
- Each annotation should appear to the right of its corresponding facility name
- The annotation text should be horizontally aligned (same Y coordinate) with the facility name text
- The annotation should not appear aligned with address lines, city/state/zip lines, or department lines
- All annotations should follow this consistent alignment pattern throughout the document

## Implementation Priority
**HIGH** - This alignment issue affects the visual clarity and usability of the annotated PDFs. Users expect annotations to clearly correspond to facility names, and misalignment creates confusion.

