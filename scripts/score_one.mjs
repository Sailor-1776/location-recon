import { normalizeAddress } from '../dist/normalize/address.js';
import { getDAO } from '../dist/match/locationsDAO.js';
import { reconcileOne } from '../dist/match/matcher.js';
import { loadConfig } from '../dist/config.js';

const input = `Northgate Open MRI
8801 N. 10th Street, Suite 150
McAllen, TX 78504
P: (956) 213-0270`;

const ca = normalizeAddress(input);
const dao = getDAO(loadConfig().mr8Driver);
const match = await reconcileOne(ca, dao);

console.log(
	JSON.stringify(
		{
			parsed: ca,
			status: match.status,
			scores: match.scores,
			candidate: match.record || null,
		},
		null,
		2,
	),
);


