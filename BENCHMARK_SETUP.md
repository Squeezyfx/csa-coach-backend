# CSA AI Coach Batch Benchmark Tester

This package adds a private regression-testing interface without changing `server.js` or the GoHighLevel customer dashboard.

The included analysis backend is the supplied CSA `v4.10.18` modified build. The batch-testing additions do not alter its customer analysis route.

## Isolation model

The benchmark runner must point only to a separate staging deployment of the CSA backend. The staging backend should use a staging Supabase project or, at minimum, a dedicated test user and non-customer data. Never set `BENCHMARK_TARGET_URL` to the production customer backend.

Recommended services:

1. **CSA Production** — existing production branch, existing `npm start`, customer environment variables.
2. **CSA Staging Analysis** — `benchmark-testing` branch, `npm start`, staging/test environment variables.
3. **CSA Benchmark Runner** — `benchmark-testing` branch, `npm run start:benchmark`, benchmark environment variables.

The runner submits each chart to the staging analysis service as an independent request. It does not contact GoHighLevel, Stripe, production customer accounts, or production journals.

## Render configuration

Create a new private web service for the benchmark runner:

- Build command: `npm install`
- Start command: `npm run start:benchmark`
- Branch: `benchmark-testing`
- Health check path: `/health`

Copy the variables from `benchmark.env.example` into the runner service. Use a long random `BENCHMARK_ADMIN_KEY`.

The staging analysis service runs the unchanged `server.js` with `npm start`. Give its test user an Elite or large beta analysis allowance because the current `/analyze-chart` route records usage in whichever Supabase project that staging service uses.

## First run

1. Open the benchmark runner URL.
2. Enter `BENCHMARK_ADMIN_KEY`.
3. Select several chart screenshots.
4. For each chart, enter its instrument, timeframe, cutoff mode, and expected facts.
5. Click **Run all benchmarks**.
6. Review critical failures and export the JSON report.

Important fields:

- **Required levels**: important levels that must appear in structured facts or customer feedback.
- **Must not be entries**: structural levels that may be mentioned but must not become Entry 1 or Entry 2.
- **Tolerance**: optional price tolerance. Leave blank for instrument-scale defaults.

## Release rule

Do not merge a candidate change into production if:

- Any previously passing critical benchmark fails.
- Directional bias changes unexpectedly.
- A required level disappears.
- Entry 1 or Entry 2 changes unexpectedly.
- A forbidden structural reference is promoted as an entry.
- Fibonacci appears in customer-facing feedback.

Only the exact commit that passed the complete benchmark set should be promoted to production.

## Current Phase 1 limitation

This first version exports reports as JSON rather than saving benchmark cases in Supabase. That keeps the initial implementation isolated and reversible. Persistent benchmark tables and version-to-version history can be added after the runner has been proven against the first chart set.
