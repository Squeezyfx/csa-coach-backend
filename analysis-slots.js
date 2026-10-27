// Limits how many chart analyses run at the same time. Each analysis holds the
// uploaded image, its decoded pixels and several copies of the provider data in
// memory at once, so a few overlapping requests can push a small server past its
// memory limit. Extra requests wait their turn (they hold no image yet because the
// slot is taken before the upload is read) and are told to retry if they wait too long.

export function createAnalysisSlots({ max = 2, maxWaitMs = 120000, now = () => Date.now() } = {}) {
  let active = 0;
  const queue = [];

  function grant(entry) {
    active += 1;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      active -= 1;
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

  // Resolves with a release function, or rejects with { busy: true } after maxWaitMs.
  // A higher priority goes ahead of lower ones in the queue (equal priorities keep their order).
  function acquire({ priority = 0 } = {}) {
    return new Promise((resolve, reject) => {
      const entry = { resolve, cancelled: false, timer: null, priority };
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
    // Express middleware: take a slot, give it back when the response ends or the
    // connection closes (including a browser that gave up).
    // priorityFor(req) (optional, may be async) says who goes first when requests have to wait. It is
    // only called when this request would actually wait, so a quiet server pays nothing for it.
    middleware(onBusy, { priorityFor = null } = {}) {
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
          if (priorityFor && (active >= max || queue.length > 0)) {
            try {
              priority = Number(await priorityFor(req)) || 0;
            } catch {
              priority = 0;
            }
          }
          release = await acquire({ priority });
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
