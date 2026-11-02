// Switches the bonus course on and off in GoHighLevel for a subscriber.
//
// It never grants the course itself. It puts a tag on the GoHighLevel contact,
// and two workflows in GoHighLevel react to the tag:
//   tag "csa-bonus-active" added  -> workflow runs "Grant offer"
//   tag "csa-bonus-ended"  added  -> workflow runs "Revoke offer"
// Whichever tag is added, the opposite one is removed so a returning subscriber
// fires the grant workflow again.
//
// Elite subscribers get extra courses through a second pair of tags with their own workflows:
//   tag "csa-elite-active" added -> workflow grants the Elite courses
//   tag "csa-elite-ended"  added -> workflow revokes them
// They sit on top of the Pro bonus, which an Elite subscriber keeps.
//
// Needs GHL_API_KEY (a Private Integration token) and GHL_LOCATION_ID on the
// server. When either is missing every call is a harmless no-op.

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export function ghlSettings(env = process.env) {
  return {
    token: String(env.GHL_API_KEY || "").trim(),
    locationId: String(env.GHL_LOCATION_ID || "").trim(),
    activeTag: String(env.GHL_TAG_ACTIVE || "csa-bonus-active").trim(),
    endedTag: String(env.GHL_TAG_ENDED || "csa-bonus-ended").trim(),
    eliteActiveTag: String(env.GHL_TAG_ELITE_ACTIVE || "csa-elite-active").trim(),
    eliteEndedTag: String(env.GHL_TAG_ELITE_ENDED || "csa-elite-ended").trim(),
    indicatorRequestedTag: String(env.GHL_TAG_INDICATOR_REQUESTED || "csa-indicator-requested").trim(),
    signedUpTag: String(env.GHL_TAG_SIGNED_UP || "csa-signed-up").trim(),
    firstReviewTag: String(env.GHL_TAG_FIRST_REVIEW || "csa-first-review").trim(),
    limitReachedTag: String(env.GHL_TAG_FREE_LIMIT_REACHED || "csa-free-limit-reached").trim(),
  };
}

export function ghlConfigured(env = process.env) {
  const settings = ghlSettings(env);
  return Boolean(settings.token && settings.locationId);
}

async function ghlRequest(settings, fetchImpl, method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`${GHL_BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(`GoHighLevel ${method} ${path} failed: ${message}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Which course tags to send after a subscription change. bonusOn: a paid plan is active now.
// subscriptionEnded: the subscription is over. The Pro bonus follows the subscription. The Elite
// courses are switched on for an active Elite plan, and off only for someone who was Elite before
// this change (a downgrade or a cancellation), so Pro subscribers never trigger the Elite workflows.
// A past-due plan changes nothing (the payment grace period keeps the courses).
export function courseTagUpdates({ bonusOn = false, subscriptionEnded = false, newPlan = "", previousPlan = "" } = {}) {
  const updates = [];
  if (bonusOn || subscriptionEnded) updates.push({ tier: "pro", active: bonusOn });
  const eliteOn = bonusOn && newPlan === "elite";
  const eliteOff = !eliteOn && previousPlan === "elite" && (bonusOn || subscriptionEnded);
  if (eliteOn || eliteOff) updates.push({ tier: "elite", active: eliteOn });
  return updates;
}

// active=true gives the course, active=false takes it away. tier "elite" switches the Elite
// courses instead of the Pro bonus (default "pro"). Returns { ok, skipped?, error? } and never
// throws, so a GoHighLevel problem can never break the Stripe webhook that called it.
export async function setCourseAccess(
  { email, name = "", active, tier = "pro" },
  { env = process.env, fetchImpl = globalThis.fetch, log = console } = {}
) {
  const settings = ghlSettings(env);
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!settings.token || !settings.locationId) return { ok: true, skipped: "not_configured" };
  if (!cleanEmail) return { ok: false, error: "No email address on the profile." };
  if (typeof fetchImpl !== "function") return { ok: false, error: "fetch is not available." };

  try {
    const upsert = await ghlRequest(settings, fetchImpl, "POST", "/contacts/upsert", {
      locationId: settings.locationId,
      email: cleanEmail,
      ...(name ? { name: String(name).trim() } : {}),
    });
    const contactId = upsert?.contact?.id;
    if (!contactId) throw new Error("GoHighLevel did not return a contact id.");

    const onTag = tier === "elite" ? settings.eliteActiveTag : settings.activeTag;
    const offTag = tier === "elite" ? settings.eliteEndedTag : settings.endedTag;
    const addTag = active ? onTag : offTag;
    const removeTag = active ? offTag : onTag;

    await ghlRequest(settings, fetchImpl, "POST", `/contacts/${contactId}/tags`, { tags: [addTag] });
    await ghlRequest(settings, fetchImpl, "DELETE", `/contacts/${contactId}/tags`, { tags: [removeTag] });

    return { ok: true, contactId, tag: addTag };
  } catch (error) {
    log.warn?.("Course access update failed:", error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}

// A subscriber has asked for the bonus indicator on a trading account. Access is handed out by hand,
// so this tells the owner: it tags the GoHighLevel contact and a workflow in GoHighLevel reacts to
// the tag (an internal notification email to the owner, and a confirmation email to the subscriber):
//   tag "csa-indicator-requested" added -> workflow "Indicator request"
// The tag is removed first, so a second request from the same person (Elite may register three
// accounts) adds it again and fires the workflow again. The account details go on the contact as a
// note; that part is best effort. The details are always in the Supabase indicator_access table.
// Returns { ok, skipped?, error? } and never throws, so a GoHighLevel problem can never fail the request.
export async function notifyIndicatorRequest(
  { email, name = "", platform = "", accountNumber = "", broker = "" },
  { env = process.env, fetchImpl = globalThis.fetch, log = console } = {}
) {
  const settings = ghlSettings(env);
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!settings.token || !settings.locationId) return { ok: true, skipped: "not_configured" };
  if (!cleanEmail) return { ok: false, error: "No email address on the profile." };
  if (typeof fetchImpl !== "function") return { ok: false, error: "fetch is not available." };

  try {
    const upsert = await ghlRequest(settings, fetchImpl, "POST", "/contacts/upsert", {
      locationId: settings.locationId,
      email: cleanEmail,
      ...(name ? { name: String(name).trim() } : {}),
    });
    const contactId = upsert?.contact?.id;
    if (!contactId) throw new Error("GoHighLevel did not return a contact id.");

    const tag = settings.indicatorRequestedTag;
    try {
      await ghlRequest(settings, fetchImpl, "DELETE", `/contacts/${contactId}/tags`, { tags: [tag] });
    } catch {
      // Nothing to remove the first time; the add below is what matters.
    }
    await ghlRequest(settings, fetchImpl, "POST", `/contacts/${contactId}/tags`, { tags: [tag] });

    try {
      const details = [
        `Indicator requested: ${String(platform).toUpperCase() || "platform not given"} account ${accountNumber || "not given"}`,
        broker ? `Broker: ${broker}` : "",
        `Requested at ${new Date().toISOString()}`,
      ].filter(Boolean).join("\n");
      await ghlRequest(settings, fetchImpl, "POST", `/contacts/${contactId}/notes`, { body: details });
    } catch (error) {
      log.warn?.("Indicator request note failed:", error?.message || error);
    }

    return { ok: true, contactId, tag };
  } catch (error) {
    log.warn?.("Indicator request notification failed:", error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}

// Which funnel stages a free (Starter) subscriber has just reached, judged from the allowance after
// the review that was just saved. Only Starter accounts take part: paid plans and beta testers with
// a plan override are never tagged. "first_review" is the first review of the month, and
// "limit_reached" is the review that used the last of the allowance.
export function funnelStages({ effectivePlan = "", analysesUsed = 0, analysesRemaining = 1 } = {}) {
  if (effectivePlan !== "starter") return [];
  const stages = [];
  if (Number(analysesUsed) === 1) stages.push("first_review");
  if (Number(analysesRemaining) <= 0) stages.push("limit_reached");
  return stages;
}

// Whether a logged-in account should be tagged "signed_up" now: a brand-new free account that has not
// run a review yet and has not been tagged before. The age limit keeps the tag away from people who
// registered long ago, so old accounts never get a "welcome" email. taggedBefore is the marker kept on
// the Supabase user once the tag has gone through.
export function shouldTagSignup({ effectivePlan = "", analysesUsed = 0, createdAt = "", taggedBefore = false } = {}, { now = Date.now(), maxAgeDays = 7 } = {}) {
  if (taggedBefore || effectivePlan !== "starter" || Number(analysesUsed) > 0) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return now - created <= maxAgeDays * 24 * 60 * 60 * 1000;
}

// A free subscriber reached a funnel stage. Same pattern as the other tags: the tag is removed and
// added again so the matching GoHighLevel workflow can fire, and the workflow's "Allow re-entry"
// setting decides whether it can fire more than once for the same person:
//   stage "signed_up"     -> tag "csa-signed-up"
//   stage "first_review"  -> tag "csa-first-review"
//   stage "limit_reached" -> tag "csa-free-limit-reached"
// Returns { ok, skipped?, error? } and never throws, so a GoHighLevel problem can never fail a review.
export async function tagFunnelStage(
  { email, name = "", stage },
  { env = process.env, fetchImpl = globalThis.fetch, log = console } = {}
) {
  const settings = ghlSettings(env);
  const cleanEmail = String(email || "").trim().toLowerCase();
  const tag = { signed_up: settings.signedUpTag, first_review: settings.firstReviewTag, limit_reached: settings.limitReachedTag }[stage] || "";

  if (!settings.token || !settings.locationId) return { ok: true, skipped: "not_configured" };
  if (!tag) return { ok: false, error: `Unknown funnel stage: ${stage}` };
  if (!cleanEmail) return { ok: false, error: "No email address on the profile." };
  if (typeof fetchImpl !== "function") return { ok: false, error: "fetch is not available." };

  try {
    const upsert = await ghlRequest(settings, fetchImpl, "POST", "/contacts/upsert", {
      locationId: settings.locationId,
      email: cleanEmail,
      ...(name ? { name: String(name).trim() } : {}),
    });
    const contactId = upsert?.contact?.id;
    if (!contactId) throw new Error("GoHighLevel did not return a contact id.");

    try {
      await ghlRequest(settings, fetchImpl, "DELETE", `/contacts/${contactId}/tags`, { tags: [tag] });
    } catch {
      // Nothing to remove the first time; the add below is what matters.
    }
    await ghlRequest(settings, fetchImpl, "POST", `/contacts/${contactId}/tags`, { tags: [tag] });

    return { ok: true, contactId, tag };
  } catch (error) {
    log.warn?.("Funnel stage tag failed:", error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }
}
