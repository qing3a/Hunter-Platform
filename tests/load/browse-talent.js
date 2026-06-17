import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    browse_talent_500: {
      executor: 'constant-vus',
      vus: 500,
      duration: '30s',
      thresholds: {
        'http_req_duration{endpoint:browse_talent}': ['p(99)<200'],
        'http_req_failed': ['rate<0.01'],
      },
    },
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY;

export default function () {
  const res = http.get(`${BASE}/v1/employer/talent`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    tags: { endpoint: 'browse_talent' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'has data': (r) => Array.isArray(r.json('data')),
  });
  sleep(1);
}
