/**
 * Client-to-server clock offset synchronizer powered by GET /api/time.
 * Keeps client-side session window & present/late decisions aligned with server time.
 */

let serverOffsetMs = 0;
let lastSyncedAtMs = 0;
let inFlightSync: Promise<number> | null = null;

export function computeClockOffsetMs(
  clientBeforeMs: number,
  serverNowMs: number,
  clientAfterMs: number
): number {
  const clientMidMs = Math.round((clientBeforeMs + clientAfterMs) / 2);
  return serverNowMs - clientMidMs;
}

export function getServerOffsetMs(): number {
  return serverOffsetMs;
}

export function setServerOffsetMs(offsetMs: number): void {
  if (Number.isFinite(offsetMs)) {
    serverOffsetMs = Math.round(offsetMs);
    lastSyncedAtMs = Date.now();
  }
}

export function resetServerTimeOffset(): void {
  serverOffsetMs = 0;
  lastSyncedAtMs = 0;
  inFlightSync = null;
}

export function getCorrectedNowMs(localNowMs: number = Date.now()): number {
  return localNowMs + serverOffsetMs;
}

export function getCorrectedNow(): Date {
  return new Date(getCorrectedNowMs());
}

export async function syncServerTimeOffset(
  fetchImpl?: typeof fetch
): Promise<number> {
  const activeFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!activeFetch) {
    return serverOffsetMs;
  }

  if (inFlightSync && !fetchImpl) {
    return inFlightSync;
  }

  const run = async (): Promise<number> => {
    try {
      const clientBeforeMs = Date.now();
      const res = await activeFetch('/api/time', {
        method: 'GET',
        cache: 'no-store',
      });
      const clientAfterMs = Date.now();
      if (!res.ok) {
        return serverOffsetMs;
      }
      const contentType = res.headers?.get?.('content-type')?.toLowerCase();
      if (contentType && !contentType.includes('application/json')) {
        return serverOffsetMs;
      }
      const data = (await res.json()) as { nowMs?: unknown };
      if (typeof data?.nowMs === 'number' && Number.isFinite(data.nowMs)) {
        const computed = computeClockOffsetMs(clientBeforeMs, data.nowMs, clientAfterMs);
        serverOffsetMs = computed;
        lastSyncedAtMs = clientAfterMs;
      }
    } catch {
      // Non-fatal: keep last known offset (default 0) if /api/time is unreachable
    }
    return serverOffsetMs;
  };

  if (fetchImpl) {
    return run();
  }

  inFlightSync = run().finally(() => {
    inFlightSync = null;
  });
  return inFlightSync;
}

export async function ensureFreshServerTimeOffset(
  maxAgeMs: number = 5 * 60 * 1000
): Promise<number> {
  if (lastSyncedAtMs > 0 && Date.now() - lastSyncedAtMs <= maxAgeMs) {
    return serverOffsetMs;
  }
  return syncServerTimeOffset();
}
