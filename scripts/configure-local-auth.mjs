import { randomBytes, scryptSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const outputPath = join(appRoot, 'secrets', 'public-auth.json');
const terminal = createInterface({ input: stdin, output: stdout });

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = scryptSync(password, salt, 32).toString('base64url');
  return `scrypt$${salt}$${derived}`;
}

try {
  const username = (await terminal.question('Admin username [admin]: ')).trim().toLowerCase() || 'admin';
  const displayName = (await terminal.question('Admin display name [System Admin]: ')).trim() || 'System Admin';
  const password = await terminal.question('Admin password (minimum 10 characters): ');

  if (!/^[a-z0-9._-]{3,60}$/.test(username)) throw new Error('Username must contain 3-60 English letters, digits, dots, underscores, or hyphens.');
  if (password.length < 10) throw new Error('Password must contain at least 10 characters.');

  const configuration = {
    sessionSecret: randomBytes(48).toString('base64url'),
    users: [{
      username,
      displayName,
      role: 'admin',
      permissions: ['projects', 'project_create', 'engineering', 'production_flow', 'scanner', 'qc', 'production_control', 'packaging', 'access_matrix'],
      passwordHash: hashPassword(password),
    }],
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(configuration, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log('Local administrator configuration created in secrets/public-auth.json.');
} finally {
  terminal.close();
}
