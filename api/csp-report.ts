interface VercelRequestLike {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelResponseLike {
  status(code: number): VercelResponseLike;
  setHeader(name: string, value: string): VercelResponseLike;
  json(body: unknown): void;
  end(body?: string): void;
}

const cspRateBuckets = new Map<string, { count: number; resetAt: number }>();
const CSP_WINDOW_MS = 60_000;
const CSP_MAX_PER_WINDOW = 20;

function allowCspReportIp(ip: string, nowMs: number = Date.now()): boolean {
  if (cspRateBuckets.size > 1000) {
    for (const [k, v] of cspRateBuckets) {
      if (v.resetAt <= nowMs) cspRateBuckets.delete(k);
    }
  }
  const existing = cspRateBuckets.get(ip);
  if (!existing || existing.resetAt <= nowMs) {
    cspRateBuckets.set(ip, { count: 1, resetAt: nowMs + CSP_WINDOW_MS });
    return true;
  }
  if (existing.count >= CSP_MAX_PER_WINDOW) {
    return false;
  }
  existing.count += 1;
  return true;
}

function stripUriQuery(value: unknown): string {
  if (typeof value !== 'string') return '';
  const qIdx = value.indexOf('?');
  const hIdx = value.indexOf('#');
  const cut = Math.min(qIdx === -1 ? value.length : qIdx, hIdx === -1 ? value.length : hIdx);
  return value.slice(0, cut).slice(0, 200);
}

export default function handler(req: VercelRequestLike, res: VercelResponseLike): void {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const forwarded = req.headers?.['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded || 'unknown';
  const clientIp = String(rawIp).split(',')[0].trim() || 'unknown';

  if (!allowCspReportIp(clientIp)) {
    res.status(429).json({ error: 'Too many reports' });
    return;
  }

  let parsed: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    if (req.body.length > 8192) {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }
    try {
      const json = JSON.parse(req.body);
      if (json && typeof json === 'object') {
        parsed = json as Record<string, unknown>;
      }
    } catch {
      res.status(400).json({ error: 'Invalid request payload' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    parsed = req.body as Record<string, unknown>;
  }

  const nested =
    parsed['csp-report'] && typeof parsed['csp-report'] === 'object'
      ? (parsed['csp-report'] as Record<string, unknown>)
      : parsed;

  console.log(
    JSON.stringify({
      type: 'csp_report',
      violatedDirective: String(nested['violated-directive'] || nested.violatedDirective || '').slice(0, 80),
      effectiveDirective: String(nested['effective-directive'] || nested.effectiveDirective || '').slice(0, 80),
      blockedUri: stripUriQuery(nested['blocked-uri'] || nested.blockedURI || nested.blockedUri),
      disposition: String(nested.disposition || 'report').slice(0, 20),
    })
  );

  res.status(204).end();
}
