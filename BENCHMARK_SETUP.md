# CSA AI Coach Batch Benchmark Tester

This package adds a private regression-testing interface and a tightly gated dry-run path to the test backend. The GoHighLevel customer dashboard is unchanged.

The included analysis backend is the supplied CSA `v4.10.18` modified build. The batch-testing additions do not alter its customer analysis route.

## Isolation model

The benchmark runner must point only to a separate staging deployment of the CSA backend. Never set `BENCHMARK_TARGET_URL` to the production customer backend. The staging backend's internal dry-run path skips customer authentication, allowances, journal creation, chart storage and database writes.

Recommended services:

1. **CSA Production** — existing production branch, existing `npm start`, customer environment variables.
2. **CSA Staging Analysis** — `benchmark-testing` branch, `npm start`, staging/test environment variables.
3. **CSA Benchmark Runner** — `benchmark-testing` branch, `npm run start:benchmark`, benchmark environment variables.

The runner submits each chart to the staging analysis service as an independent request using a constant-time-checked internal key. It does not contact GoHighLevel, Stripe, production customer accounts, Supabase Auth, customer journals or usage tables.

## Render configuration

Create a new private web service for the benchmark runner:

- Build command: `npm install`
- Start command: `npm run start:benchmark`
- Branch: `benchmark-testing`
- Health check path: `/health`

Copy the runner variables from `benchmark.env.example` into the runner service. Use long, different random values for `BENCHMARK_ADMIN_KEY` and `BENCHMARK_TARGET_INTERNAL_KEY`.

The staging analysis service runs `server.js` with `npm start`. Add `BENCHMARK_DRY_RUN_ENABLED=true` and `BENCHMARK_INTERNAL_KEY=<same value as runner BENCHMARK_TARGET_INTERNAL_KEY>` only to the staging analysis service. Never add these variables to production.

The dry-run response includes `benchmarkDryRun: true` and `savedToJournal: false`. If the internal key is absent, short, incorrect, or dry-run mode is disabled, the normal customer authentication path remains mandatory.

## First run

1. Open the benchmark runner URL.
2. Enter `BENCHMARK_ADMIN_KEY`.
3. Select several chart screenshots.
4. For each chart, enter its instrument, timeframe, cutoff mode, and expected facts.
   Select Starter, Pro or Elite output for each case; Starter is the default.
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

This first version exports reports as JSON rather than saving benchmark cases in Supabase. No benchmark case, chart, journal or usage record is written to Supabase. Persistent benchmark history can be added later in a separate staging datastore.
