import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmBarcode, createProject as createDatabaseProject, databaseConfigured, databaseHealth, issueWorkItem, listProjects, replaceProjectRoute, resolveBarcode } from './database.mjs';

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

function constantTimeMatch(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function authUsers(config) {
  if (Array.isArray(config.users)) return config.users.filter((user) => user && user.username && user.password && user.role);
  if (config.username && config.password) return [{ username: config.username, password: config.password, displayName: 'کاربر مهندسی', role: 'engineering' }];
  return [];
}

function authSecret(config) {
  return String(config.sessionSecret || config.password || JSON.stringify(config));
}

function sessionValue(config, user, expiresAt = Date.now() + 8 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ username: user.username, role: user.role, expiresAt })).toString('base64url');
  const signature = createHmac('sha256', authSecret(config)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function validSession(req, config) {
  const cookie = String(req.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith('khatnegar_session='));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.slice('khatnegar_session='.length));
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return null; }
  if (!payload?.username || !payload?.role || !Number.isFinite(Number(payload.expiresAt)) || Number(payload.expiresAt) < Date.now()) return null;
  const user = authUsers(config).find((item) => item.username === payload.username && item.role === payload.role);
  if (!user || !constantTimeMatch(token, sessionValue(config, user, Number(payload.expiresAt)))) return null;
  return { username: user.username, displayName: user.displayName || user.username, role: user.role, scope: user.scope || null };
}

function renderLogin(res, invalid = false) {
  const error = invalid ? '<p class="login-error">نام کاربری یا رمز عبور صحیح نیست.</p>' : '';
  res.writeHead(invalid ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ورود به WPMES</title><link rel="stylesheet" href="/auth/login.css"></head><body><main class="login-shell"><section class="login-panel"><div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><span><b>WPMES</b><small>Wagon Pars Manufacturing Execution System</small></span></div><div class="login-copy"><span>IDENTITY GATEWAY</span><h1>ورود به سامانه تولید</h1><p>حساب سازمانی خود را وارد کنید.</p></div>${error}<form method="post" action="/auth/login"><label>نام کاربری<input name="username" autocomplete="username" required autofocus></label><label>رمز عبور<input name="password" type="password" autocomplete="current-password" required></label><button type="submit"><span>ورود به سامانه</span><i>←</i></button></form><div class="auth-ready"><span>LDAP</span><span>LOCAL</span><span>GOOGLE WORKSPACE</span><small>آماده اتصال به سرویس هویت سازمان</small></div><footer><span></span>اتصال رمزنگاری‌شده HTTPS<span></span></footer></section><aside class="login-visual"><div class="visual-grid"></div><div class="visual-orbit one"></div><div class="visual-orbit two"></div><div class="visual-core"><i></i><strong>01</strong><small>PHASE</small></div><div class="visual-caption"><span>PRODUCTION CONTROL SYSTEM</span><b>از هویت کاربر تا ثبت عملیات</b></div></aside></main></body></html>`);
}

async function authorizePublicRequest(req, res, pathname, isSecure) {
  if (!existsSync(publicAuthPath)) { sendJson(res, 503, { error: 'دسترسی عمومی پیکربندی نشده است.' }); return false; }
  const config = JSON.parse(readFileSync(publicAuthPath, 'utf8'));
  if ((pathname === '/rivet-ca.cer' || pathname === '/khatnegar-root-ca.cer') && req.method === 'GET') return true;
  if (pathname === '/auth/login.css' && req.method === 'GET') {
    const cssPath = join(root, 'login.css');
    if (!existsSync(cssPath)) { res.writeHead(404); res.end(); return false; }
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    createReadStream(cssPath).pipe(res);
    return false;
  }
  if (pathname === '/auth/login' && req.method === 'POST') {
    const form = new URLSearchParams(await readRaw(req));
    const user = authUsers(config).find((item) => constantTimeMatch(form.get('username') || '', item.username) && constantTimeMatch(form.get('password') || '', item.password));
    if (user) {
      const secure = isSecure ? '; Secure' : '';
      res.writeHead(303, { 'Location': '/', 'Cache-Control': 'no-store', 'Set-Cookie': `khatnegar_session=${encodeURIComponent(sessionValue(config, user))}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=28800` });
      res.end();
      return false;
    }
    renderLogin(res, true);
    return false;
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    res.writeHead(204, { 'Cache-Control': 'no-store', 'Set-Cookie': `khatnegar_session=; HttpOnly${isSecure ? '; Secure' : ''}; SameSite=Lax; Path=/; Max-Age=0` });
    res.end();
    return false;
  }
  const session = validSession(req, config);
  if (session) { req.authUser = session; return true; }
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

function validProjectSet(input) {
  return input && typeof input.name === 'string' && input.name.trim().length >= 2 &&
    typeof input.operatorRole === 'string' && input.operatorRole.trim().length >= 2 &&
    ['single', 'assembly'].includes(input.kind) && Array.isArray(input.steps) && input.steps.length <= 100 &&
    input.steps.every((step) => step && typeof step.name === 'string' && step.name.trim().length >= 2 && ['internal', 'external'].includes(step.execution));
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    sendJson(res, 200, { user: req.authUser });
    return true;
  }
  if (pathname === '/api/health' && req.method === 'GET') {
    const database = await databaseHealth();
    sendJson(res, database.configured && !database.connected ? 503 : 200, { status: database.connected || !database.configured ? 'ok' : 'degraded', service: 'factory-flow', phase: 1, tls: Boolean(req.socket.encrypted), database });
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
    if (databaseConfigured()) {
      sendJson(res, 200, { projects: await listProjects() });
      return true;
    }
    const state = await loadState();
    sendJson(res, 200, { projects: state.projects.map((project) => ({ ...project, sets: Array.isArray(project.sets) ? project.sets : [] })) });
    return true;
  }
  if (pathname === '/api/projects' && req.method === 'POST') {
    const input = await readJson(req);
    if (!input || typeof input.name !== 'string' || input.name.trim().length < 2 || typeof input.code !== 'string' || input.code.trim().length < 2 || !['single', 'assembly'].includes(input.itemType)) {
      sendJson(res, 422, { error: 'نام، کد و نوع پروژه الزامی است.' }); return true;
    }
    const normalized = {
      name: input.name.trim(), code: input.code.trim(), itemType: input.itemType,
      drawings: Array.isArray(input.drawings) ? input.drawings.map((value) => String(value).trim()).filter(Boolean).slice(0, 100) : [],
    };
    if (databaseConfigured()) {
      const project = await createDatabaseProject(normalized, req.authUser);
      sendJson(res, 201, { project });
      return true;
    }
    const state = await loadState();
    const project = {
      id: randomUUID(), ...normalized,
      sets: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    state.projects.push(project);
    await saveState(state);
    sendJson(res, 201, { project });
    return true;
  }
  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/route') && req.method === 'PUT') {
    const id = decodeURIComponent(pathname.slice('/api/projects/'.length, -'/route'.length));
    const input = await readJson(req);
    if (!input || !Array.isArray(input.sets) || input.sets.length > 100 || !input.sets.every(validProjectSet)) {
      sendJson(res, 422, { error: 'چینش مجموعه‌های پروژه کامل نیست.' }); return true;
    }
    const normalizedSets = input.sets.map((set) => ({
      id: String(set.id || randomUUID()), name: set.name.trim(), code: String(set.code || '').trim(), kind: set.kind,
      operatorRole: set.operatorRole.trim(),
      steps: set.steps.map((step) => ({
        id: String(step.id || randomUUID()), name: step.name.trim(), execution: step.execution,
        qcRequired: Boolean(step.qcRequired), productionControlRequired: Boolean(step.productionControlRequired), barcodeAfter: Boolean(step.barcodeAfter),
      })),
    }));
    if (databaseConfigured()) {
      const project = await replaceProjectRoute(id, normalizedSets, req.authUser);
      sendJson(res, 200, { project });
      return true;
    }
    const state = await loadState();
    const index = state.projects.findIndex((project) => project.id === id);
    if (index < 0) { sendJson(res, 404, { error: 'پروژه پیدا نشد.' }); return true; }
    state.projects[index] = {
      ...state.projects[index],
      sets: normalizedSets,
      updatedAt: new Date().toISOString(),
    };
    await saveState(state);
    sendJson(res, 200, { project: state.projects[index] });
    return true;
  }
  if (pathname === '/api/work-items' && req.method === 'POST') {
    if (req.authUser.role !== 'engineering' && req.authUser.role !== 'admin') { sendJson(res, 403, { error: 'صدور بارکد فقط در اختیار امور مهندسی است.' }); return true; }
    if (!databaseConfigured()) { sendJson(res, 503, { error: 'پایگاه داده تولید فعال نیست.' }); return true; }
    const input = await readJson(req);
    if (!input || typeof input.projectId !== 'string' || typeof input.setId !== 'string' || typeof input.serialNumber !== 'string' || input.serialNumber.trim().length < 2 || typeof input.barcode !== 'string' || input.barcode.trim().length < 2) {
      sendJson(res, 422, { error: 'پروژه، مجموعه، شماره سریال و بارکد الزامی است.' }); return true;
    }
    const item = await issueWorkItem({ projectId: input.projectId, setId: input.setId, serialNumber: input.serialNumber.trim(), barcode: input.barcode.trim().toUpperCase() }, req.authUser);
    sendJson(res, 201, { item });
    return true;
  }
  if (pathname === '/api/scan/confirm' && req.method === 'POST') {
    if (!databaseConfigured()) { sendJson(res, 503, { error: 'پایگاه داده تولید فعال نیست.' }); return true; }
    const input = await readJson(req);
    const sources = { camera: 'CAMERA', usb: 'USB_SCANNER', manual: 'MANUAL' };
    if (!input || typeof input.code !== 'string' || input.code.trim().length < 2 || typeof input.clientRequestId !== 'string' || !sources[input.inputSource] || (input.inputSource === 'manual' && (!input.manualReason || String(input.manualReason).trim().length < 2))) {
      sendJson(res, 422, { error: 'اطلاعات ثبت اسکن کامل نیست.' }); return true;
    }
    const result = await confirmBarcode({
      code: input.code.trim().toUpperCase(), clientRequestId: input.clientRequestId,
      inputSource: sources[input.inputSource], manualReason: input.inputSource === 'manual' ? String(input.manualReason).trim() : null,
    }, req.authUser);
    sendJson(res, 200, result);
    return true;
  }
  if (pathname.startsWith('/api/scan/') && req.method === 'GET') {
    const code = decodeURIComponent(pathname.slice('/api/scan/'.length)).trim();
    if (databaseConfigured()) {
      const scan = await resolveBarcode(code, req.authUser);
      if (!scan) { sendJson(res, 404, { error: 'برای این کد رکورد فعالی ثبت نشده است.' }); return true; }
      sendJson(res, 200, { scan });
      return true;
    }
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
    const status = error?.message === 'PAYLOAD_TOO_LARGE' ? 413 : Number(error?.statusCode || (error?.number === 2601 || error?.number === 2627 ? 409 : 400));
    const scanErrors = {
      BARCODE_NOT_FOUND: 'بارکد فعال پیدا نشد.', OPERATOR_ASSIGNMENT_REQUIRED: 'برای حساب اپراتور، مجموعه مسئولیت تعیین نشده است.',
      OPERATOR_NOT_ASSIGNED: 'این مجموعه در حوزه مسئولیت اپراتور نیست.', STEP_NOT_READY: 'این مرحله آماده تأیید اپراتور نیست.',
      QC_NOT_READY: 'قطعه هنوز در انتظار کنترل کیفیت نیست.', PRODUCTION_CONTROL_NOT_READY: 'قطعه هنوز در انتظار کنترل تولید نیست.',
      PACKAGING_NOT_READY: 'قطعه هنوز وارد مرحله پکیجینگ نشده است.', ROLE_CANNOT_SCAN: 'نقش فعلی مجوز ثبت عملیات اسکن را ندارد.',
      SET_ROUTE_NOT_FOUND: 'مسیر مجموعه پیدا نشد.', SET_ROUTE_EMPTY: 'برای این مجموعه زیرفرآیندی تعریف نشده است.',
    };
    const message = error?.message === 'ROUTE_ALREADY_IN_USE' ? 'این مسیر وارد تولید شده و باید با نسخه جدید اصلاح شود.' :
      error?.message === 'PROJECT_NOT_FOUND' ? 'پروژه پیدا نشد.' : status === 409 ? 'کد واردشده قبلاً ثبت شده است.' : 'درخواست قابل پردازش نیست.';
    console.error('Request failed', { pathname, status, code: error?.code, number: error?.number, message: error?.message });
    sendJson(res, status, { error: scanErrors[error?.message] || message });
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
