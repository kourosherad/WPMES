import { randomUUID } from 'node:crypto';
import sql from 'mssql';

const database = await import('../database.mjs');
const engineering = { username: 'smoke.engineering', displayName: 'Smoke Engineering', role: 'engineering' };
const project = await database.createProject({ name: 'Smoke Project', code: `SMK-${Date.now()}`, itemType: 'assembly', drawings: ['SMK-001'] }, engineering);
await database.replaceProjectRoute(project.id, [
  { id: randomUUID(), name: 'Smoke Weld', code: 'SMK-WELD', kind: 'assembly', operatorRole: 'WELD_SCOPE', steps: [{ id: randomUUID(), name: 'Smoke Weld Step', execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }] },
  { id: randomUUID(), name: 'Smoke Delivery', code: 'SMK-DELIVERY', kind: 'assembly', operatorRole: 'DELIVERY_SCOPE', steps: [{ id: randomUUID(), name: 'Smoke Delivery Step', execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }] },
], engineering);

const code = `SMOKE-${Date.now()}`;
await database.issueWorkItem({ projectId: project.id, serialNumber: 'SMOKE-SERIAL', barcode: code }, engineering);
const actors = [
  { username: 'smoke.operator', displayName: 'Smoke Operator', role: 'operator', scope: 'WELD_SCOPE' },
  { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc' },
  { username: 'smoke.production', displayName: 'Smoke Production', role: 'production' },
  { username: 'smoke.delivery', displayName: 'Smoke Delivery', role: 'operator', scope: 'DELIVERY_SCOPE' },
  { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc' },
  { username: 'smoke.production', displayName: 'Smoke Production', role: 'production' },
];
for (const actor of actors) await database.confirmBarcode({ code, clientRequestId: randomUUID(), inputSource: 'CAMERA', manualReason: null }, actor);

const pool = await database.databasePool();
const result = await pool.request().input('code', sql.NVarChar(160), code).query(`SELECT WorkItems.CurrentStatus,
    (SELECT COUNT_BIG(*) FROM production.ScanEvents Events WHERE Events.WorkItemId=WorkItems.Id) AS ScanCount,
    (SELECT COUNT_BIG(*) FROM production.ApprovalDecisions Decisions JOIN production.StepExecutions Executions ON Executions.Id=Decisions.StepExecutionId WHERE Executions.WorkItemId=WorkItems.Id) AS ApprovalCount
  FROM production.WorkItems WorkItems JOIN production.Barcodes Barcodes ON Barcodes.WorkItemId=WorkItems.Id WHERE Barcodes.BarcodeValue=@code;`);
const row = result.recordset[0];
if (row.CurrentStatus !== 'COMPLETED' || Number(row.ScanCount) !== 6 || Number(row.ApprovalCount) !== 6) throw new Error(`SMOKE_ASSERTION_FAILED:${JSON.stringify(row)}`);
console.log(JSON.stringify({ status: row.CurrentStatus, scans: Number(row.ScanCount), approvals: Number(row.ApprovalCount) }));
await pool.close();
