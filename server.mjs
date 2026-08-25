import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const root = join(appRoot, 'dist');
const host = process.env.HOST || '0.0.0.0';
const httpPort = Number(process.env.PORT || 8080);
const httpsPort = Number(process.env.HTTPS_PORT || 443);
const pfxPath = process.env.TLS_PFX || join(appRoot, 'certs', 'server.pfx');
const passPath = process.env.TLS_PASS_FILE || join(appRoot, 'certs', 'tls.pass');
const caPath = join(appRoot, 'certs', 'rivet-ca.cer');
const dataDir = join(appRoot, 'data');
const statePath = join(dataDir, 'state.json');
const publicAuthPath = join(appRoot, 'secrets', 'public-auth.json');

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon'],
  ['.cer', 'application/pkix-cert'],
]);

function secureHeaders(res, isTls) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (isTls) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function publicRequest(req) {
  const hostHeader = String(req.headers.host || '').toLowerCase();
  const requestHost = hostHeader.startsWith('[') ? hostHeader.slice(1, hostHeader.indexOf(']')) : hostHeader.split(':')[0];
  const isPrivateEndpoint = requestHost === '172.30.197.93' || requestHost === '127.0.0.1' || requestHost === 'localhost' || requestHost === '::1';
  return !isPrivateEndpoint;
}

function constantTimeMatch(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionValue(config, expiresAt = Date.now() + 8 * 60 * 60 * 1000) {
  const payload = `${config.username}.${expiresAt}`;
  const signature = createHmac('sha256', config.password).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function validSession(req, config) {
  const cookie = String(req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith('khatnegar_session='));
  if (!cookie) return false;
  const token = decodeURIComponent(cookie.slice('khatnegar_session='.length));
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== config.username || !Number.isFinite(Number(parts[1])) || Number(parts[1]) < Date.now()) return false;
  return constantTimeMatch(token, sessionValue(config, Number(parts[1])));
}

function renderLogin(res, invalid = false) {
  const error = invalid ? '<p class="login-error">نام کاربری یا رمز عبور صحیح نیست.</p>' : '';
  res.writeHead(invalid ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ورود به خط‌نگار</title><link rel="stylesheet" href="/auth/login.css"></head><body><main class="login-shell"><section class="login-panel"><div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><span><b>خط‌نگار</b><small>سامانه کنترل تولید</small></span></div><div class="login-copy"><span>درگاه امن سامانه</span><h1>ورود به فضای عملیاتی</h1><p>برای ادامه، اطلاعات دسترسی ارائه را وارد کنید.</p></div>${error}<form method="post" action="/auth/login"><label>نام کاربری<input name="username" autocomplete="username" required autofocus></label><label>رمز عبور<input name="password" type="password" autocomplete="current-password" required></label><button type="submit"><span>ورود به سامانه</span><i>←</i></button></form><footer><span></span>اتصال رمزنگاری‌شده HTTPS<span></span></footer></section><aside class="login-visual"><div class="visual-grid"></div><div class="visual-orbit one"></div><div class="visual-orbit two"></div><div class="visual-core"><i></i><strong>01</strong><small>PHASE</small></div><div class="visual-caption"><span>PRODUCTION CONTROL SYSTEM</span><b>جریان تولید، دقیق و قابل پیگیری</b></div></aside></main></body></html>`);
}

async function authorizePublicRequest(req, res, pathname, isSecure) {
  if (!publicRequest(req)) return true;
  if (!existsSync(publicAuthPath)) { sendJson(res, 503, { error: 'دسترسی عمومی پیکربندی نشده است.' }); return false; }
  const config = JSON.parse(readFileSync(publicAuthPath, 'utf8'));
  if (pathname === '/auth/login.css' && req.method === 'GET') {
    const cssPath = join(root, 'login.css');
    if (!existsSync(cssPath)) { res.writeHead(404); res.end(); return false; }
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    createReadStream(cssPath).pipe(res);
    return false;
  }
  if (pathname === '/auth/login' && req.method === 'POST') {
    const form = new URLSearchParams(await readRaw(req));
    if (constantTimeMatch(form.get('username') || '', config.username) && constantTimeMatch(form.get('password') || '', config.password)) {
      const secure = isSecure ? '; Secure' : '';
      res.writeHead(303, { 'Location': '/', 'Cache-Control': 'no-store', 'Set-Cookie': `khatnegar_session=${encodeURIComponent(sessionValue(config))}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=28800` });
      res.end();
      return false;
    }
    renderLogin(res, true);
    return false;
  }
  if (validSession(req, config)) return true;
  if (pathname.startsWith('/api/')) sendJson(res, 401, { error: 'نشست ورود معتبر نیست.' }); else renderLogin(res);
  return false;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const empty = { sets: [], projects: [], items: [] };
    await mkdir(dataDir, { recursive: true });
    await writeFile(statePath, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
}

async function saveState(value) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(value, null, 2), 'utf8');
}

async function readRaw(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65536) throw new Error('PAYLOAD_TOO_LARGE');
  }
  return raw;
}

async function readJson(req) {
  return JSON.parse(await readRaw(req) || '{}');
}

function validSet(input) {
  return input && typeof input.name === 'string' && input.name.trim().length >= 2 &&
    ['single', 'assembly'].includes(input.kind) && Array.isArray(input.steps) && input.steps.length <= 100;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', service: 'factory-flow', phase: 1, tls: Boolean(req.socket.encrypted) });
    return true;
  }
  if (pathname === '/api/sets' && req.method === 'GET') {
    const state = await loadState();
    sendJson(res, 200, { sets: state.sets });
    return true;
  }
  if (pathname === '/api/sets' && req.method === 'POST') {
    const input = await readJson(req);
    if (!validSet(input)) { sendJson(res, 422, { error: 'اطلاعات مجموعه کامل نیست.' }); return true; }
    const state = await loadState();
    const set = {
      id: randomUUID(), name: input.name.trim(), code: String(input.code || '').trim(),
      kind: input.kind, steps: input.steps, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    state.sets.push(set);
    await saveState(state);
    sendJson(res, 201, { set });
    return true;
  }
  if (pathname.startsWith('/api/sets/') && req.method === 'PUT') {
    const id = pathname.slice('/api/sets/'.length);
    const input = await readJson(req);
    if (!validSet(input)) { sendJson(res, 422, { error: 'اطلاعات مجموعه کامل نیست.' }); return true; }
    const state = await loadState();
    const index = state.sets.findIndex((item) => item.id === id);
    if (index < 0) { sendJson(res, 404, { error: 'مجموعه پیدا نشد.' }); return true; }
    state.sets[index] = { ...state.sets[index], name: input.name.trim(), code: String(input.code || '').trim(), kind: input.kind, steps: input.steps, updatedAt: new Date().toISOString() };
    await saveState(state);
    sendJson(res, 200, { set: state.sets[index] });
    return true;
  }
  if (pathname === '/api/projects' && req.method === 'GET') {
    const state = await loadState();
    sendJson(res, 200, { projects: state.projects });
    return true;
  }
  if (pathname === '/api/projects' && req.method === 'POST') {
    const input = await readJson(req);
    if (!input || typeof input.name !== 'string' || input.name.trim().length < 2 || typeof input.code !== 'string' || input.code.trim().length < 2 || !['single', 'assembly'].includes(input.itemType)) {
      sendJson(res, 422, { error: 'نام، کد و نوع پروژه الزامی است.' }); return true;
    }
    const state = await loadState();
    const project = {
      id: randomUUID(), name: input.name.trim(), code: input.code.trim(), itemType: input.itemType,
      drawings: Array.isArray(input.drawings) ? input.drawings.map((value) => String(value).trim()).filter(Boolean).slice(0, 100) : [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    state.projects.push(project);
    await saveState(state);
    sendJson(res, 201, { project });
    return true;
  }
  if (pathname.startsWith('/api/scan/') && req.method === 'GET') {
    const code = decodeURIComponent(pathname.slice('/api/scan/'.length)).trim();
    const state = await loadState();
    const item = state.items.find((entry) => entry.code === code);
    if (!item) { sendJson(res, 404, { error: 'برای این کد رکوردی ثبت نشده است.' }); return true; }
    sendJson(res, 200, { item });
    return true;
  }
  return false;
}

async function handle(req, res, isTls) {
  const pathname = new URL(req.url || '/', 'http://local').pathname;
  const isSecure = isTls || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  secureHeaders(res, isSecure);
  if (!await authorizePublicRequest(req, res, pathname, isSecure)) return;
  try {
    if (pathname.startsWith('/api/') && await handleApi(req, res, pathname)) return;
  } catch (error) {
    sendJson(res, error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: 'درخواست قابل پردازش نیست.' });
    return;
  }
  if ((pathname === '/rivet-ca.cer' || pathname === '/khatnegar-root-ca.cer') && existsSync(caPath)) {
    res.writeHead(200, { 'Content-Type': 'application/pkix-cert', 'Content-Disposition': 'attachment; filename="Khatnegar-Local-Root-CA.cer"', 'Cache-Control': 'no-store' });
    createReadStream(caPath).pipe(res);
    return;
  }
  const rawPath = decodeURIComponent(pathname);
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(root, 'index.html');
  }
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  const extension = extname(filePath);
  res.writeHead(200, {
    'Content-Type': mime.get(extension) || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

createHttpServer((req, res) => handle(req, res, false)).listen(httpPort, host, () => {
  console.log(`Factory Flow fallback listening on http://${host}:${httpPort}`);
});

if (!existsSync(pfxPath) || !existsSync(passPath)) {
  console.error('TLS certificate is missing; HTTPS was not started.');
} else {
  const tls = { pfx: readFileSync(pfxPath), passphrase: readFileSync(passPath, 'utf8').trim(), minVersion: 'TLSv1.2' };
  createHttpsServer(tls, (req, res) => handle(req, res, true)).listen(httpsPort, host, () => {
    console.log(`Factory Flow secure endpoint listening on https://${host}:${httpsPort}`);
  });
}
