import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Resolve distribution directory
const distPath = path.resolve(__dirname, 'dist');
const indexPath = path.join(distPath, 'index.html');

// Serve static assets with caching
app.use(express.static(distPath, {
  maxAge: '1d',
  index: false,
}));

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
  if (fs.existsSync(indexPath)) {
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
