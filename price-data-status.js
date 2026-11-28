// Is the main price source answering? The answer is kept for a minute and shared, so that a public status
// address cannot be used to send it a stream of requests.
export function createPriceDataStatus({ check, ttlMs = 60000, now = Date.now, log = console.log }) {
  let last = null;
  let pending = null;
  return async function priceDataStatus() {
    if (last && now() - last.at < ttlMs) return last.status;
    if (!pending) {
      pending = (async () => {
        let up = false;
        try {
          await check();
          up = true;
        } catch (error) {
          log("[price-data-status] the main price source is not answering: " + (error?.message || error));
        }
        const at = now();
        last = { at, status: { up, checkedAt: new Date(at).toISOString() } };
        pending = null;
        return last.status;
      })();
    }
    return pending;
  };
}
