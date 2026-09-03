export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cache that serves the last good value when a refresh fails, so a transient
 * upstream error degrades freshness instead of blanking a section. Concurrent
 * callers for one key share a single in-flight request.
 */
export function createCache({ maxEntries = Infinity } = {}) {
  const store = new Map();
  const inflight = new Map();

  function remember(key, data) {
    store.delete(key);
    store.set(key, { time: Date.now(), data });
    while (store.size > maxEntries) {
      store.delete(store.keys().next().value);
    }
  }

  return async function cached(key, ttlMs, loader) {
    const hit = store.get(key);
    if (hit && Date.now() - hit.time < ttlMs) {
      return { data: hit.data, stale: false, fetchedAt: hit.time };
    }

    let pending = inflight.get(key);
    if (!pending) {
      pending = loader()
        .then((data) => {
          remember(key, data);
          return data;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }

    try {
      const data = await pending;
      return { data, stale: false, fetchedAt: store.get(key)?.time ?? Date.now() };
    } catch (err) {
      if (hit) {
        console.warn(`[cascade-dash] ${key} refresh failed, serving cached copy: ${err.message}`);
        return { data: hit.data, stale: true, fetchedAt: hit.time, error: err.message };
      }
      throw err;
    }
  };
}
