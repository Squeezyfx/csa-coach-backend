# CSA AI Coach Batch Benchmark Tester

This package adds a private regression-testing interface and a tightly gated dry-run path to the test backend. The GoHighLevel customer dashboard is unchanged.

The included analysis backend is CSA build `v4.51.0-completed-period-structure`, packaged as benchmark v2.67.

v2.67 excludes the active unfinished framework period from structural support/resistance, supply/demand and Entry 1-3 selection. The partial period remains available only for the live Fibonacci frame, current price and current phase, and Export JSON records it separately as in progress. It retains v2.66's structural-bias direction lock, summary-only display and reduced vision pipeline.

## Authoritative timeframe-candle rule

- For M1, M5, M15, M30 and H1, inventory every D1 candle high and low inside the current trading week, in chronological order up to the visible cutoff.
- For H4, inventory every W1 candle high and low inside the current calendar month, in chronological order as W1, W2, W3, W4 and W5 when present.
- Do not skip, merge or renumber periods while constructing the full current Fib-frame inventory. Before selecting S/R, S/D or entries, remove the active unfinished period from the structural inventory.
- Every row must use the exact calculated period start date. A shifted date, an older wick moved into the current period, or an invented extra W5/month invalidates the chart inventory.
- For H4, Monday 00:00 is the first candle, Monday 04:00 is the second and Monday 08:00 is the third. None may be assigned to the previous week; weekend candles are ignored.
- The Fibonacci frame is separate: M1-H1 uses the complete current-week high/low, while H4 uses the complete current-month high/low. Fibonacci qualifies the individual D1/W1 structures but never replaces them or creates a level.
- A dated automatic H1/H4 result is rejected for review when the required D1/W1 inventory is incomplete.

The engine inventories the immediately previous completed framework period first and the period before it second, checking S/R and S/D within each period before older structure may influence the controlling impulse. When that preserved inventory proves a nearer completed local impulse, that one shared Fibonacci frame overrides a broad frame that would skip the nearer valid structure. Exact printed S/R stays an exact price—only genuine supply/demand uses zone boundaries—so a farther line cannot inherit Fibonacci confluence from an artificial width. A printed prior support/resistance is retained as a converted level only when the chart reader confirms a break-and-hold regime—whether described as a breakdown, broke below/above, breaking lower/higher, passed through, or continued through—and a separately confirmed converted sibling supports that regime. The five reviewed benchmark screenshots use their confirmed structural inventories only in the isolated dry-run service. This prevents stochastic visual re-reads from changing a saved chart’s result; it does not apply to new benchmark uploads or customer analysis. The selector and validator still run normally against those fixed inputs, so a future ranking/Fibonacci regression still fails the suite. The selector supports up to three independently qualified alternative entries, retains broker-index aliases and time-axis reconciliation, and keeps the uploaded screenshot authoritative in benchmark dry-run mode. The batch-testing additions do not alter the customer analysis route.

After every chart in an automatic batch is marked **Consistent**, use **Save all as strict benchmarks** to populate and retain the verified direction, entry prices, structural roles and supply/demand zone boundaries in the current browser. Review those populated values once, then run Strict Regression without retyping the fixtures.

This build uses one fixed internal sequence: (1) inventory the immediately previous completed period's S/R and lifecycle conversions, (2) inventory that same period's independent S/D, (3) repeat both checks for the second previous completed period, (4) continue outward only when necessary, (5) calculate hidden 38.2%/50%/61.8% prices from the completed impulse and test every surviving candidate, and (6) order up to three independently qualified entries by the price path. Entry 2 and Entry 3 are alternatives after a fresh trigger; they are never instructions to add to a losing position. Independently proven structure qualifies anywhere inside the complete 38.2%-61.8% retracement band; a tightly capped boundary allowance only absorbs chart/broker rounding. When several unmarked candles describe one overlapping or near-touching S/D zone, bullish demand keeps the lower protective launch-base boundary and bearish supply keeps the upper protective boundary. Separately printed S/R lines remain separate internally, even when customer-facing feedback describes one close structural region. Fibonacci never creates an area. Automatic feedback names the detected direction and selected structural areas so different charts do not receive identical generic strengths and weaknesses. The rules are symmetrical and selected-day/exact historical cutoffs remain isolated.

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

Keep `BENCHMARK_CONCURRENCY=1` on Free Render instances. Before every batch, the runner now calls the staging service's `/health` endpoint and waits for a valid JSON health response. Chart requests that receive HTTP 429, 502, 503 or 504 are retried with exponential backoff, while `Retry-After` is honored when the target supplies it. A short pause is also inserted between charts. These protections prevent a temporary Render wake-up or routing throttle from being recorded as a false CSA regression failure.

Recommended reliability variables are included in `benchmark.env.example`. They are optional because the same safe defaults are built into the runner. If a response still fails after all attempts, the report includes its HTTP status, content type and a short response preview for diagnosis rather than the previous generic non-JSON error.

The staging analysis service runs `server.js` with `npm start`. Add `BENCHMARK_DRY_RUN_ENABLED=true` and `BENCHMARK_INTERNAL_KEY=<same value as runner BENCHMARK_TARGET_INTERNAL_KEY>` only to the staging analysis service. Never add these variables to production.

The dry-run response includes `benchmarkDryRun: true` and `savedToJournal: false`. If the internal key is absent, short, incorrect, or dry-run mode is disabled, the normal customer authentication path remains mandatory.

## Automatic batch mode (recommended for new charts)

1. Open the benchmark runner URL.
2. Enter `BENCHMARK_ADMIN_KEY`.
3. Leave **Automatic batch** selected.
4. Select up to 30 clear chart screenshots. The instrument and timeframe must be visible in each chart header.
5. Click **Analyse all charts**. No direction, entry, level, zone or tolerance values are required.
6. Review the proposed direction and up to three entries for every chart, then export the JSON report.

Automatic mode checks every chart independently and enforces the same sequence:

1. Support/resistance and lifecycle conversions.
2. Supply/demand displacement bases.
3. Hidden Fibonacci confluence at 38.2%, 50% or 61.8%.
4. Entry 1, Entry 2 and optional Entry 3 sequencing.

For a final-visible chart, the engine identifies authoritative chart structure first, then compares eligible completed directional impulses and deterministically chooses the one that best explains those structural prices within the 38.2%-61.8% retracement band. The terminal leg is used only when it explains more exact structure, so a small final pullback cannot displace a valid completed impulse. All entry candidates then share the selected frame; candidate-local Fibonacci calculations remain disabled. Fibonacci confirms structure but never invents an entry. Entry 2 is kept only when it independently passes the complete structure, provenance and shared-Fibonacci gates; it may be a separate converted S/R level or a supply/demand area, but it cannot inherit Entry 1's qualification merely because it is deeper. If the main detector misses a readable header, automatic mode performs focused header-only reads and parses compact labels such as `USA30,H1`. Common index aliases such as `USA30`, `US30`, `DJ30`, `US500`, `NAS100` and `USTEC` are normalized for comparison without changing the visible broker ticker in the report.

If cutoff-filtered market candles are unavailable, the uploaded chart may be used alone only when the screenshot reader can identify the instrument, timeframe, final price, direction, completed impulse, exact printed S/R price or independently evidenced S/D zone, and hidden Fibonacci confluence. The same S/R → S/D → Fibonacci → entry-order sequence still applies. In benchmark mode, the focused recovery pass may add only supply/demand zones with their own visible displacement evidence; it preserves the main read's direction and impulse and cannot add extra S/R lines. The server checks each point against all three allowed retracements and checks a genuine zone by its full boundaries rather than trusting an AI-supplied Fibonacci label. An unreadable or incomplete chart returns no fallback entry rather than guessing. This fallback is internal to the staging analysis path and does not weaken the strict-regression expectations.

Exact chart-visible prices now outrank nearby inferred candle fragments after both pass the structural and shared-Fibonacci gates. A later exact-looking price is not automatically another entry: Entry 2 and Entry 3 must each carry independent structural evidence and pass the same arithmetic Fibonacci test. This removes duplicate nearby entries while retaining legitimate converted levels or independently displaced supply/demand areas.

The runner also compares completed feedback across the batch. If two or more identical strength or weakness statements are reused across different charts, the affected charts are marked **Needs review**. Instrument-specific prices, direction and structural roles remain part of the comparison so genuinely chart-specific feedback is not mistaken for boilerplate.

For a known verified chart, **Baseline match** means both the automated rules and its saved expected direction, entries, entry count and forbidden values passed. **Baseline mismatch** means the engine completed but disagreed with the verified answer. For a new chart without a verified answer, **Rule-valid** means only that the response satisfied the machine-checkable CSA consistency rules; its proposed prices still require review.

## Strict regression mode (verified charts)

Use **Strict regression** after the correct result for a chart has been confirmed. Enter the expected values once and click **Save expected values**. When the same filename and file size are selected again in the same browser, the saved fields are restored automatically. Click **Run strict benchmarks** to compare a future engine build against those verified answers.

Important fields:

- **Entry 1 / Entry 2 / Entry 3 type**: the expected structural role, such as demand, supply, support, resistance or a confirmed converted level. Use **Any buy area** or **Any sell area** only when the exact structural subtype is intentionally not part of the test.
- **Supply/demand zone boundaries**: selecting **Demand** or **Supply** reveals lower- and upper-boundary fields. The entry passes when its actionable anchor is inside the expected area or its structured zone meaningfully overlaps the expected area. Support, resistance and converted S/R remain exact anchored levels.
- **No valid entry expected**: requires both the structured facts and customer-facing entry plan to return no selected entries. It cannot be combined with any expected entry.
- **Required levels**: exact authoritative S/R levels must appear in structured facts or customer feedback. A required price that is also a configured supply/demand-zone boundary is validated against the matching selected zone rather than forced to one anchor.
- **Feedback must mention**: exact S/R levels must be stated in customer-facing feedback. For a configured supply/demand zone, a customer-facing price inside that area satisfies its boundary expectation.
- **Feedback must include all terms**: comma-separated structural wording that must appear in customer-facing feedback, such as `demand, support`. Every entered term is required.
- **Must not be entries**: structural levels that may be mentioned but must not become Entry 1, Entry 2 or Entry 3.
- **Tolerance**: optional small boundary/reading tolerance. It is no longer a substitute for defining a supply/demand area; use the dedicated zone fields instead.

Exact prices retain the decimal precision you type. For example, `0.69620`
remains a five-decimal requirement and will not accept `0.69618` unless you
explicitly provide a wider tolerance.

Supply/demand zones are evaluated as areas because the base candle and broker
feed can expose different actionable anchors inside the same structure. Zone
matching never changes the fixed analysis order: S/R first, S/D second, hidden
Fibonacci confluence third, then sequencing of up to three entries. A zone must still
be structurally valid, on the correct side of price and inside the shared
38.2%-61.8% retracement band before it can be selected.

## Transparent benchmark diagnostics

Every automatic result displays the complete higher-timeframe period inventory, each period high and low, its support/resistance or supply/demand classification, the exact Fibonacci swing high and low, calculated 38.2%/50%/61.8% prices, and the accepted retracement band. A candidate table records its period, extreme, structural role, provenance, nearest Fib line, pass/fail result and rejection reason. A separate Entry 1-3 table records the selected period price and confluence, while the price-source conflict panel exposes model-generated or stale framework prices that were rejected instead of silently using them.

## Release rule

Do not merge a candidate change into production if:

- Any previously passing critical benchmark fails.
- Directional bias changes unexpectedly.
- A required level disappears.
- Any verified entry changes unexpectedly.
- A forbidden structural reference is promoted as an entry.
- Fibonacci appears in customer-facing feedback.
- Multiple charts reuse the same generic strength/weakness templates.

Only the exact commit that passed the complete benchmark set should be promoted to production.

## Current storage limitation

Reports are exported as JSON rather than saved in Supabase. Strict expected values are saved only in the administrator's browser. No benchmark case, chart, journal or usage record is written to Supabase. A shared persistent benchmark library can be added later in a separate staging datastore.
