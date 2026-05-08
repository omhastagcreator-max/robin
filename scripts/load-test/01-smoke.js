// Smoke test — 1 VU, 30 seconds. Just verifies that login + dashboard fetch
// + tasks list all return 200 with reasonable latency. If this fails,
// nothing else will.

import { sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, login, authedHeaders } from './_helpers.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    'http_req_duration': ['p(95)<1500'],   // tolerate Render cold start
    'http_req_failed':   ['rate<0.05'],
  },
};

export default function () {
  const token = login();
  const h = authedHeaders(token);

  http.get(`${BASE_URL}/api/dashboard/employee`, h);
  http.get(`${BASE_URL}/api/tasks`, h);
  http.get(`${BASE_URL}/api/meetings/mine`, h);

  sleep(2);  // think time between iterations
}
