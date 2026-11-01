import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { registerAuth, registerCors } from './auth.js';
import { registerRoutes } from './routes.js';
import { makeVisionScanner } from './vision.js';
import { makeInsighter } from './insights.js';
import { makeTouchChecker } from './touches.js';
import { makeUpdates } from './updates.js';
import { aiConfig, keyInfo } from './ai.js';
import { s3Config } from './s3.js';
import { makeSchedule, registerSchedule, startScheduleSync } from './schedule.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// The server only stores tags and serves the web app. Videos stay on the phone
// (or on YouTube) and analysis runs in the Android app, so this stays tiny.
const VERSION = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8')).version;

export async function buildApp(env = process.env, opts = {}) {
  const dataDir = path.resolve(env.DATA_DIR ?? path.join(here, '../../data'));
  const webDist = path.resolve(env.WEB_DIST ?? path.join(here, '../../web/dist'));

  const db = openDb(dataDir);
  const app = Fastify({ logger: env.NODE_ENV !== 'test', bodyLimit: 5 * 1024 * 1024, trustProxy: true });

  await app.register(cookie);
  registerCors(app, (env.CORS_ORIGINS ?? 'https://localhost,http://localhost,capacitor://localhost').split(',').map((s) => s.trim()));
  registerAuth(app, {
    password: env.APP_PASSWORD || null,
    secret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    secure: env.COOKIE_SECURE === 'true',
  });

  const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: webDist, wildcard: false });

  registerRoutes(app, {
    db,
    vision: opts.vision ?? makeVisionScanner(env),
    insights: opts.insights ?? makeInsighter(env),
    touches: opts.touches ?? makeTouchChecker(env),
    aiDailyLimit: Number(env.AI_DAILY_LIMIT) || 400,
    updates: opts.updates ?? makeUpdates(env),
    budget: opts.budget ?? (() => keyInfo(aiConfig(env, 'touches'))),
    aiMonthlyBudget: Number(env.AI_MONTHLY_BUDGET) || null,
    aiCurrency: env.AI_CURRENCY || '$',
    storage: opts.storage !== undefined ? opts.storage : s3Config(env),
    storageFetch: opts.storageFetch,
    transcodeHours: env.TRANSCODE_HOURS?.trim() || null,
  });

  // Team schedules from Swiss Volley, other teams' games, videos found on YouTube.
  const youtube = (opts.youtubeKey !== undefined ? opts.youtubeKey : env.YOUTUBE_API_KEY) || null;
  const schedule = makeSchedule(db, { fetchFn: opts.scheduleFetch ?? fetch, youtubeKey: youtube, ytLimit: Number(env.YOUTUBE_DAILY_QUOTA) || 10000, log: (m) => app.log.warn(m) });
  registerSchedule(app, { db, schedule, youtube });
  if (env.NODE_ENV !== 'test') {
    const stop = startScheduleSync(db, schedule, (m) => app.log.warn(m));
    app.addHook('onClose', async () => stop());
  }

  app.get('/api/health', async () => ({ ok: true, version: VERSION }));

  // SPA fallback: unknown non-API paths render the app shell.
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.sendFile('index.html', webDist);
    }
    reply.code(404).send({ error: 'Not found' });
  });

  app.addHook('onClose', () => db.close());
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' });
}
