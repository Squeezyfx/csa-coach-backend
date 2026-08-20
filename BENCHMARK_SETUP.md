# CSA AI Coach Batch Benchmark Tester

This package adds a private regression-testing interface and a tightly gated dry-run path to the test backend. The GoHighLevel customer dashboard is unchanged.

The included analysis backend is CSA build `v4.11.1-final-visible-independent-sd`. The batch-testing additions do not alter its customer analysis route.

This build uses one fixed internal sequence: (1) validate support/resistance and lifecycle conversions, (2) independently validate supply/demand displacement bases, (3) apply hidden 38.2%/50%/61.8% Fibonacci confluence, and (4) order the surviving Entry 1 and Entry 2 by the price path. Fibonacci never creates an area. A strong structural area just past the exact 61.8 line may qualify only within the conservative proximity allowance; clearly deep structure remains reference-only. The rules are symmetrical and selected-day/exact historical cutoffs remain isolated.

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

- **Entry 1 / Entry 2 type**: the expected structural role, such as demand, supply, support, resistance or a confirmed converted level. Use **Any buy area** or **Any sell area** only when the exact structural subtype is intentionally not part of the test.
- **No valid entry expected**: requires both the structured facts and customer-facing entry plan to return no selected entries. It cannot be combined with an expected Entry 1 or Entry 2.
- **Required levels**: exact authoritative levels that must appear in structured facts or customer feedback. Merely falling inside a broad zone does not count.
- **Feedback must mention**: exact levels that must be stated in the customer-facing feedback.
- **Feedback must include all terms**: comma-separated structural wording that must appear in customer-facing feedback, such as `demand, support`. Every entered term is required.
- **Must not be entries**: structural levels that may be mentioned but must not become Entry 1 or Entry 2.
- **Tolerance**: optional Entry 1, Entry 2 and forbidden-entry price tolerance. Use it for approximate levels on unmarked charts; leave it blank for exact marked levels and instrument-scale defaults.

Exact prices retain the decimal precision you type. For example, `0.69620`
remains a five-decimal requirement and will not accept `0.69618` unless you
explicitly provide a wider tolerance.

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
