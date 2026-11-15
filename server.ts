import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

// Resolve distribution directory and cache startup existence check
const distPath = path.resolve(__dirname, 'dist');
const assetsPath = path.join(distPath, 'assets');
const indexPath = path.join(distPath, 'index.html');
const hasBuiltIndex = fs.existsSync(indexPath);

// JSON request logger (method, path without query, status, duration ms; never logs query tokens)
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      JSON.stringify({
        type: 'http_request',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Number(ms.toFixed(2)),
      })
    );
  });
  next();
});

// Security headers (plus HSTS when served over HTTPS) & CSP Report-Only pointing to /api/csp-report
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  const proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (req.secure || proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader(
    'Content-Security-Policy-Report-Only',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://accounts.google.com wss://*.firebaseio.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; object-src 'none'; base-uri 'self'; report-uri /api/csp-report"
  );
  next();
});

// Standard gzip/deflate compression (1 KB threshold; explicitly skip 206 partial / Content-Range)
app.use(
  compression({
    threshold: 1024,
    filter(req, res) {
      if (res.statusCode === 206 || res.getHeader('Content-Range')) {
        return false;
      }
      if (req.path === '/api/csp-report') {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

// Rate-limited, size-capped CSP Report-Only collector
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

app.post(
  '/api/csp-report',
  (req, res, next) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    if (!allowCspReportIp(clientIp)) {
      return res.status(429).json({ error: 'Too many reports' });
    }
    next();
  },
  express.json({ type: ['application/csp-report', 'application/json'], limit: '8kb' }),
  (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
    const report = (body['csp-report'] && typeof body['csp-report'] === 'object'
      ? body['csp-report']
      : body) as Record<string, any>;

    console.log(
      JSON.stringify({
        type: 'csp_report',
        violatedDirective: String(report['violated-directive'] || report.violatedDirective || '').slice(0, 80),
        effectiveDirective: String(report['effective-directive'] || report.effectiveDirective || '').slice(0, 80),
        blockedUri: stripUriQuery(report['blocked-uri'] || report.blockedURI || report.blockedUri),
        disposition: String(report.disposition || 'report').slice(0, 20),
      })
    );
    res.status(204).end();
  }
);

// Immutable long-lived cache for hashed build assets; never fall through to SPA HTML on missing asset
app.use(
  '/assets',
  express.static(assetsPath, {
    maxAge: '365d',
    immutable: true,
    index: false,
    fallthrough: true,
  })
);
app.use('/assets', (_req, res) => {
  res.status(404).type('text/plain').send('Asset not found');
});

// No-cache for service worker & HTML/manifest entry files so new deployments propagate immediately
app.get(['/sw.js', '/manifest.webmanifest', '/index.html'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  next();
});

// Serve remaining static files in dist/ with conservative cache lifetime
app.use(
  express.static(distPath, {
    maxAge: '1d',
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  })
);

// Health check endpoints for Cloud Run and container monitoring
app.get(['/_healthz', '/healthz'], (_req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/time', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    nowMs: Date.now(),
  });
});

// Single Page Application (SPA) catch-all fallback (returns 404 for unknown paths with file extensions)
app.get('*', (req, res) => {
  if (path.extname(req.path)) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  if (hasBuiltIndex || fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Den of Builders</title></head>
        <body style="font-family: sans-serif; background: #000; color: #fff; text-align: center; padding: 50px;">
          <h1>Den of Builders Hub</h1>
          <p>Application is building assets. Please refresh in a moment.</p>
        </body>
      </html>
    `);
  }
});

// Centralized error handler (never exposes stack traces; JSON for /api, plain text otherwise)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const statusCode =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 500;

  console.error(
    JSON.stringify({
      type: 'http_error',
      method: req.method,
      path: req.path,
      status: statusCode,
      code: String(err?.type || err?.code || 'INTERNAL_ERROR').slice(0, 64),
    })
  );

  if (res.headersSent) {
    return;
  }

  const publicMessage =
    statusCode === 413
      ? 'Payload too large'
      : statusCode === 400
      ? 'Invalid request payload'
      : 'Internal server error';

  if (req.path.startsWith('/api/')) {
    res.status(statusCode).json({ error: publicMessage });
  } else {
    res.status(statusCode).type('text/plain').send(publicMessage);
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Production Server] Den of Builders running on http://0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, closing server cleanly...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, closing server cleanly...');
  server.close(() => {
    process.exit(0);
  });
});
