// Spike test — sudden burst from 0 → 200 VUs in 10 seconds, hold for 1 min,
// then drop to 0. Simulates a viral signup wave or "everyone clicks the
// dashboard at 9am" Monday morning effect.
//
// What we want: response times spike, but the service stays up and recovers
// once the burst ends. If 5xx rate spikes and stays high after the burst,
// you have a connection-pool leak or a stuck queue.

import { sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, login, authedHeaders } from './_helpers.js';

export const options = {
  stages: [
    { duration: '10s', target: 200 },
    { duration: '1m',  target: 200 },
    { duration: '20s', target: 0   },
    { duration: '40s', target: 0   },  // recovery window — watch metrics here
  ],
};

export default function () {
  const token = login();
  const h = authedHeaders(token);

  http.get(`${BASE_URL}/api/auth/me`,            h);
  http.get(`${BASE_URL}/api/dashboard/employee`, h);

  sleep(1);
}
