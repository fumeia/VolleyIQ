import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { registerAuth } from './auth.js';
import { registerRoutes } from './routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR ?? path.join(here, '../../data'));
  const videosDir = path.join(dataDir, 'videos');
  fs.mkdirSync(videosDir, { recursive: true });
  const webDist = path.resolve(env.WEB_DIST ?? path.join(here, '../../web/dist'));

  const db = openDb(dataDir);
  const app = Fastify({ logger: env.NODE_ENV !== 'test', bodyLimit: 5 * 1024 * 1024, trustProxy: true });

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: Number(env.MAX_UPLOAD_MB ?? 8192) * 1024 * 1024, files: 1 },
  });

  registerAuth(app, {
    password: env.APP_PASSWORD || null,
    secret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    workerToken: env.WORKER_TOKEN || null,
    secure: env.COOKIE_SECURE === 'true',
  });

  // Serves uploaded videos (with HTTP range support) and, if built, the web app.
  const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
  await app.register(fastifyStatic, { root: hasWeb ? webDist : videosDir, serve: hasWeb, wildcard: false });

  registerRoutes(app, { db, videosDir });

  app.get('/api/health', async () => ({ ok: true }));

  // SPA fallback: unknown non-API paths render the app shell.
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/media/')) {
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
