import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    burst_1s: {
      executor: 'constant-arrival-rate',
      rate: 200, // far above the 1s bucket limit (headhunter=20)
      timeUnit: '1s',
      duration: '5s',
      preAllocatedVUs: 5,
    },
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY;

export default function () {
  const res = http.get(`${BASE}/v1/users/me/status`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    '429 returned': (r) => r.status === 429,
  });
}
