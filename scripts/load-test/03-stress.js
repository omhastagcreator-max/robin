// Stress test — climb until something breaks. Ramps from 0 → 300 VUs over
// 8 minutes. Watch the k6 console for the moment p95 latency or error
// rate spikes. That's your current ceiling.
//
// On Render free tier expect this to start hurting around 100–150 VUs
// (CPU caps + cold-start churn). On a paid Starter ($7) plan it should
// hold past 300.

import { sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, login, authedHeaders } from './_helpers.js';

export const options = {
  stages: [
    { duration: '1m', target: 50  },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 300 },
    { duration: '1m', target: 0   },
  ],
  thresholds: {
    // Looser bar than load test — we EXPECT this to start failing.
    // Setting them lets k6 print pass/fail at the end without killing the run.
    'http_req_failed': ['rate<0.10'],
  },
};

// One shared token per VU, refreshed every iteration just to keep
// the auth flow in the test (otherwise we're only stressing one endpoint).
export default function () {
  const token = login();
  const h = authedHeaders(token);

  http.get(`${BASE_URL}/api/dashboard/employee`, h);
  http.get(`${BASE_URL}/api/tasks`,              h);
  http.get(`${BASE_URL}/api/meetings/mine`,      h);

  sleep(1);
}
