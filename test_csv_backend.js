import { getDAO } from './dist/match/locationsDAO.js';

async function test() {
  console.log('Testing CSV backend with Rio Grande Regional Hospital...');

  const dao = getDAO();
  const blockingKey = {
    city: 'McAllen',
    state: 'TX',
    postal_code: '78503'
  };

  console.log('Blocking key:', blockingKey);
  const candidates = await dao.findCandidates(blockingKey);
  console.log(`Found ${candidates.length} candidates`);

  const rioGrandeMatches = candidates.filter(c =>
    c.name.toLowerCase().includes('rio grande') &&
    c.city.toLowerCase() === 'mcallen' &&
    c.state === 'TX'
  );

  console.log(`Rio Grande matches: ${rioGrandeMatches.length}`);
  rioGrandeMatches.forEach((match, idx) => {
    console.log(`${idx + 1}. ${match.name} - ${match.department || 'no department'} - ${match.postal_code}`);
  });

  // Test exact matching
  const exactMatches = candidates.filter(c =>
    c.name.toLowerCase() === 'rio grande regional hospital' &&
    c.city.toLowerCase() === 'mcallen' &&
    c.state === 'TX'
  );

  console.log(`\nExact Rio Grande Regional Hospital matches: ${exactMatches.length}`);
  exactMatches.forEach((match, idx) => {
    console.log(`${idx + 1}. ${match.name} - ${match.department || 'no department'} - ${match.address1}`);
  });
}

test().catch(console.error);
