# Robin load testing

Practical k6 scripts for stress-testing the Robin API. Use these to find the
breaking point of your current Render + MongoDB Atlas setup BEFORE real
traffic finds it for you.

## What you're testing
- Response time under load (p95 should stay under 500ms for dashboards)
- Error rate (5xx should stay near 0)
- MongoDB connection pool (Atlas free tier caps at 100 connections)
- Render free service throughput (spins down after inactivity — first
  request after a quiet period will look ugly)

## What you're NOT testing
- LiveKit huddle audio rooms — those are billed per participant-minute on
  the LiveKit side. Don't pump fake users into real rooms.
- Render's free tier spin-up — that's a known cold-start, not your code.

## Setup

```bash
# macOS
brew install k6

# Linux
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# Windows (with Chocolatey)
choco install k6
```

## Running the tests

All scripts read these env vars:

- `BASE_URL`         — API base, e.g. `https://robinrobin-api.onrender.com`
- `TEST_EMAIL`       — a real Robin login (use a dedicated test account, not your own)
- `TEST_PASSWORD`    — that account's password

Tip: never stress-test against production during work hours. Off-peak only,
or against a staging deploy. Render free tier shares CPU with other services.

```bash
export BASE_URL="https://robinrobin-api.onrender.com"
export TEST_EMAIL="loadtest@hastagcreator.com"
export TEST_PASSWORD="..."

# 1. Smoke test — sanity check everything works at low load
k6 run 01-smoke.js

# 2. Load test — what your real peak should look like (50 users)
k6 run 02-load.js

# 3. Stress test — climb until something breaks
k6 run 03-stress.js

# 4. Spike test — sudden burst, simulating a viral signup spike
k6 run 04-spike.js
```

## What to watch DURING the test

Open three tabs:

1. **k6 console** — live VUs, p95 response times, error rate
2. **Render dashboard** → robin-api → Metrics — CPU, memory, response times
3. **MongoDB Atlas** → cluster → Metrics — connections, ops/sec, scan ratio

Red flags:
- p95 > 1 second on `/api/dashboard/employee` → you're hitting it
- 5xx error rate > 1% → service is overloaded
- MongoDB connections plateau at 100 → connection pool exhausted, raise tier
- Render memory > 450MB on free 512MB tier → about to get OOM-killed

## Realistic targets for an agency

With ~30 employees + ~50 clients:
- Peak concurrent users: 30–40 (whole team logged in simultaneously)
- Peak QPS: probably 30 req/sec at most (each user makes ~1 req/sec while active)
- 10× safety margin → load test at **300 VUs** to feel safe

If you stay green at 300 VUs you have plenty of room. If you break at 100
you're closer to the edge than you'd like.

## Reading k6 output

```
http_req_duration..............: avg=234ms  p(95)=512ms  p(99)=890ms
http_req_failed................: 0.12%
iteration_duration.............: avg=1.2s
vus............................: 50    min=1   max=50
```

The line that matters most is `p(95)` — 95% of requests finished within
that time. If `p(95)` is climbing as VUs grow, you're approaching capacity.
