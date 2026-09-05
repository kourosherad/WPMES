import { randomUUID } from 'node:crypto';
import sql from 'mssql';

const database = await import('../database.mjs');
const engineering = { username: 'smoke.engineering', displayName: 'Smoke Engineering', role: 'engineering' };
const planning = { username: 'smoke.planning', displayName: 'Smoke Planning', role: 'planning' };
const project = await database.createProject({ name: 'Smoke Project', code: `SMK-${Date.now()}` }, planning);
if (project.itemType !== null) throw new Error(`PROJECT_TYPE_MUST_BE_ENGINEERING_ASSIGNED:${project.itemType}`);
const routeSets = [
  { id: randomUUID(), name: 'Smoke Weld', code: 'SMK-WELD', kind: 'assembly', operatorRole: 'WELD_SCOPE', steps: [{ id: randomUUID(), name: 'Smoke Weld Step', execution: 'internal' }] },
  { id: randomUUID(), name: 'Smoke Delivery', code: 'SMK-DELIVERY', kind: 'assembly', operatorRole: 'DELIVERY_SCOPE', steps: [{ id: randomUUID(), name: 'Smoke Delivery Step', execution: 'internal' }] },
];
const draftWithDefaults = await database.replaceProjectRoute(project.id, routeSets, planning, false);
if (draftWithDefaults.status !== 'DRAFT' || draftWithDefaults.sets.length !== 2 || (await database.listProjectWorkItems(project.id)).length) throw new Error('DEFAULT_DRAFT_ROUTE_FAILED');
await database.saveProjectBaseProfile(project.id, { name: project.name, code: project.code, clientName: 'Smoke Client', orderNumber: 'ORDER-001' }, planning);
const technicalProfile = {
  itemType: 'assembly', plannedQuantity: 2, mainDrawingNumber: 'SMK-ASM-001',
  dimension: '1200 x 800 mm', weight: '250 kg', description: 'Smoke assembly description',
  componentDrawings: [{ id: randomUUID(), drawingNumber: 'SMK-PART-001', description: 'Smoke component' }],
  customFields: {}, importedHeaders: ['Drawing Number'], importedRows: [{ 'Drawing Number': 'SMK-PART-001' }], sourceFileName: 'smoke.xlsx',
};
await database.saveProjectProfile(project.id, technicalProfile, engineering);
const released = await database.replaceProjectRoute(project.id, routeSets, engineering);
if (released.releasedQuantity !== 2) throw new Error(`RELEASE_QUANTITY_FAILED:${released.releasedQuantity}`);

await database.saveProjectProfile(project.id, { ...technicalProfile, plannedQuantity: 3 }, engineering);
if ((await database.listProjectWorkItems(project.id)).length !== 3) throw new Error('QUANTITY_INCREASE_FAILED');
await database.saveProjectProfile(project.id, technicalProfile, engineering);
const items = await database.listProjectWorkItems(project.id);
if (items.length !== 2 || !items.every((item) => item.barcode.includes('SMOKE_PROJECT(SMK-') && item.barcode.includes('|SMK-ASM-001|') && item.totalQuantity === 2)) {
  throw new Error(`BARCODE_BATCH_FAILED:${JSON.stringify(items)}`);
}
const [first, second] = items.sort((a, b) => a.unitNumber - b.unitNumber);
const weldOperator = { username: 'smoke.operator.weld', displayName: 'Smoke Weld Operator', role: 'operator', scope: 'WELD_SCOPE' };
const deliveryOperator = { username: 'smoke.operator.delivery', displayName: 'Smoke Delivery Operator', role: 'operator', scope: 'DELIVERY_SCOPE' };
const qualityControl = { username: 'smoke.qc', displayName: 'Smoke QC', role: 'qc' };
const productionControl = { username: 'smoke.production.control', displayName: 'Smoke Production Control', role: 'production' };

const resolvedWeld = await database.resolveBarcode(first.barcode, weldOperator);
if (!resolvedWeld?.allowed || resolvedWeld.set.name !== 'Smoke Weld') throw new Error(`OPERATOR_RESOLUTION_FAILED:${JSON.stringify(resolvedWeld)}`);
const wrongStation = await database.resolveBarcode(first.barcode, { ...weldOperator, username: 'smoke.operator.other', scope: 'OTHER_SCOPE' });
if (wrongStation?.allowed || wrongStation?.rejectionReason !== 'PRODUCTION_STATION_MISMATCH') throw new Error(`OPERATOR_SCOPE_FAILED:${JSON.stringify(wrongStation)}`);

const confirm = (code, actor, extra = {}) => database.confirmBarcode({
  code, projectId: actor.role === 'qc' ? project.id : null, clientRequestId: randomUUID(), inputSource: 'CAMERA',
  manualReason: null, decision: 'approve', reworkMode: null, comment: null, ...extra,
}, actor);

await confirm(first.barcode, weldOperator);
if (!(await database.listAlerts(qualityControl)).some((alert) => alert.id === first.id)) throw new Error('QC_ALERT_MISSING');
await confirm(first.barcode, qualityControl, { decision: 'reject', reworkMode: 'same_step', comment: 'Smoke same-step repair' });
await confirm(first.barcode, weldOperator);
await confirm(first.barcode, qualityControl);
if (!(await database.listAlerts(productionControl)).some((alert) => alert.id === first.id)) throw new Error('PRODUCTION_CONTROL_ALERT_MISSING');
await confirm(first.barcode, productionControl);
await confirm(first.barcode, deliveryOperator);
await confirm(first.barcode, qualityControl);
await confirm(first.barcode, productionControl);

await confirm(second.barcode, weldOperator);
await confirm(second.barcode, qualityControl, { decision: 'reject', reworkMode: 'independent', comment: 'Smoke independent rework route' });

const pool = await database.databasePool();
const result = await pool.request().input('code', sql.NVarChar(160), first.barcode).query(`SELECT WorkItems.CurrentStatus,
    (SELECT COUNT_BIG(*) FROM production.ScanEvents Events WHERE Events.WorkItemId=WorkItems.Id) AS ScanCount,
    (SELECT COUNT_BIG(*) FROM production.ApprovalDecisions Decisions JOIN production.StepExecutions Executions ON Executions.Id=Decisions.StepExecutionId WHERE Executions.WorkItemId=WorkItems.Id) AS ApprovalCount
  FROM production.WorkItems WorkItems JOIN production.Barcodes Barcodes ON Barcodes.WorkItemId=WorkItems.Id WHERE Barcodes.BarcodeValue=@code;`);
const row = result.recordset[0];
if (row.CurrentStatus !== 'COMPLETED' || Number(row.ScanCount) !== 8 || Number(row.ApprovalCount) !== 8) throw new Error(`THREE_STAGE_FLOW_FAILED:${JSON.stringify(row)}`);
const hold = await pool.request().input('code', sql.NVarChar(160), second.barcode).query(`SELECT WorkItems.CurrentStatus,
    (SELECT TOP (1) Status FROM production.ReworkCases Cases WHERE Cases.WorkItemId=WorkItems.Id ORDER BY CreatedAtUtc DESC) AS ReworkStatus
  FROM production.WorkItems WorkItems JOIN production.Barcodes Barcodes ON Barcodes.WorkItemId=WorkItems.Id WHERE Barcodes.BarcodeValue=@code;`);
if (hold.recordset[0].CurrentStatus !== 'ON_HOLD' || hold.recordset[0].ReworkStatus !== 'AWAITING_ROUTE') throw new Error(`INDEPENDENT_REWORK_FAILED:${JSON.stringify(hold.recordset[0])}`);
let startedReductionBlocked = false;
try { await database.saveProjectProfile(project.id, { ...technicalProfile, plannedQuantity: 1 }, engineering); }
catch (error) { startedReductionBlocked = error?.message === 'QUANTITY_REDUCTION_STARTED'; }
if (!startedReductionBlocked) throw new Error('STARTED_QUANTITY_REDUCTION_MUST_BE_BLOCKED');
await database.archiveProject(project.id, engineering);
if ((await database.listProjects(project.id)).length || (await database.listProjects(project.id, true)).length !== 1) throw new Error('ARCHIVE_FAILED');
console.log(JSON.stringify({ released: items.map((item) => ({ barcode: item.barcode, ordinal: `${item.unitNumber}/${item.totalQuantity}` })), quantityEditing: { increase: true, decreaseUnstarted: true, decreaseStartedBlocked: true }, threeStage: { status: row.CurrentStatus, scans: Number(row.ScanCount) }, alerts: true, independentRework: hold.recordset[0] }));
await pool.close();
