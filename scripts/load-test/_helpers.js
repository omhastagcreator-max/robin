// Shared helpers used by every test. k6 doesn't have node_modules, so this
// is plain ES modules and one tiny file.

import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL      = __ENV.BASE_URL      || 'http://localhost:4002';
export const TEST_EMAIL    = __ENV.TEST_EMAIL    || '';
export const TEST_PASSWORD = __ENV.TEST_PASSWORD || '';

if (!TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error('Set TEST_EMAIL and TEST_PASSWORD env vars before running.');
}

/** Log in once and return the JWT. Cached per VU. */
export function login() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'login status 200': (r) => r.status === 200,
    'login returns token': (r) => !!r.json('token'),
  });
  return res.json('token');
}

/** Authed request headers. */
export function authedHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}
