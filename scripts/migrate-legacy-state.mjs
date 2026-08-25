import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importLegacyState } from '../database.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const state = JSON.parse(await readFile(join(appRoot, 'data', 'state.json'), 'utf8'));
const auth = JSON.parse(await readFile(join(appRoot, 'secrets', 'public-auth.json'), 'utf8'));
const firstUser = Array.isArray(auth.users) ? auth.users[0] : auth;
const result = await importLegacyState(state, {
  username: firstUser.username,
  displayName: firstUser.displayName || 'کاربر مهندسی',
  role: firstUser.role || 'engineering',
});
console.log(JSON.stringify(result));
