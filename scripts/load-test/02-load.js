// Load test — simulates 50 users hitting the dashboard during a typical
// agency morning. Each VU does the things a real employee does: log in,
// load dashboard, refresh tasks, occasionally schedule a meeting.

import { sleep, group } from 'k6';
import http from 'k6/http';
import { BASE_URL, login, authedHeaders } from './_helpers.js';

export const options = {
  // Ramp 0 → 50 over 30s, hold 50 for 4 min, ramp down 30s
  stages: [
    { duration: '30s', target: 50 },
    { duration: '4m',  target: 50 },
    { duration: '30s', target: 0  },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<800'],
    'http_req_failed':   ['rate<0.01'],
  },
};

export default function () {
  const token = login();
  const h = authedHeaders(token);

  group('dashboard burst', () => {
    http.get(`${BASE_URL}/api/dashboard/employee`, h);
    http.get(`${BASE_URL}/api/auth/me`,            h);
    http.get(`${BASE_URL}/api/tasks`,              h);
    http.get(`${BASE_URL}/api/meetings/mine`,      h);
    http.get(`${BASE_URL}/api/notifications`,      h);
    sleep(1);
  });

  group('check ad reports', () => {
    // Many ads-team members will load this once on dashboard mount
    http.get(`${BASE_URL}/api/ads/meta/today`, h);
    sleep(2);
  });

  group('heartbeat tick', () => {
    http.post(`${BASE_URL}/api/sessions/heartbeat`, null, h);
    sleep(5);  // real client heartbeats every 60s — we cheat to keep the test short
  });
}
