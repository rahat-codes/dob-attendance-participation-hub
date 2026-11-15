import express from 'express';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
const PORT = Number(process.env.PORT) || 3000;

// Resolve distribution directory and cache startup existence check
const distPath = path.resolve(__dirname, 'dist');
const assetsPath = path.join(distPath, 'assets');
const indexPath = path.join(distPath, 'index.html');
const hasBuiltIndex = fs.existsSync(indexPath);

// Security headers for production serving
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  res.setHeader(
    'Content-Security-Policy-Report-Only',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://accounts.google.com wss://*.firebaseio.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; object-src 'none'; base-uri 'self'"
  );
  next();
});

// Native gzip compression for text/JS/CSS/SVG/JSON payloads without external dependencies
const COMPRESSIBLE_TYPES =
  /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/i;

app.use((req, res, next) => {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!acceptEncoding.includes('gzip') || req.method === 'HEAD') {
    return next();
  }

  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const chunks: Buffer[] = [];
  let shouldCompress: boolean | null = null;

  const detectCompressible = () => {
    if (shouldCompress !== null) return shouldCompress;
    if (res.getHeader('Content-Encoding')) {
      shouldCompress = false;
      return false;
    }
    const contentType = String(res.getHeader('Content-Type') || '');
    shouldCompress = COMPRESSIBLE_TYPES.test(contentType);
    return shouldCompress;
  };

  res.write = ((chunk: any, encoding?: any, cb?: any) => {
    if (detectCompressible() && chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      if (typeof encoding === 'function') encoding();
      else if (typeof cb === 'function') cb();
      return true;
    }
    return origWrite(chunk, encoding, cb);
  }) as typeof res.write;

  res.end = ((chunk?: any, encoding?: any, cb?: any) => {
    if (detectCompressible()) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      }
      const raw = Buffer.concat(chunks);
      if (raw.length < 1024) {
        res.setHeader('Content-Length', raw.length);
        return origEnd(raw, cb);
      }
      const compressed = zlib.gzipSync(raw, { level: 6 });
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', compressed.length);
      return origEnd(compressed, cb);
    }
    return origEnd(chunk, encoding, cb);
  }) as typeof res.end;

  next();
});

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
app.get(['/sw.js', '/manifest.webmanifest', '/index.html'], (req, res, next) => {
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
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/time', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    nowMs: Date.now(),
  });
});

// Single Page Application (SPA) catch-all fallback
app.get('*', (_req, res) => {
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
