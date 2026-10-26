// Limits how many chart review attempts one user (and the whole service) can start.
//
// The plan's monthly allowance only counts reviews that finished and were saved. A review that
// stops early (an invalid image, a read error) still pays for one or more AI calls, so a retry
// loop or a stack of bad uploads could cost money without ever using up the allowance. This
// counts every attempt that reaches the AI, over rolling windows:
//   - burst:    too many started in a short time (a stuck retry loop, a script)
//   - failures: too many that ended in an error (spamming images that are not charts)
//   - daily:    a per-plan ceiling over 24 hours
//   - global:   a ceiling for the whole service over 24 hours (a hard stop on total spend)
//
// Counts live in memory, which is enough for one server process: a restart gives everyone a
// fresh start, and the monthly allowance (stored in the database) is unaffected.
//
// The page treats an error containing "monthly", "used all", "analysis limit" or "session" as a
// plan-limit or sign-in problem, so these messages avoid those words.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_ATTEMPT_LIMITS = {
  burstMax: 8,
  burstWindowMs: 10 * MINUTE,
  failureMax: 8,
  failureWindowMs: HOUR,
  dailyMax: { starter: 15, pro: 45, elite: 90 },
  globalDailyMax: 400,
};

const positive = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ATTEMPT_BURST_MAX, ATTEMPT_BURST_MINUTES, ATTEMPT_FAILURE_MAX, ATTEMPT_FAILURE_MINUTES,
// ATTEMPT_DAILY_STARTER, ATTEMPT_DAILY_PRO, ATTEMPT_DAILY_ELITE, ATTEMPT_GLOBAL_DAILY_MAX.
export function attemptLimitsFromEnv(env = process.env) {
  const d = DEFAULT_ATTEMPT_LIMITS;
  return {
    burstMax: positive(env.ATTEMPT_BURST_MAX, d.burstMax),
    burstWindowMs: positive(env.ATTEMPT_BURST_MINUTES, d.burstWindowMs / MINUTE) * MINUTE,
    failureMax: positive(env.ATTEMPT_FAILURE_MAX, d.failureMax),
    failureWindowMs: positive(env.ATTEMPT_FAILURE_MINUTES, d.failureWindowMs / MINUTE) * MINUTE,
    dailyMax: {
      starter: positive(env.ATTEMPT_DAILY_STARTER, d.dailyMax.starter),
      pro: positive(env.ATTEMPT_DAILY_PRO, d.dailyMax.pro),
      elite: positive(env.ATTEMPT_DAILY_ELITE, d.dailyMax.elite),
    },
    globalDailyMax: positive(env.ATTEMPT_GLOBAL_DAILY_MAX, d.globalDailyMax),
  };
}

// Emails that are never limited (for example the owner testing), comma separated.
export function exemptEmailsFromEnv(env = process.env) {
  return new Set(
    String(env.ATTEMPT_LIMIT_EXEMPT_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

const minutesText = (seconds) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes >= 90) return `about ${Math.round(minutes / 60)} hours`;
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
};

export function createAttemptLimiter({ limits = DEFAULT_ATTEMPT_LIMITS, now = () => Date.now() } = {}) {
  const attempts = new Map(); // userId -> timestamps of started attempts
  const failures = new Map(); // userId -> timestamps of failed attempts
  const globalAttempts = [];

  const prune = (list, windowMs, at) => {
    while (list.length && at - list[0] >= windowMs) list.shift();
    return list;
  };
  const listFor = (map, userId) => {
    let list = map.get(userId);
    if (!list) {
      list = [];
      map.set(userId, list);
    }
    return list;
  };
  // Seconds until the oldest counted entry leaves the window.
  const waitFor = (list, windowMs, at) => Math.max(1, Math.ceil((list[0] + windowMs - at) / 1000));

  function check({ userId, plan = "starter" } = {}) {
    const at = now();
    const mine = prune(listFor(attempts, userId), DAY, at);
    const planKey = Object.hasOwn(limits.dailyMax, plan) ? plan : "starter";
    const dailyMax = limits.dailyMax[planKey];

    const burst = mine.filter((time) => at - time < limits.burstWindowMs);
    if (burst.length >= limits.burstMax) {
      const retryAfterSeconds = waitFor(burst, limits.burstWindowMs, at);
      return {
        allowed: false,
        reason: "burst",
        errorType: "attempt_burst_limit",
        retryAfterSeconds,
        message: `You have started a lot of reviews in a short time. Please wait ${minutesText(retryAfterSeconds)} and try again.`,
      };
    }

    const failed = prune(listFor(failures, userId), limits.failureWindowMs, at);
    if (failed.length >= limits.failureMax) {
      const retryAfterSeconds = waitFor(failed, limits.failureWindowMs, at);
      return {
        allowed: false,
        reason: "failures",
        errorType: "attempt_failure_limit",
        retryAfterSeconds,
        message: `Several of your recent uploads could not be reviewed. Please check that the screenshot is a clear chart with the price axis and dates visible, then try again in ${minutesText(retryAfterSeconds)}.`,
      };
    }

    if (mine.length >= dailyMax) {
      const retryAfterSeconds = waitFor(mine, DAY, at);
      return {
        allowed: false,
        reason: "daily",
        errorType: "attempt_daily_limit",
        retryAfterSeconds,
        message: `You have reached today's limit of ${dailyMax} review attempts. Your next attempt frees up in ${minutesText(retryAfterSeconds)}. For anything urgent, email support@csaforex.com.`,
      };
    }

    const everyone = prune(globalAttempts, DAY, at);
    if (everyone.length >= limits.globalDailyMax) {
      const retryAfterSeconds = waitFor(everyone, DAY, at);
      return {
        allowed: false,
        reason: "global",
        errorType: "coach_capacity_reached",
        retryAfterSeconds,
        message: "The coach has reached its capacity for today. Please try again later, or email support@csaforex.com if it is urgent.",
      };
    }

    return { allowed: true };
  }

  // An attempt that is about to use the AI.
  function record(userId) {
    const at = now();
    listFor(attempts, userId).push(at);
    globalAttempts.push(at);
  }

  // That attempt ended in an error (not a busy server or a limit).
  function recordFailure(userId) {
    listFor(failures, userId).push(now());
  }

  // Drops users with nothing left in any window (called now and then to keep memory small).
  function sweep() {
    const at = now();
    for (const [userId, list] of attempts) {
      if (!prune(list, DAY, at).length && !prune(listFor(failures, userId), limits.failureWindowMs, at).length) {
        attempts.delete(userId);
        failures.delete(userId);
      }
    }
    prune(globalAttempts, DAY, at);
  }

  return {
    check,
    record,
    recordFailure,
    sweep,
    stats: () => ({ users: attempts.size, globalLast24h: prune(globalAttempts, DAY, now()).length }),
  };
}
