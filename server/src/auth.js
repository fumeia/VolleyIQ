import crypto from 'node:crypto';

const COOKIE = 'viq_session';
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, secret) {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Single-coach auth: one password from APP_PASSWORD. Without a password set,
 * the app is open (handy for local dev, never do this on a public server).
 * The website uses an httpOnly cookie; the Android app gets the same signed
 * session as a bearer token, since it runs on its own origin.
 */
export function registerAuth(app, { password, secret, secure }) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    if (!password) {
      req.user = { coach: true };
      return;
    }
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : req.cookies[COOKIE];
    if (verify(token, secret)) req.user = { coach: true };
  });

  app.post('/api/login', async (req, reply) => {
    if (password && !safeEqual(req.body?.password ?? '', password)) {
      return reply.code(401).send({ error: 'Wrong password' });
    }
    const token = sign({ exp: Math.floor(Date.now() / 1000) + MAX_AGE }, secret);
    reply.setCookie(COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE,
    });
    return { ok: true, token };
  });

  app.post('/api/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({
    authenticated: !!req.user?.coach,
    passwordRequired: !!password,
  }));
}

export function requireCoach(req, reply, done) {
  if (!req.user?.coach) return reply.code(401).send({ error: 'Not logged in' });
  done();
}

/** CORS for the Android app (its WebView runs on https://localhost). Bearer auth, no cookies. */
export function registerCors(app, origins) {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !origins.includes(origin)) return;
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'authorization,content-type');
      reply.header('Access-Control-Max-Age', '86400');
      return reply.code(204).send();
    }
  });
}
