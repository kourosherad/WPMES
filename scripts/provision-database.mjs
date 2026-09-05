import sqlModule from 'mssql/msnodesqlv8.js';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sql = sqlModule;
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const server = process.env.WPMES_SQL_INSTANCE || 'localhost\\SQLEXPRESS';
const database = 'WPMES';
const login = 'wpmes_app';
const password = process.env.WPMES_DB_PASSWORD || `${randomBytes(24).toString('base64url')}!aA9`;
const configPath = join(appRoot, 'secrets', 'database.json');

const trusted = (databaseName) => ({
  connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${databaseName};Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=yes;`,
  requestTimeout: 30000,
});

function batches(source) {
  return source.split(/^\s*GO\s*$/gim).map((value) => value.trim()).filter(Boolean);
}

async function runMigration(pool, filename) {
  const source = await readFile(join(appRoot, 'database', filename), 'utf8');
  for (const batch of batches(source)) await pool.request().batch(batch);
}

const master = await new sql.ConnectionPool(trusted('master')).connect();
try {
  await master.request().query(`IF DB_ID(N'${database}') IS NULL CREATE DATABASE [${database}];`);
} finally {
  await master.close();
}

const applicationDatabase = await new sql.ConnectionPool(trusted(database)).connect();
try {
  const tableCheck = await applicationDatabase.request().query("SELECT OBJECT_ID(N'security.Users', N'U') AS Id");
  if (!tableCheck.recordset[0].Id) await runMigration(applicationDatabase, '001_initial_schema.sql');
  await runMigration(applicationDatabase, '002_project_route_columns.sql');
  await runMigration(applicationDatabase, '003_qc_rework_cases.sql');
  await runMigration(applicationDatabase, '004_assembly_project_profiles.sql');
  await runMigration(applicationDatabase, '005_production_control_station_ownership.sql');
  await runMigration(applicationDatabase, '006_engineering_release_workflow.sql');
  await runMigration(applicationDatabase, '007_planning_profile_stage.sql');
  const safePassword = password.replaceAll("'", "''");
  await applicationDatabase.request().batch(`
    IF SUSER_ID(N'${login}') IS NULL
      CREATE LOGIN [${login}] WITH PASSWORD=N'${safePassword}', CHECK_POLICY=ON, CHECK_EXPIRATION=OFF;
    ELSE
      ALTER LOGIN [${login}] WITH PASSWORD=N'${safePassword}';
    IF USER_ID(N'${login}') IS NULL CREATE USER [${login}] FOR LOGIN [${login}];
    IF NOT EXISTS (SELECT 1 FROM sys.database_role_members drm JOIN sys.database_principals rolep ON rolep.principal_id=drm.role_principal_id JOIN sys.database_principals memberp ON memberp.principal_id=drm.member_principal_id WHERE rolep.name=N'wpmes_runtime' AND memberp.name=N'${login}')
      ALTER ROLE wpmes_runtime ADD MEMBER [${login}];
  `);
} finally {
  await applicationDatabase.close();
}

const masterConfiguration = await new sql.ConnectionPool(trusted('master')).connect();
try {
  await masterConfiguration.request().batch(`EXEC xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\\Microsoft\\MSSQLServer\\MSSQLServer', N'LoginMode', REG_DWORD, 2;`);
} finally {
  await masterConfiguration.close();
}

if (process.env.WPMES_SKIP_CONFIG_WRITE !== '1') {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    server: 'localhost', port: 1433, database, user: login, password,
    encrypt: true, trustServerCertificate: true,
  }, null, 2), 'utf8');
}

console.log(JSON.stringify({ database, login, configured: true }));
