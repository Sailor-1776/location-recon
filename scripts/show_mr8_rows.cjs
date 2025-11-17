/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

async function main() {
  const csvPath =
    process.env.LOCATIONS_CSV_PATH ||
    path.join(process.cwd(), 'data', 'mr8_locations.csv');
  const ids = process.argv.slice(2).map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) {
    console.error('Usage: node scripts/show_mr8_rows.cjs <LocNo...>');
    process.exit(2);
  }
  const want = new Set(ids);
  const found = new Map();

  const normalizeKey = (k) => String(k || '').toLowerCase().trim();
  const getLocNo = (rec) => {
    // Find a column matching "Loc No." (case/period-insensitive)
    let locNoKey = null;
    for (const k of Object.keys(rec)) {
      const nk = normalizeKey(k);
      if (nk === 'loc no.' || nk === 'loc no' || nk === 'locno' || nk === 'loc number') {
        locNoKey = k;
        break;
      }
    }
    if (!locNoKey) return undefined;
    return String(rec[locNoKey] ?? '').trim();
  };

  await new Promise((resolve, reject) => {
    const parser = parse({ columns: true, skip_empty_lines: true, relax_quotes: true });
    parser.on('readable', () => {
      let rec;
      while ((rec = parser.read()) !== null) {
        const locNo = getLocNo(rec);
        if (locNo && want.has(locNo) && !found.has(locNo)) {
          found.set(locNo, rec);
          if (found.size === want.size) {
            // We could end early; just continue piping to finish.
          }
        }
      }
    });
    parser.on('error', reject);
    parser.on('end', resolve);
    fs.createReadStream(csvPath).pipe(parser);
  });

  // Output in the same order as provided
  const out = ids.map((id) => ({
    loc_no: id,
    row: found.get(id) || null,
  }));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


