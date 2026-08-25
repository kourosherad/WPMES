import sqlModule from 'mssql/msnodesqlv8.js';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sql = sqlModule;
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const smokeDatabase = 'WPMES_Smoke';
const testConfigPath = join(appRoot, 'secrets', 'database.smoke.json');
const productionConfig = JSON.parse(await readFile(join(appRoot, 'secrets', 'database.json'), 'utf8'));
const trusted = (database) => ({ connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=localhost\\SQLEXPRESS;Database=${database};Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=yes;` });
const batches = (source) => source.split(/^\s*GO\s*$/gim).map((value) => value.trim()).filter(Boolean);

const master = await new sql.ConnectionPool(trusted('master')).connect();
let runtimePool;
try {
  await master.request().batch(`IF DB_ID(N'${smokeDatabase}') IS NOT NULL BEGIN ALTER DATABASE [${smokeDatabase}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${smokeDatabase}]; END; CREATE DATABASE [${smokeDatabase}];`);
  const smoke = await new sql.ConnectionPool(trusted(smokeDatabase)).connect();
  try {
    for (const file of ['001_initial_schema.sql', '002_project_route_columns.sql']) {
      const source = await readFile(join(appRoot, 'database', file), 'utf8');
      for (const batch of batches(source)) await smoke.request().batch(batch);
    }
    await smoke.request().batch(`CREATE USER [wpmes_app] FOR LOGIN [wpmes_app]; ALTER ROLE wpmes_runtime ADD MEMBER [wpmes_app];`);
  } finally { await smoke.close(); }
  await writeFile(testConfigPath, JSON.stringify({ ...productionConfig, database: smokeDatabase }, null, 2), 'utf8');
  process.env.WPMES_DB_CONFIG = testConfigPath;
  const database = await import('../database.mjs');
  const engineering = { username: 'smoke.engineering', displayName: 'Smoke Engineering', role: 'engineering' };
  const project = await database.createProject({ name: 'Smoke Project', code: `SMK-${Date.now()}`, itemType: 'assembly', drawings: ['SMK-001'] }, engineering);
  const setId = randomUUID();
  await database.replaceProjectRoute(project.id, [{ id: setId, name: 'Smoke Set', code: 'SMK-SET', kind: 'assembly', operatorRole: 'WELD_SCOPE', steps: [{ id: randomUUID(), name: 'Smoke Step', execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }] }], engineering);
  const code = `SMOKE-${Date.now()}`;
  await database.issueWorkItem({ projectId: project.id, setId, serialNumber: 'SMOKE-SERIAL', barcode: code }, engineering);
  const actors = [
    { username: 'smoke.operator', displayName: 'Smoke Operator', role: 'operator', scope: 'WELD_SCOPE' },
    { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc' },
    { username: 'smoke.production', displayName: 'Smoke Production', role: 'production' },
    { username: 'smoke.packaging', displayName: 'Smoke Packaging', role: 'packaging' },
  ];
  for (const actor of actors) await database.confirmBarcode({ code, clientRequestId: randomUUID(), inputSource: 'CAMERA', manualReason: null }, actor);
  runtimePool = await database.databasePool();
  const result = await runtimePool.request().input('code', sql.NVarChar(160), code).query(`SELECT WorkItems.CurrentStatus,
      (SELECT COUNT_BIG(*) FROM production.ScanEvents Events WHERE Events.WorkItemId=WorkItems.Id) AS ScanCount,
      (SELECT COUNT_BIG(*) FROM production.ApprovalDecisions Decisions JOIN production.StepExecutions Executions ON Executions.Id=Decisions.StepExecutionId WHERE Executions.WorkItemId=WorkItems.Id) AS ApprovalCount
    FROM production.WorkItems WorkItems JOIN production.Barcodes Barcodes ON Barcodes.WorkItemId=WorkItems.Id WHERE Barcodes.BarcodeValue=@code;`);
  const row = result.recordset[0];
  if (row.CurrentStatus !== 'COMPLETED' || Number(row.ScanCount) !== 4 || Number(row.ApprovalCount) !== 3) throw new Error(`SMOKE_ASSERTION_FAILED:${JSON.stringify(row)}`);
  console.log(JSON.stringify({ status: row.CurrentStatus, scans: Number(row.ScanCount), approvals: Number(row.ApprovalCount) }));
} finally {
  if (runtimePool) await runtimePool.close().catch(() => {});
  await unlink(testConfigPath).catch(() => {});
  await master.request().batch(`IF DB_ID(N'${smokeDatabase}') IS NOT NULL BEGIN ALTER DATABASE [${smokeDatabase}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${smokeDatabase}]; END;`);
  void master.close();
}
