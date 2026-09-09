# OANDA forex reference update — v4.70.0 / package 2.83.0

Apply this changed-files ZIP on top of the v4.69 shared-engine project. Keep all other files. Deploy backend and benchmark from the same commit. Expected backend build: CSA-v4.70.0-oanda-forex-reference.

## Render setup

On the ANALYSIS BACKEND service (the service targeted by BENCHMARK_TARGET_URL), set:

| Variable | Value |
|---|---|
| FOREX_DATA_PROVIDER | oanda |
| OANDA_API_TOKEN | Your OANDA v20 personal access token; enter only in Render, not chat or GitHub |
| OANDA_ENVIRONMENT | practice for a practice account, live for a live account |
| OANDA_PRICE_COMPONENT | B for bid (default), A for ask, M for midpoint |

No account ID is needed by this historical instrument-candles endpoint. A token with the appropriate OANDA environment/access is required. Get API access through your OANDA account: https://developer.oanda.com/rest-live-v20/introduction/

The existing selected chart timezone supplies the calendar/session timezone. Use the chart's actual IANA timezone; do not change the timezone merely to force a price match. Daily candles align to 00:00 in that timezone and weeks to Monday. Changing the price component is a deliberate configuration choice, not an automatic search for a matching price.

Keep TWELVE_DATA_API_KEY for existing non-forex instruments. Set FOREX_DATA_PROVIDER=twelvedata to restore the prior forex provider route. Do not put tokens in code or this file.

## What changed

- Read-only OANDA historical OHLC adapter for recognized forex pairs and all nine existing timeframe intervals, including 1 minute and 1 month. Metals, indices, cocoa and crypto keep the previous provider/chart path; this release does not assume they share forex pip conventions.
- Fixed forex feed-comparison tolerance of three pips: 0.00030 for non-JPY quote pairs; 0.030 for JPY quote pairs. Values beyond the boundary fail the price match when the comparison time/session is established. Existing larger percentage tolerances cannot override this forex limit.
- Compares available printed final-candle OHLC, not just close, against OANDA. Intraday candles require a matching high-confidence final timestamp. An inferred date, unfinished candle or unresolved timestamp remains review-required.
- Endpoint alignment is labelled final_visible_candle_only, never broker-exact. Passing the final-candle comparison does NOT prove that every historical broker extreme differs by less than three pips. Broker history or additional dated printed reference prices would be needed to measure that.
- OANDA prices are never shifted or rounded to fit the screenshot. The three-pip comparison does not widen the Fibonacci-entry tolerance, adjust stops or change historical highs/lows.
- OANDA-selected forex bypasses the focused vision price reader and raster fallback. If OANDA data is missing or cannot be aligned, its prices cannot be replaced by guessed visual extrema for entry selection. Text/context recognition and existing general chart-feedback vision remain; they do not own the provider OHLC.
- No price-based historical date shifting on the OANDA route.
- Pagination is bounded and incomplete page-limited history fails explicitly. Candles are checked for instrument/interval identity, valid OHLC, and completion at the requested historical cutoff. The API's present-day complete flag alone is insufficient for an old screenshot.
- Period aggregation, completed-period entry exclusion, shared direction rules and entry selection remain in the existing shared engine. In-progress periods can supply context from completed execution candles, not structural entries.

## Validation

235 local tests passed, including existing shared-engine tests plus mocked OANDA request parameters, error handling, timestamp conversion, historical completion, pagination, pip sizes and exactly-three-versus-over-three-pip comparisons. Changed JS syntax checks passed. No live OANDA request, token validation or Render deployment was performed.

Run npm run check and npm run test:benchmarks after applying the patch.

First live check: one forex chart with a clearly established final candle timestamp and session timezone. Export JSON should show dataProvider OANDA, the requested price component, comparison tolerance and per-field chart/provider prices. If date_unverified/time_unverified remains, resolve the timestamp evidence instead of widening the price tolerance. The earlier USDCAD screenshot has an inferred final timestamp, so this patch alone does not promise automatic acceptance of it. Avoid another full batch until this single-chart check passes.
