import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY;

export const options = {
  scenarios: {
    burst_1s: {
      executor: 'constant-arrival-rate',
      rate: 200, // far above the 1s bucket limit (headhunter=20)
      timeUnit: '1s',
      duration: '5s',
      preAllocatedVUs: 5,
    },
    recovery_after_429: {
      executor: 'constant-vus',
      vus: 1,
      duration: '70s',
      startTime: '10s',  // begin after burst
    },
  },
};

export default function () {
  const res = http.get(`${BASE}/v1/users/me/status`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has RateLimit-Remaining': (r) => r.headers['RateLimit-Remaining'] !== undefined,
    'has Retry-After on 429': (r) => r.status === 200 || r.headers['Retry-After'] !== undefined,
  });
  if (res.status === 429) sleep(1);
}
