import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmBarcode, createProject as createDatabaseProject, databaseConfigured, databaseHealth, deleteProject as deleteDatabaseProject, issueWorkItem, listProjects, replaceProjectRoute, resolveBarcode, saveProjectProfile as saveDatabaseProjectProfile } from './database.mjs';

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
  if (Array.isArray(config.users)) return config.users.filter((user) => user && user.username && (user.password || user.passwordHash) && user.role);
  if (config.username && config.password) return [{ username: config.username, password: config.password, displayName: 'کاربر مهندسی', role: 'engineering' }];
  return [];
}

function passwordHash(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = scryptSync(String(password), salt, 32).toString('base64url');
  return `scrypt$${salt}$${derived}`;
}

function passwordMatches(user, password) {
  if (user.passwordHash) {
    const [scheme, salt, expected] = String(user.passwordHash).split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const actual = scryptSync(String(password), salt, 32).toString('base64url');
    return constantTimeMatch(actual, expected);
  }
  return constantTimeMatch(password, user.password || '');
}

const permissionCatalog = new Set(['projects', 'project_create', 'engineering', 'production_flow', 'scanner', 'qc', 'production_control', 'packaging', 'access_matrix']);
const rolePermissionDefaults = {
  operator: ['scanner'], qc: ['projects', 'scanner', 'qc'], production: ['scanner', 'production_control'],
  packaging: ['scanner', 'packaging'], engineering: ['projects', 'engineering'],
  admin: [...permissionCatalog],
};

function permissionsFor(user) {
  if (user.role === 'admin') return [...permissionCatalog];
  const permissions = Array.isArray(user.permissions)
    ? user.permissions.map((value) => String(value)).filter((value) => permissionCatalog.has(value))
    : rolePermissionDefaults[user.role] || [];
  if (user.role === 'qc') permissions.push('projects', 'scanner', 'qc');
  return [...new Set(permissions)];
}

function hasPermission(actor, permission) {
  return actor?.accountRole === 'admin' || actor?.role === 'admin' || actor?.permissions?.includes(permission);
}

function hasScanRolePermission(actor) {
  if (!hasPermission(actor, 'scanner')) return false;
  if (actor.role === 'qc') return hasPermission(actor, 'qc');
  if (actor.role === 'production') return hasPermission(actor, 'production_control');
  if (actor.role === 'packaging') return hasPermission(actor, 'packaging');
  return actor.role === 'operator' || actor.accountRole === 'admin';
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
  return { username: user.username, displayName: user.displayName || user.username, role: user.role, scope: user.scope || null, permissions: permissionsFor(user) };
}

const delegatedAdminRoles = new Set(['engineering', 'operator', 'qc', 'production', 'packaging']);

function requestActor(session, req) {
  if (session.role !== 'admin') return session;
  const requestedRole = String(req.headers['x-wpmes-role'] || 'engineering').toLowerCase();
  const role = delegatedAdminRoles.has(requestedRole) ? requestedRole : 'engineering';
  return { ...session, role, accountRole: 'admin', scope: role === 'operator' ? '*' : session.scope, permissions: [...permissionCatalog] };
}

function renderLogin(res, invalid = false) {
  const error = invalid ? '<p class="login-error">نام کاربری یا رمز عبور صحیح نیست.</p>' : '';
  const templatePath = join(root, 'login-page.html');
  const template = readFileSync(templatePath, 'utf8').replace('{{ERROR}}', error);
  res.writeHead(invalid ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Clear-Site-Data': '"cache"' });
  res.end(template);
}

async function authorizePublicRequest(req, res, pathname, isSecure) {
  if (!existsSync(publicAuthPath)) { sendJson(res, 503, { error: 'دسترسی عمومی پیکربندی نشده است.' }); return false; }
  const config = JSON.parse(readFileSync(publicAuthPath, 'utf8'));
  if ((pathname === '/rivet-ca.cer' || pathname === '/khatnegar-root-ca.cer') && req.method === 'GET') return true;
  if (['/auth/login.css', '/auth/login-signature-v4.css'].includes(pathname) && req.method === 'GET') {
    const cssPath = join(root, 'login.css');
    if (!existsSync(cssPath)) { res.writeHead(404); res.end(); return false; }
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
    createReadStream(cssPath).pipe(res);
    return false;
  }
  if (pathname === '/auth/login' && req.method === 'POST') {
    const form = new URLSearchParams(await readRaw(req));
    const user = authUsers(config).find((item) => constantTimeMatch(form.get('username') || '', item.username) && passwordMatches(item, form.get('password') || ''));
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
  if (session) { req.authUser = requestActor(session, req); return true; }
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
    if (raw.length > 5 * 1024 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
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

function defaultAssemblySets() {
  return [
    ['MONTAGE', 'مونتاژ'], ['WELDING', 'جوش'], ['SANDBLAST', 'سندبلاست'],
    ['INTERMEDIATE-PAINT', 'رنگ میانی'], ['FINAL-PAINT', 'رنگ نهایی'], ['PACKAGING', 'بسته‌بندی'],
  ].map(([code, name]) => ({
    id: randomUUID(), name, code, kind: 'assembly', operatorRole: name,
    steps: [{ id: randomUUID(), name, execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }],
  }));
}

function normalizeProjectProfile(input) {
  if (!input || !Array.isArray(input.componentDrawings) || input.componentDrawings.length > 5000 || !Array.isArray(input.importedHeaders) || input.importedHeaders.length > 80 || !Array.isArray(input.importedRows) || input.importedRows.length > 3000) return null;
  const componentDrawings = input.componentDrawings.map((item) => ({
    id: String(item?.id || randomUUID()), drawingNumber: String(item?.drawingNumber || '').trim().slice(0, 100),
    description: String(item?.description || '').trim().slice(0, 250),
  })).filter((item) => item.drawingNumber);
  const importedHeaders = input.importedHeaders.map((value) => String(value || '').trim().slice(0, 120)).filter(Boolean);
  const importedRows = input.importedRows.map((row) => Object.fromEntries(importedHeaders.map((header) => [header, String(row?.[header] ?? '').slice(0, 1000)])));
  return {
    mainDrawingNumber: String(input.mainDrawingNumber || '').trim().slice(0, 100), componentDrawings,
    customFields: input.customFields && typeof input.customFields === 'object' && !Array.isArray(input.customFields) ? input.customFields : {},
    importedHeaders, importedRows, sourceFileName: String(input.sourceFileName || '').trim().slice(0, 260),
  };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    sendJson(res, 200, { user: req.authUser });
    return true;
  }
  if (pathname === '/api/admin/access-matrix' && req.method === 'GET') {
    if (req.authUser.accountRole !== 'admin' && req.authUser.role !== 'admin') { sendJson(res, 403, { error: 'این بخش فقط در اختیار مدیر کل سامانه است.' }); return true; }
    const config = JSON.parse(readFileSync(publicAuthPath, 'utf8'));
    const users = authUsers(config).map((user) => ({
      username: user.username, displayName: user.displayName || user.username, role: user.role,
      scope: user.scope || '', permissions: permissionsFor(user), isAdmin: user.role === 'admin',
    }));
    sendJson(res, 200, { users, permissions: [...permissionCatalog] });
    return true;
  }
  if (pathname === '/api/admin/access-matrix' && req.method === 'PUT') {
    if (req.authUser.accountRole !== 'admin' && req.authUser.role !== 'admin') { sendJson(res, 403, { error: 'این بخش فقط در اختیار مدیر کل سامانه است.' }); return true; }
    const input = await readJson(req);
    if (!input || !Array.isArray(input.users) || input.users.length > 200) { sendJson(res, 422, { error: 'ماتریس دسترسی معتبر نیست.' }); return true; }
    const config = JSON.parse(readFileSync(publicAuthPath, 'utf8'));
    const updates = new Map(input.users.map((user) => [String(user?.username || ''), user]));
    const validRoles = new Set(['operator', 'qc', 'production', 'packaging', 'engineering', 'admin']);
    config.users = authUsers(config).map((user) => {
      const update = updates.get(user.username);
      if (!update || user.role === 'admin') return user;
      const role = validRoles.has(update.role) && update.role !== 'admin' ? update.role : user.role;
      const permissions = Array.isArray(update.permissions)
        ? [...new Set(update.permissions.map((value) => String(value)).filter((value) => permissionCatalog.has(value) && value !== 'access_matrix'))]
        : permissionsFor(user);
      return { ...user, role, scope: String(update.scope || '').trim() || null, permissions };
    });
    await writeFile(publicAuthPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    sendJson(res, 200, { users: config.users.map((user) => ({ username: user.username, displayName: user.displayName || user.username, role: user.role, scope: user.scope || '', permissions: permissionsFor(user), isAdmin: user.role === 'admin' })) });
    return true;
  }
  if (pathname === '/api/admin/users' && req.method === 'POST') {
    if (req.authUser.accountRole !== 'admin' && req.authUser.role !== 'admin') { sendJson(res, 403, { error: 'این بخش فقط در اختیار مدیر کل سامانه است.' }); return true; }
    const input = await readJson(req);
    const username = String(input?.username || '').trim().toLowerCase();
    const displayName = String(input?.displayName || '').trim();
    const role = String(input?.role || 'operator');
    const scope = String(input?.scope || '').trim().slice(0, 120);
    const password = String(input?.password || '');
    const validRoles = new Set(['operator', 'qc', 'production', 'packaging', 'engineering']);
    if (!/^[a-z0-9._-]{3,60}$/.test(username) || displayName.length < 2 || !validRoles.has(role) || password.length < 10 || (role === 'operator' && scope.length < 2)) {
      sendJson(res, 422, { error: role === 'operator' ? 'برای اپراتور تولید، انتخاب مجموعه مسئول الزامی است.' : 'نام، نام کاربری انگلیسی، نقش و رمز حداقل ۱۰ کاراکتری الزامی است.' }); return true;
    }
    const config = JSON.parse(readFileSync(publicAuthPath, 'utf8'));
    const users = authUsers(config);
    if (users.some((user) => user.username.toLowerCase() === username)) { sendJson(res, 409, { error: 'این نام کاربری قبلاً ثبت شده است.' }); return true; }
    const user = { username, displayName, role, scope: role === 'operator' ? scope : null, permissions: rolePermissionDefaults[role] || [], passwordHash: passwordHash(password) };
    config.users = [...users, user];
    await writeFile(publicAuthPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    sendJson(res, 201, { user: { username, displayName, role, scope: user.scope || '', permissions: user.permissions, isAdmin: false } });
    return true;
  }
  if (pathname.startsWith('/api/admin/users/') && req.method === 'DELETE') {
    if (req.authUser.accountRole !== 'admin' && req.authUser.role !== 'admin') { sendJson(res, 403, { error: 'این بخش فقط در اختیار مدیر کل سامانه است.' }); return true; }
    const username = decodeURIComponent(pathname.slice('/api/admin/users/'.length)).trim().toLowerCase();
    if (!username || username.includes('/')) { sendJson(res, 400, { error: 'نام کاربری معتبر نیست.' }); return true; }
    const config = JSON.parse(readFileSync(publicAuthPath, 'utf8'));
    const users = authUsers(config);
    const target = users.find((user) => user.username.toLowerCase() === username);
    if (!target) { sendJson(res, 404, { error: 'کاربر پیدا نشد.' }); return true; }
    if (target.role === 'admin' || target.username === req.authUser.username) { sendJson(res, 409, { error: 'حساب مدیر کل سامانه قابل حذف نیست.' }); return true; }
    config.users = users.filter((user) => user.username.toLowerCase() !== username);
    await writeFile(publicAuthPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    sendJson(res, 200, { deleted: true, username });
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
    if (!hasPermission(req.authUser, 'project_create')) { sendJson(res, 403, { error: 'دسترسی تعریف پروژه برای این کاربر فعال نیست.' }); return true; }
    const input = await readJson(req);
    if (!input || typeof input.name !== 'string' || input.name.trim().length < 2 || typeof input.code !== 'string' || input.code.trim().length < 2 || !['single', 'assembly'].includes(input.itemType)) {
      sendJson(res, 422, { error: 'نام، کد و نوع پروژه الزامی است.' }); return true;
    }
    const sets = input.itemType === 'assembly' ? defaultAssemblySets() : [];
    const normalized = {
      name: input.name.trim(), code: input.code.trim(), itemType: input.itemType,
      drawings: input.itemType === 'single' && Array.isArray(input.drawings) ? input.drawings.map((value) => String(value).trim()).filter(Boolean).slice(0, 100) : [],
      sets,
    };
    if (databaseConfigured()) {
      const created = await createDatabaseProject(normalized, req.authUser);
      const project = sets.length ? await replaceProjectRoute(created.id, sets, req.authUser) : created;
      sendJson(res, 201, { project });
      return true;
    }
    const state = await loadState();
    const project = {
      id: randomUUID(), ...normalized,
      sets,
      profile: input.itemType === 'assembly' ? { mainDrawingNumber: '', componentDrawings: [], customFields: {}, importedHeaders: [], importedRows: [], sourceFileName: '', importedRowCount: 0 } : null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    state.projects.push(project);
    await saveState(state);
    sendJson(res, 201, { project });
    return true;
  }
  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/profile') && req.method === 'PUT') {
    if (!hasPermission(req.authUser, 'engineering')) { sendJson(res, 403, { error: 'ویرایش پروفایل فقط در اختیار امور مهندسی است.' }); return true; }
    const id = decodeURIComponent(pathname.slice('/api/projects/'.length, -'/profile'.length));
    const profile = normalizeProjectProfile(await readJson(req));
    if (!profile) { sendJson(res, 422, { error: 'اطلاعات پروفایل پروژه معتبر نیست.' }); return true; }
    if (databaseConfigured()) {
      const project = await saveDatabaseProjectProfile(id, profile, req.authUser);
      sendJson(res, 200, { project }); return true;
    }
    const state = await loadState();
    const index = state.projects.findIndex((project) => project.id === id);
    if (index < 0) { sendJson(res, 404, { error: 'پروژه پیدا نشد.' }); return true; }
    if (state.projects[index].itemType !== 'assembly') { sendJson(res, 409, { error: 'پروفایل مونتاژی فقط برای Assembly Part فعال است.' }); return true; }
    const drawings = [...new Set([profile.mainDrawingNumber, ...profile.componentDrawings.map((item) => item.drawingNumber)].filter(Boolean))];
    state.projects[index] = { ...state.projects[index], profile: { ...profile, importedRowCount: profile.importedRows.length, updatedAt: new Date().toISOString() }, drawings, updatedAt: new Date().toISOString() };
    await saveState(state);
    sendJson(res, 200, { project: state.projects[index] }); return true;
  }
  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/route') && req.method === 'PUT') {
    if (!hasPermission(req.authUser, 'engineering')) { sendJson(res, 403, { error: 'دسترسی مهندسی برای این کاربر فعال نیست.' }); return true; }
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
        qcRequired: true, productionControlRequired: true, barcodeAfter: false,
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
  if (pathname.startsWith('/api/projects/') && req.method === 'DELETE') {
    if (!hasPermission(req.authUser, 'project_create')) { sendJson(res, 403, { error: 'دسترسی حذف پروژه برای این کاربر فعال نیست.' }); return true; }
    const id = decodeURIComponent(pathname.slice('/api/projects/'.length));
    if (!id || id.includes('/')) { sendJson(res, 400, { error: 'شناسه پروژه معتبر نیست.' }); return true; }
    if (databaseConfigured()) {
      await deleteDatabaseProject(id, req.authUser);
    } else {
      const state = await loadState();
      const index = state.projects.findIndex((project) => project.id === id);
      if (index < 0) { sendJson(res, 404, { error: 'پروژه پیدا نشد.' }); return true; }
      state.projects.splice(index, 1);
      await saveState(state);
    }
    sendJson(res, 200, { deleted: true, id });
    return true;
  }
  if (pathname === '/api/work-items' && req.method === 'POST') {
    if (!hasPermission(req.authUser, 'engineering')) { sendJson(res, 403, { error: 'صدور بارکد فقط در اختیار امور مهندسی است.' }); return true; }
    if (!databaseConfigured()) { sendJson(res, 503, { error: 'پایگاه داده تولید فعال نیست.' }); return true; }
    const input = await readJson(req);
    if (!input || typeof input.projectId !== 'string' || typeof input.serialNumber !== 'string' || input.serialNumber.trim().length < 2) {
      sendJson(res, 422, { error: 'پروژه و شماره سریال الزامی است.' }); return true;
    }
    let project = (await listProjects(input.projectId))[0];
    if (!project) { sendJson(res, 404, { error: 'پروژه پیدا نشد.' }); return true; }
    let routeInitialized = false;
    if (project.itemType === 'assembly' && !project.sets.length) {
      project = await replaceProjectRoute(project.id, defaultAssemblySets(), req.authUser);
      routeInitialized = true;
    }
    const barcode = `WPMES-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`.toUpperCase();
    const item = await issueWorkItem({ projectId: input.projectId, serialNumber: input.serialNumber.trim(), barcode }, req.authUser);
    sendJson(res, 201, { item, project, routeInitialized });
    return true;
  }
  if (pathname === '/api/scan/confirm' && req.method === 'POST') {
    if (!hasScanRolePermission(req.authUser)) { sendJson(res, 403, { error: 'دسترسی نقش عملیاتی این بارکدخوان برای کاربر فعال نیست.' }); return true; }
    if (!databaseConfigured()) { sendJson(res, 503, { error: 'پایگاه داده تولید فعال نیست.' }); return true; }
    const input = await readJson(req);
    const sources = { camera: 'CAMERA', usb: 'USB_SCANNER', manual: 'MANUAL' };
    if (!input || typeof input.code !== 'string' || input.code.trim().length < 2 || typeof input.clientRequestId !== 'string' || !sources[input.inputSource] || (input.inputSource === 'manual' && (!input.manualReason || String(input.manualReason).trim().length < 2))) {
      sendJson(res, 422, { error: 'اطلاعات ثبت اسکن کامل نیست.' }); return true;
    }
    const decision = input.decision === 'reject' ? 'reject' : 'approve';
    if (req.authUser.role === 'qc' && (typeof input.projectId !== 'string' || input.projectId.trim().length < 2)) {
      sendJson(res, 422, { error: 'پروژه فعال بارکدخوان کنترل کیفیت مشخص نشده است.' }); return true;
    }
    if (decision === 'reject' && (req.authUser.role !== 'qc' || !['same_step', 'independent'].includes(input.reworkMode) || typeof input.comment !== 'string' || input.comment.trim().length < 3)) {
      sendJson(res, 422, { error: 'برای رد کنترل کیفیت، نوع بازکاری و شرح علت الزامی است.' }); return true;
    }
    const result = await confirmBarcode({
      code: input.code.trim().toUpperCase(), clientRequestId: input.clientRequestId,
      inputSource: sources[input.inputSource], manualReason: input.inputSource === 'manual' ? String(input.manualReason).trim() : null,
      decision, reworkMode: decision === 'reject' ? input.reworkMode : null,
      comment: decision === 'reject' ? input.comment.trim() : null,
      projectId: req.authUser.role === 'qc' ? input.projectId.trim() : null,
    }, req.authUser);
    sendJson(res, 200, result);
    return true;
  }
  if (pathname.startsWith('/api/scan/') && req.method === 'GET') {
    if (!hasScanRolePermission(req.authUser)) { sendJson(res, 403, { error: 'دسترسی نقش عملیاتی این بارکدخوان برای کاربر فعال نیست.' }); return true; }
    const code = decodeURIComponent(pathname.slice('/api/scan/'.length)).trim();
    if (databaseConfigured()) {
      const scan = await resolveBarcode(code, req.authUser);
      if (!scan) { sendJson(res, 404, { error: 'برای این کد رکورد فعالی ثبت نشده است.' }); return true; }
      const requestedProjectId = new URL(req.url || '/', 'http://local').searchParams.get('projectId');
      if (req.authUser.role === 'qc' && (!requestedProjectId || scan.project.id !== requestedProjectId)) {
        sendJson(res, 409, { error: requestedProjectId ? 'این بارکد متعلق به پروژه انتخاب‌شده نیست.' : 'ابتدا پروژه فعال بارکدخوان را انتخاب کنید.' }); return true;
      }
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
      PROJECT_SCOPE_MISMATCH: 'این بارکد متعلق به پروژه انتخاب‌شده نیست.',
      SET_ROUTE_NOT_FOUND: 'مسیر مجموعه پیدا نشد.', SET_ROUTE_EMPTY: 'برای این مجموعه زیرفرآیندی تعریف نشده است.',
    };
    const message = error?.message === 'ROUTE_ALREADY_IN_USE' ? 'این مسیر وارد تولید شده و باید با نسخه جدید اصلاح شود.' :
      error?.message === 'PROJECT_ALREADY_IN_PRODUCTION' ? 'این پروژه وارد چرخه تولید شده و برای حفظ سوابق قابل حذف نیست.' :
      error?.message === 'PROFILE_ASSEMBLY_ONLY' ? 'پروفایل مونتاژی فقط برای Assembly Part فعال است.' :
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
