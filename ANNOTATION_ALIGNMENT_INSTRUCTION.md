# Annotation Y-Axis Alignment Instruction

## Core Requirement
**Annotations must be placed on the same y-axis (vertical position) as the facility name, which is always the top line of each text block.**

## Key Rules

1. **Primary Target**: Always use the Y coordinate from the facility name line (first line of block) for annotation placement
2. **Alignment Method**: Match `blockLines[0]` (facility name) first; only fall back to `blockLines[1]` (address) if facility name match fails
3. **Y-Coordinate Source**: Even when using address line for page/block identification, prioritize using the facility name line's Y coordinate for vertical positioning
4. **Visual Result**: Annotations should appear horizontally aligned with the facility name text, not with address lines or other content

## Implementation Note
When `findAnchor` finds a match, ensure the returned `line.y` value corresponds to the facility name's vertical position, not the address line's position, even if the address line had a higher similarity score.

