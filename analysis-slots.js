// Limits how many chart analyses run at the same time. Each analysis holds the
// uploaded image, its decoded pixels and several copies of the provider data in
// memory at once, so a few overlapping requests can push a small server past its
// memory limit. Extra requests wait their turn (they hold no image yet because the
// slot is taken before the upload is read) and are told to retry if they wait too long.
//
// A request may carry a ticket (a random id the page makes up). position(ticket) then says whether that
// request is waiting (and how many places are ahead of it), running, or unknown, so the page can show
// "2 reviews ahead of you, about 1 minute" while it waits.

const TICKET_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const DEFAULT_REVIEW_SECONDS = 60;
const RECENT_REVIEWS_KEPT = 20;

export function normalizeQueueTicket(value) {
  const text = String(Array.isArray(value) ? value[0] : value || "").trim();
  return TICKET_PATTERN.test(text) ? text : "";
}

export function createAnalysisSlots({ max = 2, maxWaitMs = 120000, now = () => Date.now() } = {}) {
  let active = 0;
  const queue = [];
  const runningTickets = new Set();
  const recentSeconds = [];

  function grant(entry) {
    active += 1;
    const grantedAt = now();
    if (entry.ticket) runningTickets.add(entry.ticket);
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      active -= 1;
      if (entry.ticket) runningTickets.delete(entry.ticket);
      recentSeconds.push(Math.max(1, (now() - grantedAt) / 1000));
      if (recentSeconds.length > RECENT_REVIEWS_KEPT) recentSeconds.shift();
      next();
    });
  }

  function next() {
    while (active < max && queue.length) {
      const entry = queue.shift();
      clearTimeout(entry.timer);
      if (entry.cancelled) continue;
      grant(entry);
    }
  }

  // Typical time one review holds a slot: the average of the last few, or a default before any finished.
  function averageSeconds() {
    if (!recentSeconds.length) return DEFAULT_REVIEW_SECONDS;
    return recentSeconds.reduce((sum, value) => sum + value, 0) / recentSeconds.length;
  }

  // Resolves with a release function, or rejects with { busy: true } after maxWaitMs.
  // A higher priority goes ahead of lower ones in the queue (equal priorities keep their order).
  function acquire({ priority = 0, ticket = "" } = {}) {
    return new Promise((resolve, reject) => {
      const entry = { resolve, cancelled: false, timer: null, priority, ticket };
      if (active < max && queue.length === 0) {
        grant(entry);
        return;
      }
      entry.timer = setTimeout(() => {
        entry.cancelled = true;
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        reject({ busy: true });
      }, maxWaitMs);
      let at = queue.length;
      while (at > 0 && queue[at - 1].priority < priority) at -= 1;
      queue.splice(at, 0, entry);
    });
  }

  return {
    acquire,
    stats: () => ({ active, waiting: queue.length, max }),
    averageSeconds,
    // Where a request with this ticket stands. "waiting": place is 1 for the next one to start, and
    // estimatedSeconds is a rough guess from how long recent reviews held a slot.
    position(ticket) {
      const id = normalizeQueueTicket(ticket);
      if (!id) return { state: "unknown" };
      if (runningTickets.has(id)) return { state: "running", estimatedSeconds: Math.round(averageSeconds()) };
      const index = queue.findIndex((entry) => entry.ticket === id);
      if (index < 0) return { state: "unknown" };
      const rounds = Math.floor(index / max) + 1;
      return {
        state: "waiting",
        place: index + 1,
        waiting: queue.length,
        estimatedSeconds: Math.round(rounds * averageSeconds()),
      };
    },
    // Express middleware: take a slot, give it back when the response ends or the
    // connection closes (including a browser that gave up).
    // priorityFor(req) (optional, may be async) says who goes first when requests have to wait. It is
    // only called when this request would actually wait, so a quiet server pays nothing for it.
    // ticketFor(req) (optional) gives the request's ticket for position().
    middleware(onBusy, { priorityFor = null, ticketFor = null } = {}) {
      return async (req, res, nextMiddleware) => {
        let release = null;
        let finished = false;
        const done = () => {
          finished = true;
          if (release) release();
        };
        res.on("close", done);
        res.on("finish", done);
        try {
          let priority = 0;
          const ticket = ticketFor ? normalizeQueueTicket(ticketFor(req)) : "";
          if (priorityFor && (active >= max || queue.length > 0)) {
            try {
              priority = Number(await priorityFor(req)) || 0;
            } catch {
              priority = 0;
            }
          }
          release = await acquire({ priority, ticket });
          if (finished) {
            release();
            return;
          }
          nextMiddleware();
        } catch (error) {
          if (error?.busy) return onBusy(req, res);
          nextMiddleware(error);
        }
      };
    },
  };
}
