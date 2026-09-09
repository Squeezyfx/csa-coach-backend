# OANDA authentication fix — v4.70.1

Apply these changed files over the v4.70 OANDA update. Deploy the analysis backend and benchmark from the same commit. Expected build: CSA-v4.70.1-oanda-auth-diagnostics.

The supplied logs confirm HTTP 401, not a price-reading failure. OANDA rejected the token before returning candles. The screenshot shows practice mode and M (midpoint); M is a valid price component and is not the cause of authentication failure. This patch cannot make an invalid/revoked token valid.

Changes:
- Removes surrounding whitespace/quotes, an accidentally pasted OANDA_API_TOKEN= prefix, and an accidentally pasted Bearer prefix. Rejects internal whitespace without exposing token contents.
- Normalizes environment/price-component casing and spacing.
- Gives specific 401 guidance identifying the configured environment; handles non-JSON error responses safely.
- Adds a read-only connection/candle check using zero AI calls. It fetches a completed EUR/USD sample and prints its OHLC on success. It never places orders, logs tokens or automatically switches practice/live.
- Keeps existing price extraction, three-pip comparison and timeframe rules unchanged.

Next steps:
1. Upload the ZIP files to their existing paths and deploy the analysis backend.
2. In Render, open csa-coach-claude-test -> Shell. Run:
   node oanda-connection-check.js
   Alternatively: npm run check:oanda
3. If the output says ok:true, authentication AND sample candle retrieval work. Then run only USDCAD H4 and export JSON.
4. If it still says 401: sign into the OANDA v20 account matching your chosen environment. Under My Account -> My Services -> Manage API Access, generate a valid personal access token. Update OANDA_API_TOKEN on the analysis backend, save/redeploy, then repeat the connection check. A broker login password, account number or TradingView login is not this token. Keep the token private.
5. Use OANDA_ENVIRONMENT=practice for your practice API access, or live for your live API access. Do not switch environments blindly to force a match. OANDA_PRICE_COMPONENT=M may stay as configured if midpoint is your intended reference.

If Render Shell is unavailable, run the same script in your existing Node project with the environment variables set securely in your local terminal. Do not upload credential files to GitHub.

240 local tests passed, including token formatting, private diagnostics, midpoint retrieval, no environment switching and HTTP 401 handling. Live authentication cannot be verified from the masked token in a screenshot. Once authentication passes, historical date/session alignment remains a separate check; no claim that all chart levels have already been verified.

Official references:
https://developer.oanda.com/rest-live-v20/authentication/
https://developer.oanda.com/rest-live-v20/development-guide/
https://developer.oanda.com/rest-live-v20/troubleshooting-errors/
