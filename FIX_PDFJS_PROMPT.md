# Fix pdfjs-dist Loading in Next.js - Single Robust Method

## Problem
pdfjs-dist is failing to load in Next.js server environment, causing PDF annotation to fall back to inaccurate text-based positioning. The current implementation has multiple fallback layers (dynamic import → require → null) which is fragile and unreliable.

## Root Cause
pdfjs-dist is externalized in Next.js webpack config (`serverExternalPackages`), meaning it's not bundled and must be resolved at runtime. The dynamic import approach fails because:
1. Next.js externals require CommonJS `require()` at runtime
2. Dynamic imports with `new Function()` may not work correctly with externals
3. The fallback chain adds complexity and failure points

## Solution
Replace the multi-fallback approach with a single robust method that works with Next.js externals:

1. **Use `createRequire` directly** - Since pdfjs-dist is externalized as CommonJS, use `require()` as the primary method
2. **Add proper error logging** - Log the actual error to understand why it fails
3. **Remove fallback complexity** - If pdfjs-dist fails to load, fail fast with a clear error rather than silently degrading
4. **Ensure proper module resolution** - Make sure the path resolves correctly in Next.js server context

## Implementation Steps

1. **Update `getPdfjsLib()` in `src/ingest/pdfAnnotator.ts`**:
   - Remove the dynamic import attempt
   - Use `createRequire(import.meta.url)` as the primary method
   - Add detailed error logging to capture the actual failure reason
   - Throw a descriptive error if loading fails (don't return null silently)

2. **Update `extractTextWithPositions()`**:
   - Remove the null check fallback
   - Let errors propagate with clear messages
   - Ensure errors are logged with full context

3. **Update `annotatePdfWithSearchKeysImproved()`**:
   - Remove the fallback to simple method when pdfjs-dist fails
   - If pdfjs-dist is required for accurate positioning, fail with a clear error
   - OR: If we want graceful degradation, make it explicit and well-documented

4. **Verify Next.js config**:
   - Ensure `pdfjs-dist` is properly listed in `serverExternalPackages`
   - Verify the webpack external configuration is correct
   - Test that the module resolves correctly at runtime

5. **Add runtime verification**:
   - Add a check at module load time to verify pdfjs-dist can be imported
   - Log success/failure clearly
   - Consider adding a health check endpoint

## Expected Outcome
- pdfjs-dist loads reliably in Next.js server environment
- Clear error messages if it fails (instead of silent degradation)
- Single code path (no complex fallback chains)
- Accurate PDF annotation with proper text positioning

## Testing
- Test PDF annotation with pdfjs-dist working
- Verify error messages are clear if pdfjs-dist fails to load
- Ensure no silent failures or degraded behavior

