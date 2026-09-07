# OANDA timestamp fix — v4.70.2

Apply these changed files over v4.70.1, keeping the same file paths. Deploy the analysis backend and benchmark from the same commit. Expected build: CSA-v4.70.2-oanda-chart-time. Keep the working OANDA live environment and your selected M price component.

Confirmed from the supplied export:
- OANDA authentication succeeds and weekly prices are available.
- Vision inferred August 27 16:00 while the comparison selected the earlier 12:00 candle. Its close differs from the screenshot by 43 pips; bypassing the timestamp check would be wrong.
- On the original USDCAD H4 PNG, twelve printed date/time labels align with the candle grid. There are 19 candle intervals after the August 25 16:00 label, placing the final candle at August 28 20:00 in chart time. This calculation does not establish the broker timezone.

Changes:
1. The existing vision context request now transcribes all printed axis date/time labels, with null for labels lacking a printed time. It is told not to use the last axis label's time as the final candle time.
2. A deterministic plain-MT4 PNG reader measures candle spacing and axis tick positions, verifies at least three timestamp anchors against the weekday candle calendar, and counts to the final candle. Inconsistent/insufficient evidence is rejected. The reader does not measure prices. D1/W1/MN retain their previous paths.
3. Reconstruction has its own evidence label and an exported timestamp audit. The three-pip limit stays unchanged.
4. A historical candle overlapping the cutoff is retained separately for header comparison. Its full later OHLC is excluded from calculation candles. After a successful timestamp/price match, only the screenshot's readable header snapshot can extend current-period context. Completed-period entry exclusion remains.

Validation: 244 local tests passed. The new regression uses the actual supplied USDCAD image with independently transcribed axis text; it tests pixel geometry, not a fresh production vision response. Mocked API tests verify comparison-only candles cannot enter the historical calculation array. No live OANDA call or Render deployment was performed.

Retest only 2925.PNG after deployment. Check Export JSON for build v4.70.2, chartDetection.timestampAudit, final date/time, and OANDA comparisons. If production OCR omits or misreads the printed time labels, the reader will still require review. A broker/session timezone mismatch or OHLC mismatch over three pips is also still a legitimate review condition. This patch does not widen tolerance or select timestamps based on matching prices.
