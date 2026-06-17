import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    webhook_100_per_min: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1m',
      duration: '5m',
      preAllocatedVUs: 10,
      thresholds: {
        'http_req_duration{endpoint:webhook}': ['p(99)<2000'],
      },
    },
  },
};

const TARGET = __ENV.WEBHOOK_TARGET || 'http://localhost:9999/webhook';

export default function () {
  const res = http.post(
    TARGET,
    JSON.stringify({ type: 'test', vu: __VU, iter: __ITER }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Hunter-Signature': 'test',
        'X-Hunter-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Hunter-Event': 'test',
      },
      tags: { endpoint: 'webhook' },
    }
  );
  check(res, { 'status 200': (r) => r.status === 200 });
}
