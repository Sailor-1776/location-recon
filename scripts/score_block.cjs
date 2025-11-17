/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const fuzzball = require('fuzzball');

function normalizeWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function removePunctuation(s) {
  return String(s || '').replace(/[.,]/g, ' ');
}

function normalizeUnit(s) {
  const m = String(s || '').match(/\b(?:suite|ste|unit)\b\s*([a-z0-9-]+)|#\s*([a-z0-9-]+)/i);
  if (!m) return { line: s, unit: undefined };
  const unit = m[1] || m[2];
  let line = s.replace(m[0], '').trim();
  line = line.replace(/,$/, '');
  line = normalizeWhitespace(line);
  return { line, unit };
}

function extractCityStateZip(line) {
  const m = String(line || '').match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
  if (!m) return null;
  return { city: m[1].trim(), state: m[2].toUpperCase(), postal_code: m[3] };
}

function expandAbbrev(s) {
  const map = {
    st: 'street',
    ave: 'avenue',
    av: 'avenue',
    rd: 'road',
    ln: 'lane',
    blvd: 'boulevard',
    hwy: 'highway',
    pkwy: 'parkway',
    ct: 'court',
    dr: 'drive',
    unit: 'suite',
    ste: 'suite',
    texas: 'tx',
    n: 'north',
    s: 'south',
    e: 'east',
    w: 'west',
    ne: 'northeast',
    nw: 'northwest',
    se: 'southeast',
    sw: 'southwest',
  };
  return String(s || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(suite|ste|unit)\s+(\d+)[- ]?[a-z]\b/gi, 'suite $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => map[t] || t)
    .join(' ');
}

function fullAddressString(a) {
  const zip5 = (a.postal_code || '').toString().slice(0, 5);
  return [a.address1, a.address2 || '', a.city, a.state, zip5]
    .map((x) => (x || '').toString().trim())
    .filter(Boolean)
    .join(' ');
}
function fullDbAddressString(r) {
  const zip5 = (r.postal_code || '').toString().slice(0, 5);
  return [r.address1, r.address2 || '', r.city, r.state, zip5]
    .map((x) => (x || '').toString().trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeBlock(block) {
  const lines = String(block || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let name;
  let address1 = '';
  let address2;
  let city = '';
  let state = '';
  let postal_code = '';

  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = extractCityStateZip(lines[i]);
    if (parsed) {
      city = parsed.city;
      state = parsed.state;
      postal_code = parsed.postal_code;
      const addrLine = lines[i - 1] || '';
      const { line, unit } = normalizeUnit(addrLine);
      address1 = line;
      if (unit) address2 = `suite ${unit}`;
      const possibleName = lines[i - 2] || '';
      if (possibleName && !/\d/.test(possibleName)) {
        name = possibleName;
      }
      break;
    }
  }
  if (!address1) {
    const addrLine = lines.find((l) => /\d/.test(l)) || '';
    const { line, unit } = normalizeUnit(addrLine);
    address1 = line;
    if (unit) address2 = `suite ${unit}`;
  }
  if (!name) {
    name = lines.find((l) => !/\d/.test(l));
  }
  let addr1 = String(address1 || '').toLowerCase();
  addr1 = removePunctuation(addr1);
  addr1 = expandAbbrev(addr1);
  addr1 = addr1.replace(/\bpo\s*box\b/i, 'po box');
  addr1 = normalizeWhitespace(addr1);
  const addr2 = address2 ? `suite ${String(address2).replace(/^suite\s*/i, '')}` : undefined;
  return {
    name: name ? String(name).trim() : undefined,
    address1: addr1,
    address2: addr2 ? addr2.toLowerCase() : undefined,
    city,
    state: String(state || '').toUpperCase(),
    postal_code: String(postal_code || '').slice(0, 5),
    country: 'US',
  };
}

function computeScores(doc, db) {
  const nameA = (doc.name || '').toString();
  const nameB = db.name || '';
  const name = fuzzball.token_sort_ratio(nameA, nameB);
  const addrA = expandAbbrev(fullAddressString(doc));
  const addrB = expandAbbrev(fullDbAddressString(db));
  const address = fuzzball.token_set_ratio(addrA, addrB);
  return { name, address, geodistance_m: null };
}

async function main() {
  const csvPath =
    process.env.LOCATIONS_CSV_PATH ||
    path.join(process.cwd(), 'data', 'locations.sample.csv');
  const blockMode = String(process.env.BLOCK_MODE || 'zip').toLowerCase(); // 'zip' | 'citystate' | 'state' | 'none'
  const topN = Number(process.env.TOP_N || 5);
  const input = fs.readFileSync(0, 'utf8');
  const doc = normalizeBlock(input);

  const hasZip = !!doc.postal_code;
  const wantZip = doc.postal_code.slice(0, 5);
  const wantCity = (doc.city || '').toLowerCase();
  const wantState = doc.state;

  // Maintain top-N by combined score
  const top = [];
  const consider = (rec, scores) => {
    const combined = scores.name + scores.address;
    top.push({ rec, scores, combined });
    top.sort((a, b) => b.combined - a.combined);
    if (top.length > topN) top.length = topN;
  };

  const parser = parse({ columns: true, skip_empty_lines: true, relax_quotes: true });
  const STATE_TO_ABBR = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
    connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
    illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
    mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
    pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
    tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
    washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
    'district of columbia': 'DC', 'washington dc': 'DC', 'dc': 'DC'
  };
  const normalizeStateAbbr = (s) => {
    const v = String(s || '').trim();
    if (!v) return '';
    if (v.length === 2) return v.toUpperCase();
    const m = STATE_TO_ABBR[v.toLowerCase()];
    return m ? m : v.toUpperCase();
  };
  const select = (rec, keys) => {
    const dict = {};
    for (const k of Object.keys(rec || {})) {
      dict[String(k).toLowerCase().trim()] = k;
    }
    for (const cand of keys) {
      const kk = dict[cand];
      if (kk && rec[kk] != null && String(rec[kk]).trim() !== '') return rec[kk];
    }
    return undefined;
  };
  const normalizeRec = (rec) => {
    return {
      id: select(rec, ['id', 'mr8_id', 'mr8id', 'location_id', 'loc no.', 'loc no']),
      search_key: select(rec, ['search key', 'search_key']),
      name: select(rec, ['name', 'facility_name', 'location_name', 'location', 'location name']),
      address1: select(rec, ['address1', 'address_1', 'street1', 'addr1', 'address line 1', 'address', 'street address']),
      address2: select(rec, ['address2', 'address_2', 'street2', 'addr2', 'address line 2', 'suite', 'unit']),
      city: select(rec, ['city', 'town', 'municipality', 'city/town']),
      state: select(rec, ['state', 'st', 'province', 'state_province', 'state/province']),
      postal_code: select(rec, ['postal_code', 'zip', 'zipcode', 'zip_code', 'postal', 'postalcode', 'post code', 'zip code', 'postal code']),
    };
  };
  parser.on('readable', () => {
    let record;
    while ((record = parser.read()) !== null) {
      const r = normalizeRec(record);
      const zip5 = String(r.postal_code || '').slice(0, 5);
      const city = String(r.city || '').toLowerCase();
      const state = normalizeStateAbbr(r.state);
      let match = false;
      if (blockMode === 'zip') {
        match = hasZip ? zip5 === wantZip : city === wantCity && state === wantState;
      } else if (blockMode === 'citystate') {
        match = city === wantCity && state === wantState;
      } else if (blockMode === 'state') {
        match = state === wantState;
      } else {
        match = true;
      }
      if (!match) continue;
      const scores = computeScores(doc, {
        name: r.name,
        address1: r.address1,
        address2: r.address2,
        city: r.city,
        state: r.state,
        postal_code: r.postal_code,
      });
      consider(
        {
          id: r.id,
          search_key: r.search_key,
          name: r.name,
          address1: r.address1,
          address2: r.address2,
          city: r.city,
          state: r.state,
          postal_code: r.postal_code,
        },
        scores,
      );
    }
  });
  await new Promise((resolve, reject) => {
    parser.on('error', reject);
    parser.on('end', resolve);
    fs.createReadStream(csvPath).pipe(parser);
  });

  const out = {
    parsed: doc,
    block_mode: blockMode,
    top_n: topN,
    candidates: top.map((t) => ({
      id: t.rec.id || null,
      search_key: t.rec.search_key || null,
      name: t.rec.name,
      address1: t.rec.address1,
      address2: t.rec.address2 || '',
      city: t.rec.city,
      state: t.rec.state,
      postal_code: t.rec.postal_code,
      scores: t.scores,
      combined: t.combined,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


