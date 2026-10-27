# Elite courses: GoHighLevel setup

When someone subscribes to **Elite**, the server puts the tag `csa-elite-active` on their GoHighLevel
contact. When they stop being Elite (downgrade to Pro, or cancel) it puts `csa-elite-ended` on them.
Two workflows in GoHighLevel react to those tags, the same way the Pro bonus course works with
`csa-bonus-active` / `csa-bonus-ended`. The server never grants a course itself.

- An Elite subscriber keeps the Pro bonus (Forex for Beginners + the indicator) and also gets the Elite courses.
- Elite -> Pro removes only the Elite courses. Cancelling removes both.
- A payment problem (past due) changes nothing: the 7-day grace period keeps the courses.
- Pro subscribers never trigger the Elite workflows.
- Nothing happens until the workflows exist, and nothing breaks if they do not: a missing workflow just
  means no course is granted.

## Which courses

A to Z of Profitable FOREX Trading and The SECRETS to Consistent Trading cover much the same ground, so put
**one** of them in the Elite bundle (the one you prefer), plus **Fibonacci Retracement Trading**. Add
Advanced Forex Training once it is published.

## 1. Create the Elite offer (recommended)

If you grant the courses through their normal $50 offers, then **Revoke offer** on cancellation would also
take away a course someone bought on its own. To avoid that, create one separate offer for the bundle:

1. GoHighLevel -> Memberships -> Offers -> **Create offer**: name it `CSA Elite courses`.
2. Add the chosen courses to it. Price **$0**, **Published**, no expiry (the workflow removes it).
3. Save.

(The existing Pro bonus offer has the same trade-off. If someone bought Forex Made Simple on its own and
later cancels Pro, the revoke removes that offer. Use a separate $0 bonus offer there too if that matters.)

## 2. Two workflows

**Workflow `CSA Elite courses ON`**
- Trigger: **Contact Tag** -> Tag Added -> `csa-elite-active`
- Action: **Grant Offer** -> `CSA Elite courses`
- Publish.

**Workflow `CSA Elite courses OFF`**
- Trigger: **Contact Tag** -> Tag Added -> `csa-elite-ended`
- Action: **Revoke Offer** -> `CSA Elite courses`
- Publish.

## 3. Test before the server uses it

1. Make a test contact with an email you can open.
2. Add the tag `csa-elite-active` by hand. The contact should receive the courses.
3. Add `csa-elite-ended`. They should lose them. Remove the test contact afterwards.

## 4. Tag names and Render

The tag names are the defaults above. To use other names, set `GHL_TAG_ELITE_ACTIVE` and
`GHL_TAG_ELITE_ENDED` on the Render service. The existing `GHL_API_KEY` and `GHL_LOCATION_ID` are used.

In the Render logs, look for `Elite course access: <email> marked active in GoHighLevel.` after an
Elite purchase (or `... failed ...` with the reason).
