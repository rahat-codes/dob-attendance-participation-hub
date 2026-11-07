/**
 * Deduplicates in-flight asynchronous operations by key.
 * If a promise is already in flight for a given key, subsequent calls with that key
 * will await and share the same promise rather than starting a duplicate execution.
 */
const flightMap = new Map<string, Promise<any>>();

export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = flightMap.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      flightMap.delete(key);
    }
  })();

  flightMap.set(key, promise);
  return promise;
}

/**
 * Resets or clears in-flight flight tracking (primarily useful for unit testing).
 */
export function clearSingleFlight(key?: string): void {
  if (key) {
    flightMap.delete(key);
  } else {
    flightMap.clear();
  }
}
