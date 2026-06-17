import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    upload_candidate_50: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      thresholds: {
        'http_req_duration{endpoint:upload_candidate}': ['p(99)<1000'],
      },
    },
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const HUNTER_KEY = __ENV.HUNTER_KEY;
const CANDIDATE_ID = __ENV.CANDIDATE_ID;

export default function () {
  const res = http.post(
    `${BASE}/v1/headhunter/candidates`,
    JSON.stringify({
      candidate_user_id: CANDIDATE_ID,
      name: 'Load Test',
      phone: '13800000000',
      email: `load${__VU}_${__ITER}@x.com`,
      current_company: '字节跳动',
      current_title: '工程师',
      expected_salary: 500000,
      years_experience: 5,
      education_school: '清华',
      skills: ['JS'],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HUNTER_KEY}`,
      },
      tags: { endpoint: 'upload_candidate' },
    }
  );
  check(res, { 'status 200': (r) => r.status === 200 });
}
