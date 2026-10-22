# Beta invitation and tester guide

Three parts: (1) how you switch a tester's beta access on, (2) the invitation email,
(3) the one-page tester guide to attach or paste under the email.
Replace everything in **[BRACKETS]** before sending.

---

## 1. Before you send: give each tester beta access

A beta tester gets the Elite plan with 75 chart analyses for a limited time, then moves to Starter
(7 analyses a month) unless they subscribe. The page shows a BETA tag and a "Give feedback" button.

**Steps**
1. Ask the tester to **create their account first** on `https://training.csaforex.com/version2web`
   (Start Free -> Create account -> click the confirmation email). The account must exist before you can upgrade it.
2. In Supabase -> **SQL Editor** -> New query, paste this with their email and the end date you choose
   (two weeks from today is a good length), then **Run**:

```sql
update profiles
set is_beta_tester = true,
    plan_override = 'elite',
    plan_override_expires_at = '2026-11-01 23:59:59+00',
    beta_analysis_limit = 75
where email = 'tester@example.com';
```

3. Check it worked: the SQL result should say `1 row affected`. When the tester refreshes the page, the
   account menu shows **Elite Beta Tester** and "Beta access expires 1 Nov 2026".
4. To end or extend it later, change `plan_override_expires_at` (or set `is_beta_tester = false`).

**Notes**
- The beta does **not** include the bonus course or the indicator (those belong to paid Pro/Elite).
- The 20 Oct date from the first plan is only three days away. New testers need a new date, as above.
- Before inviting anyone: delete the test row in `indicator_access`, and cancel the Stripe sandbox test subscription.

---

## 2. The invitation email

**Subject:** You're invited to test CSAForex (free, 2 weeks)

Hi [FIRST NAME],

I'm opening a small private beta of **CSAForex**, an AI coach that reviews your trading charts, and I'd
like you to be one of the first people to try it.

**What it does.** You upload a screenshot of a chart. It tells you what you did right, what to fix, and
what to check before your next trade, using the CSA Framework. It is a coach, not a signal service: it
never tells you where price is going.

**What you get.** Full access to the top plan (Elite) with **75 chart reviews** until **[END DATE]**,
free. No card needed.

**What I'm asking.** Use it on charts you actually trade, for a few days, and tell me honestly what
works and what doesn't. The reviews that look wrong are the most useful ones.

**How to start (3 minutes)**
1. Go to **https://training.csaforex.com/version2web** and press **Start Free**.
2. Create your account with this email address: **[TESTER EMAIL]**. Click the confirmation link we email you
   (check spam if it doesn't arrive in a few minutes).
3. Reply to this email to say you're in. I'll switch your beta access on and tell you when it's ready.
4. Then follow the one-page guide below.

Thank you for helping. It really does shape what we build next.

[YOUR NAME]
CSAForex
support@csaforex.com

*CSAForex is an educational tool. It does not give financial advice or trade signals, and trading carries
risk.*

---

## 3. Tester guide (one page)

### What to do
1. **Upload a chart.** Take a screenshot of a TradingView, MT4 or MT5 chart. Click the upload box, drag the
   image in, or paste it with **Ctrl + V**. You can also use the TradingView bar on the page and press
   **Use this chart for my review**.
2. **Move your mouse off the chart before you take the screenshot.** TradingView shows the price of the
   candle under your cursor in the top-left corner, and that can confuse the review. Rest the mouse outside the chart.
   Under the **Chart view** the review says "Reviewed up to ...". If your chart goes further than that, or you see
   a "Lower confidence" note, the pointer was probably on the chart: take a fresh screenshot and run it again.
3. **Check the boxes.** Make sure **Pair** and **Timeframe** match the chart.
4. **Pick a mode.**
   - **Pre-trade:** you're planning a trade. You can type a planned entry, stop loss and take profit and the
     coach checks them. It's a plan check, not a signal.
   - **Post-trade:** you've taken the trade and want it reviewed.
5. Press **Run AI Diagnostics** and read the review. It takes about 15 to 30 seconds.
6. Open **My journal** in the account menu to see your saved reviews, and the dashboard for your patterns.

### Please try
- 5 or more charts from pairs you really trade, on at least two timeframes (for example H1 and H4).
- One **Pre-trade** review with your own planned entry, stop and target typed in.
- One **Post-trade** review of a trade you already took.
- A chart with no clean setup. "No entry yet" is a normal, correct answer.
- Using it on your phone, at least once.

### What I most want to hear (use the green **Give feedback** button, bottom right)
- Was the **direction** (bullish or bearish) what you'd say yourself?
- Were the **levels and entries** where you'd expect them? If not, which one looked wrong and where should it be?
- Was anything **confusing or wrong in the wording**?
- Did anything **break**, load slowly, or look odd on your device?

Choose **Good**, **Bad** or **Ugly**, say what you expected, and tick the box to attach your latest review.
Be blunt. A short "this entry is wrong, I'd mark 1.2650" is perfect.

### Good to know
- Weekly (W1) charts in the first days of a quarter may show no entry yet.
- Some index charts (for example the US Dollar Index) show levels to watch instead of a full entry.
- Reading a screenshot isn't exact, so a level can be a pip or so off what you read by eye.
- Running the same screenshot twice can occasionally give slightly different levels. Tell me if you see it.
- Hide account numbers and personal details in screenshots before uploading.
- Your access runs until **[END DATE]**, then the account moves to the free Starter plan (7 reviews a month).

### Need help?
Press **Give feedback**, or email **support@csaforex.com**.

---

## 4. For you: what to track while they test

- Read `beta_feedback` in Supabase (Table Editor) every day. Sort by `rating`, read the **bad** and **ugly** rows first.
- For each "wrong level" report: note pair, timeframe, date, and the tester's expected level. If it repeats,
  send it to me and I'll check it against the benchmark.
- Watch Render **Logs** for errors on analysis requests, and **Metrics -> Memory**.
- After 3 to 4 days, ask each tester one question: "Would you pay $29 a month for this? What's missing?"
- Remember MailerSend's free plan sends about 100 emails a day. Invite testers a few at a time.
