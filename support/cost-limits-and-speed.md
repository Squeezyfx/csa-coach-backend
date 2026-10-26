# Cost limits and speed switches (Render settings)

Everything here is an **environment variable** on the Render service (Environment tab). Nothing needs
to be set: with no variables the defaults below apply. Changing a variable restarts the service.

## 1. Attempt limits (cost guard)

The plan allowance (7 / 40 / 150 reviews a month) only counts reviews that finished. These limits count
**every attempt that reaches the AI**, including uploads that fail, so a retry loop or a pile of
non-chart images cannot run up the AI bill. Counts are kept in memory (a restart resets them).

| What it stops | Default | Variable |
|---|---|---|
| Too many started in a short time | 8 attempts in 10 minutes | `ATTEMPT_BURST_MAX`, `ATTEMPT_BURST_MINUTES` |
| Too many uploads that ended in an error | 8 in 1 hour | `ATTEMPT_FAILURE_MAX`, `ATTEMPT_FAILURE_MINUTES` |
| Per-user daily ceiling (rolling 24 h) | Starter 15, Pro 45, Elite 90 | `ATTEMPT_DAILY_STARTER`, `ATTEMPT_DAILY_PRO`, `ATTEMPT_DAILY_ELITE` |
| Whole-service daily ceiling | 400 attempts | `ATTEMPT_GLOBAL_DAILY_MAX` |
| Accounts never limited (you, testing) | none | `ATTEMPT_LIMIT_EXEMPT_EMAILS` (comma separated) |

- A blocked user sees a plain message with how long to wait, and the server answers with HTTP 429 and a
  `Retry-After` header. Look for `[attempt-limit] blocked` in the Render logs.
- Reviews answered from the saved copy of an identical earlier result do not count (they cost nothing).
- The 16-chart benchmark runs are never limited.
- 400 attempts a day is roughly 400 reviews. Raise `ATTEMPT_GLOBAL_DAILY_MAX` when real users arrive.
  This is a safety stop, not a billing cap: still set a **spending limit in your AI provider's dashboard**.

## 2. Speed switches (off by default, test first)

The two slowest steps of a review are the first chart read (about 13 to 15 s) and the full visual review
(about 30 to 40 s). Each can use a faster model:

| Variable | Step | Default |
|---|---|---|
| `CHART_VALIDATION_MODEL` | first chart read | same as `CLAUDE_MODEL` |
| `VISUAL_REVIEW_MODEL` | full visual review | same as `CLAUDE_MODEL` |
| `VISUAL_REVIEW_MAX_TOKENS` | size of the visual review answer | 2000 |

Do **not** set these on the live service first. Set one on the **test service**, run the 16 charts, and
compare with the last good run (15 of 16, same entries). Try `VISUAL_REVIEW_MODEL` first, one change at a
time. The Render log line `CSA PERFORMANCE CONFIG` shows the models in use.
