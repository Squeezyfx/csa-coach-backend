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
