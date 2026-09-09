# CSA shared analysis engine — v4.69.0 / package 2.82.0

This ZIP contains changed files, not a full replacement repository. It was built from the available v4.68.0 calendar-guards project. Apply it to that project; do not delete other repository files. If your GitHub branch contains newer edits, merge these changes rather than overwriting them blindly.

## Deploy

1. Copy all files from this ZIP into the same paths in your existing backend repository, including both new root modules and files under benchmark/.
2. Commit the changes together. Deploy the analysis backend and benchmark service from that same commit. Deploying only the benchmark does not update the engine it calls.
3. Confirm the analysis backend reports build `CSA-v4.69.0-shared-framework-engine` (feedback engine 10.64.0). Keep the existing benchmark target URL pointing to that backend.
4. Run `npm run check` and `npm run test:benchmarks`. Tests use local fixtures and synthetic inputs; no model or Twelve Data calls are made.
5. First run one previously failing H1 chart and one D1/H4 control. Inspect their Export JSON before spending credits on another full batch.

## Timeframe mapping

| Chart timeframe | Structural periods | Shared Fibonacci window |
|---|---|---|
| M1, M5, M15, M30, H1 | Daily periods, Monday–Friday | Current week through visible cutoff |
| H4 | Monday-based weeks clipped to current month | Current month through visible cutoff |
| D1 | Calendar months | Current year through visible cutoff |
| W1 | Calendar quarters | Current year through visible cutoff |
| MN / MN1 | Calendar years | Current year and previous four years |

These are the nine standard MT4 timeframes. Other/custom periods are not silently interpreted as H1. Weekday-only handling preserves the existing CSA framework, including for crypto; it is not a claim that crypto stops trading on weekends. Dates must use the chart's session calendar. This update cannot infer an unreadable broker timezone.

## Shared behavior

- framework-calendar.js owns calendar boundaries, coverage checks and direction resolution.
- shared-analysis-engine.js coordinates inventory coverage, direction/evidence status, candidate eligibility and the existing independent-entry selector.
- Server and benchmark inventory validator use that calendar mapping. Customer and benchmark entry selection use the same fixed-frame path; incomplete frames cannot fall through to a smaller local impulse, including on MN.
- A readable calendar opening price versus final close owns direction. When open is missing or equal to close, range position and completed-period progression can resolve it; otherwise direction remains unresolved. A final opposing move is a phase, not a separate timeframe-specific override.
- Existing structural classification, Fibonacci band tolerance, deduplication and the three-entry presentation limit remain. No instrument-specific expected price is inserted. Additional candidates remain in diagnostics.
- Saved fixture prices are retained in the existing regression files as expectations. Filename-based chart validation/context rescue and late candidate injection have been removed from the live analysis route.
- Complete chart-only estimates can remain provisional. Missing prices, calendar coverage or evidence remain review issues. A provider-aligned reference is not broker-exact data. This update does not turn image-derived decimals into exact broker prices.

## Verification and limits

226 local tests passed, including shared engine tests across all nine timeframes, scaled price inputs, invalid/missing dates, opening partial weeks, weekends, leap dates, candidate gates, and the actual server missing-frame guard with benchmark mode both on and off. Changed JavaScript files passed Node syntax checks.

Existing tests were updated where they inspected obsolete implementation text or extracted functions without their new module dependencies. Saved price expectations were not rewritten to force passing results. Several historical benchmark tests validate prepared outputs, not live screenshot extraction.

No live model/provider requests or Render deployment were performed. The 226 tests do not establish that all historical screenshots now reproduce their accepted price values. Screenshot reading is still an evidence-producing adapter and can fail independently of the shared engine. Test this build before promoting it to production.
