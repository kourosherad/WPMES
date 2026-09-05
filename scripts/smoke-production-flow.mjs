import sqlModule from 'mssql/msnodesqlv8.js';
import { spawnSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sql = sqlModule;
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const smokeDatabase = 'WPMES_Smoke';
const testConfigPath = join(appRoot, 'secrets', 'database.smoke.json');
const productionConfig = JSON.parse(await readFile(join(appRoot, 'secrets', 'database.json'), 'utf8'));
const trusted = (database) => ({ connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${productionConfig.server || 'localhost'};Database=${database};Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=yes;` });
const batches = (source) => source.split(/^\s*GO\s*$/gim).map((value) => value.trim()).filter(Boolean);

let master;
try {
  master = await new sql.ConnectionPool(trusted('master')).connect();
  await master.request().batch(`IF DB_ID(N'${smokeDatabase}') IS NOT NULL BEGIN ALTER DATABASE [${smokeDatabase}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${smokeDatabase}]; END; CREATE DATABASE [${smokeDatabase}];`);
  await master.close(); master = null;

  const smoke = await new sql.ConnectionPool(trusted(smokeDatabase)).connect();
  try {
    for (const file of ['001_initial_schema.sql', '002_project_route_columns.sql', '003_qc_rework_cases.sql', '004_assembly_project_profiles.sql', '005_production_control_station_ownership.sql', '006_engineering_release_workflow.sql', '007_planning_profile_stage.sql']) {
      const source = await readFile(join(appRoot, 'database', file), 'utf8');
      for (const batch of batches(source)) await smoke.request().batch(batch);
    }
    await smoke.request().batch(`CREATE USER [wpmes_app] FOR LOGIN [wpmes_app]; ALTER ROLE wpmes_runtime ADD MEMBER [wpmes_app];`);
  } finally { await smoke.close(); }

  await writeFile(testConfigPath, JSON.stringify({ ...productionConfig, database: smokeDatabase }, null, 2), 'utf8');
  const run = spawnSync(process.execPath, [join(appRoot, 'scripts', 'smoke-production-flow-runtime.mjs')], {
    cwd: appRoot,
    env: { ...process.env, WPMES_DB_CONFIG: testConfigPath },
    encoding: 'utf8',
    timeout: 60000,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error(`SMOKE_RUNTIME_FAILED:${run.status ?? run.error?.message}`);
} finally {
  if (master) await master.close().catch(() => {});
  await unlink(testConfigPath).catch(() => {});
  const cleanup = await new sql.ConnectionPool(trusted('master')).connect();
  try {
    await cleanup.request().batch(`IF DB_ID(N'${smokeDatabase}') IS NOT NULL BEGIN ALTER DATABASE [${smokeDatabase}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${smokeDatabase}]; END;`);
  } finally { await cleanup.close(); }
}
