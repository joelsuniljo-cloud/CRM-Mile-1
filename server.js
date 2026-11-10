import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { readSite, SiteError } from './lib/fetchsite.js';
import { askJson, aiConfigured, AiError } from './lib/ai.js';
import { seedExamples } from './lib/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PASSWORD = process.env.APP_PASSWORD || '';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

if (process.env.NODE_ENV === 'production' && !PASSWORD) {
  console.error('APP_PASSWORD must be set in production. This app holds client data and spends API credit.');
  process.exit(1);
}

const store = await createStore();
if (process.env.SEED_EXAMPLES === 'true') {
  const n = await seedExamples(store, { onlyIfEmpty: true });
  if (n) console.log(`Seeded ${n} example prospects (remove them from the app when you are done).`);
}
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Render's health check. No data, so it sits before the password.
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// One shared password over HTTP Basic auth. Any username works.
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (!PASSWORD) return next();
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (crypto.timingSafeEqual(digest(given), digest(PASSWORD))) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Mile 1 Outreach", charset="UTF-8"');
  res.status(401).send('Sign in required');
});

// Small in-memory limiter for the routes that cost money or make outbound requests.
const hits = new Map();
function limit(perMinute) {
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
    if (arr.length >= perMinute) return res.status(429).json({ code: 'rate_limited', message: 'Slow down for a minute.' });
    arr.push(now);
    hits.set(req.ip, arr);
    next();
  };
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const bad = (res, code, message, status = 400) => res.status(status).json({ code, message });

// ---- clients ----
app.get('/api/clients', async (_req, res) => {
  res.json({ docs: await store.list('clients') });
});
app.put('/api/clients/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return bad(res, 'invalid_argument', 'Bad id.');
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return bad(res, 'invalid_argument', 'Body must be an object.');
  await store.set('clients', req.params.id, req.body);
  res.status(204).end();
});
app.patch('/api/clients/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return bad(res, 'invalid_argument', 'Bad id.');
  const ok = await store.patch('clients', req.params.id, req.body || {});
  if (!ok) return bad(res, 'not_found', 'No such prospect.', 404);
  res.status(204).end();
});
app.delete('/api/clients/:id', async (req, res) => {
  if (!ID_RE.test(req.params.id)) return bad(res, 'invalid_argument', 'Bad id.');
  await store.del('clients', req.params.id);
  res.status(204).end();
});

// ---- sender profile ----
app.get('/api/settings', async (_req, res) => {
  const data = await store.get('settings', 'profile');
  res.json({ exists: Boolean(data), data: data || null });
});
app.put('/api/settings', async (req, res) => {
  await store.set('settings', 'profile', req.body || {});
  res.status(204).end();
});

// ---- AI ----
app.post('/api/sample', limit(30), async (req, res) => {
  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) return bad(res, 'invalid_request', 'prompt is required.');
  if (prompt.length > 100_000) return bad(res, 'prompt_too_large', 'Prompt is too long.', 413);
  try {
    res.json({ value: await askJson(prompt) });
  } catch (e) {
    if (e instanceof AiError) return bad(res, e.code, e.message, e.status);
    console.error(e);
    bad(res, 'upstream_error', 'Something went wrong.', 500);
  }
});

// ---- website reader ----
app.post('/api/fetch-site', limit(20), async (req, res) => {
  try {
    res.json(await readSite(req.body && req.body.url));
  } catch (e) {
    if (e instanceof SiteError) return bad(res, 'site_error', e.message, 422);
    console.error(e);
    bad(res, 'site_error', 'Could not read that website.', 500);
  }
});

app.get('/api/status', (_req, res) => res.json({ store: store.kind, ai: aiConfigured(), password: Boolean(PASSWORD) }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ code: 'upstream_error', message: 'Server error.' });
});

app.listen(PORT, () => {
  console.log(`Mile 1 Outreach on :${PORT}  store=${store.kind}  ai=${aiConfigured() ? 'on' : 'OFF (set GEMINI_API_KEY)'}  password=${PASSWORD ? 'on' : 'OFF'}`);
});
