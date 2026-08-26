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
  { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc', decision: 'reject', reworkMode: 'same_step', comment: 'Smoke same-step repair' },
  { username: 'smoke.operator', displayName: 'Smoke Operator', role: 'operator', scope: 'WELD_SCOPE' },
  { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc' },
  { username: 'smoke.production', displayName: 'Smoke Production', role: 'production' },
  { username: 'smoke.delivery', displayName: 'Smoke Delivery', role: 'operator', scope: 'DELIVERY_SCOPE' },
  { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc' },
  { username: 'smoke.production', displayName: 'Smoke Production', role: 'production' },
];
for (const actor of actors) await database.confirmBarcode({ code, clientRequestId: randomUUID(), inputSource: 'CAMERA', manualReason: null, decision: actor.decision || 'approve', reworkMode: actor.reworkMode || null, comment: actor.comment || null }, actor);

const independentCode = `SMOKE-HOLD-${Date.now()}`;
await database.issueWorkItem({ projectId: project.id, serialNumber: 'SMOKE-HOLD-SERIAL', barcode: independentCode }, engineering);
const weldOperator = { username: 'smoke.operator', displayName: 'Smoke Operator', role: 'operator', scope: 'WELD_SCOPE' };
const qualityControl = { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc' };
await database.confirmBarcode({ code: independentCode, clientRequestId: randomUUID(), inputSource: 'CAMERA', manualReason: null, decision: 'approve' }, weldOperator);
await database.confirmBarcode({ code: independentCode, clientRequestId: randomUUID(), inputSource: 'CAMERA', manualReason: null, decision: 'reject', reworkMode: 'independent', comment: 'Smoke independent rework route' }, qualityControl);

const pool = await database.databasePool();
const result = await pool.request().input('code', sql.NVarChar(160), code).query(`SELECT WorkItems.CurrentStatus,
    (SELECT COUNT_BIG(*) FROM production.ScanEvents Events WHERE Events.WorkItemId=WorkItems.Id) AS ScanCount,
    (SELECT COUNT_BIG(*) FROM production.ApprovalDecisions Decisions JOIN production.StepExecutions Executions ON Executions.Id=Decisions.StepExecutionId WHERE Executions.WorkItemId=WorkItems.Id) AS ApprovalCount
  FROM production.WorkItems WorkItems JOIN production.Barcodes Barcodes ON Barcodes.WorkItemId=WorkItems.Id WHERE Barcodes.BarcodeValue=@code;`);
const row = result.recordset[0];
if (row.CurrentStatus !== 'COMPLETED' || Number(row.ScanCount) !== 8 || Number(row.ApprovalCount) !== 8) throw new Error(`SMOKE_ASSERTION_FAILED:${JSON.stringify(row)}`);
const hold = await pool.request().input('code', sql.NVarChar(160), independentCode).query(`SELECT WorkItems.CurrentStatus,
    (SELECT TOP (1) Status FROM production.ReworkCases Cases WHERE Cases.WorkItemId=WorkItems.Id ORDER BY CreatedAtUtc DESC) AS ReworkStatus
  FROM production.WorkItems WorkItems JOIN production.Barcodes Barcodes ON Barcodes.WorkItemId=WorkItems.Id WHERE Barcodes.BarcodeValue=@code;`);
if (hold.recordset[0].CurrentStatus !== 'ON_HOLD' || hold.recordset[0].ReworkStatus !== 'AWAITING_ROUTE') throw new Error(`INDEPENDENT_REWORK_ASSERTION_FAILED:${JSON.stringify(hold.recordset[0])}`);
console.log(JSON.stringify({ completed: { status: row.CurrentStatus, scans: Number(row.ScanCount), approvals: Number(row.ApprovalCount) }, independentRework: hold.recordset[0] }));
await pool.close();
