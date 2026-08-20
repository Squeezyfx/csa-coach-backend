# CSA AI Coach Batch Benchmark Tester

This package adds a private regression-testing interface and a tightly gated dry-run path to the test backend. The GoHighLevel customer dashboard is unchanged.

The included analysis backend is CSA build `v4.11.4-protective-cluster-and-internal-fib`. The batch-testing additions do not alter its customer analysis route.

This build uses one fixed internal sequence: (1) validate support/resistance and lifecycle conversions, (2) independently validate supply/demand displacement bases, (3) apply hidden 38.2%/50%/61.8% Fibonacci confluence, and (4) order the surviving Entry 1 and Entry 2 by the price path. When several unmarked candles describe one overlapping or near-touching S/D zone, bullish demand keeps the lower protective launch-base boundary and bearish supply keeps the upper protective launch-base boundary. Fibonacci never creates an area. A strong structural area just past the exact 61.8 line may qualify only within the conservative proximity allowance; clearly deep structure remains reference-only. Automatic feedback names the detected direction and selected structural areas so different charts do not receive identical generic strengths and weaknesses. The rules are symmetrical and selected-day/exact historical cutoffs remain isolated.

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

## Automatic batch mode (recommended for new charts)

1. Open the benchmark runner URL.
2. Enter `BENCHMARK_ADMIN_KEY`.
3. Leave **Automatic batch** selected.
4. Select up to 30 clear chart screenshots. The instrument and timeframe must be visible in each chart header.
5. Click **Analyse all charts**. No direction, entry, level, zone or tolerance values are required.
6. Review the proposed direction and Entry 1/Entry 2 for every chart, then export the JSON report.

Automatic mode checks every chart independently and enforces the same sequence:

1. Support/resistance and lifecycle conversions.
2. Supply/demand displacement bases.
3. Hidden Fibonacci confluence at 38.2%, 50% or 61.8%.
4. Entry 1 and Entry 2 sequencing.

An automatic **Consistent** result means the response completed and satisfied the machine-checkable CSA consistency rules. It does not manufacture its own ground truth. New proposed prices should be reviewed before being accepted as permanent accuracy examples.

## Strict regression mode (verified charts)

Use **Strict regression** after the correct result for a chart has been confirmed. Enter the expected values once and click **Save expected values**. When the same filename and file size are selected again in the same browser, the saved fields are restored automatically. Click **Run strict benchmarks** to compare a future engine build against those verified answers.

Important fields:

- **Entry 1 / Entry 2 type**: the expected structural role, such as demand, supply, support, resistance or a confirmed converted level. Use **Any buy area** or **Any sell area** only when the exact structural subtype is intentionally not part of the test.
- **Supply/demand zone boundaries**: selecting **Demand** or **Supply** reveals lower- and upper-boundary fields. The entry passes when its actionable anchor is inside the expected area or its structured zone meaningfully overlaps the expected area. Support, resistance and converted S/R remain exact anchored levels.
- **No valid entry expected**: requires both the structured facts and customer-facing entry plan to return no selected entries. It cannot be combined with an expected Entry 1 or Entry 2.
- **Required levels**: exact authoritative S/R levels must appear in structured facts or customer feedback. A required price that is also a configured supply/demand-zone boundary is validated against the matching selected zone rather than forced to one anchor.
- **Feedback must mention**: exact S/R levels must be stated in customer-facing feedback. For a configured supply/demand zone, a customer-facing price inside that area satisfies its boundary expectation.
- **Feedback must include all terms**: comma-separated structural wording that must appear in customer-facing feedback, such as `demand, support`. Every entered term is required.
- **Must not be entries**: structural levels that may be mentioned but must not become Entry 1 or Entry 2.
- **Tolerance**: optional small boundary/reading tolerance. It is no longer a substitute for defining a supply/demand area; use the dedicated zone fields instead.

Exact prices retain the decimal precision you type. For example, `0.69620`
remains a five-decimal requirement and will not accept `0.69618` unless you
explicitly provide a wider tolerance.

Supply/demand zones are evaluated as areas because the base candle and broker
feed can expose different actionable anchors inside the same structure. Zone
matching never changes the fixed analysis order: S/R first, S/D second, hidden
Fibonacci confluence third, then Entry 1/Entry 2 sequencing. A zone must still
be structurally valid, on the correct side of price and close to the relevant
38.2%, 50% or 61.8% retracement before it can be selected.

## Release rule

Do not merge a candidate change into production if:

- Any previously passing critical benchmark fails.
- Directional bias changes unexpectedly.
- A required level disappears.
- Entry 1 or Entry 2 changes unexpectedly.
- A forbidden structural reference is promoted as an entry.
- Fibonacci appears in customer-facing feedback.

Only the exact commit that passed the complete benchmark set should be promoted to production.

## Current storage limitation

Reports are exported as JSON rather than saved in Supabase. Strict expected values are saved only in the administrator's browser. No benchmark case, chart, journal or usage record is written to Supabase. A shared persistent benchmark library can be added later in a separate staging datastore.
