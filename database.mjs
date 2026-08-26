import sql from 'mssql';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const configPath = process.env.WPMES_DB_CONFIG || join(appRoot, 'secrets', 'database.json');
let poolPromise;

export function databaseConfigured() {
  return existsSync(configPath);
}

function configuration() {
  if (!databaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  const value = JSON.parse(readFileSync(configPath, 'utf8'));
  return {
    server: value.server || '127.0.0.1',
    port: Number(value.port || 1433),
    database: value.database || 'WPMES',
    user: value.user,
    password: value.password,
    options: {
      encrypt: value.encrypt !== false,
      trustServerCertificate: value.trustServerCertificate === true,
      enableArithAbort: true,
    },
    pool: { min: 1, max: 12, idleTimeoutMillis: 30000 },
    requestTimeout: 15000,
    connectionTimeout: 10000,
  };
}

export async function databasePool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(configuration()).connect().catch((error) => {
    poolPromise = undefined;
    throw error;
  });
  return poolPromise;
}

export async function databaseHealth() {
  if (!databaseConfigured()) return { configured: false, connected: false };
  try {
    const pool = await databasePool();
    const result = await pool.request().query('SELECT DB_NAME() AS [database], @@SERVERNAME AS [server], SYSUTCDATETIME() AS [utc]');
    return { configured: true, connected: true, ...result.recordset[0] };
  } catch (error) {
    return { configured: true, connected: false, error: error?.code || 'DATABASE_UNAVAILABLE' };
  }
}

const roleCodes = {
  operator: 'OPERATOR', qc: 'QUALITY_CONTROL', production: 'PRODUCTION_CONTROL',
  packaging: 'PACKAGING', engineering: 'ENGINEERING', admin: 'SYSTEM_ADMIN',
};

async function ensureIdentity(request, user) {
  const roleCode = roleCodes[user.role] || 'OPERATOR';
  const result = await request
    .input('username', sql.NVarChar(100), user.username)
    .input('displayName', sql.NVarChar(180), user.displayName || user.username)
    .input('roleCode', sql.VarChar(60), roleCode)
    .query(`
      MERGE security.Users AS Target
      USING (SELECT @username AS UserName, @displayName AS DisplayName) AS Source
      ON Target.UserName = Source.UserName
      WHEN MATCHED THEN UPDATE SET DisplayName = Source.DisplayName, IsActive = 1, UpdatedAtUtc = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (UserName, DisplayName) VALUES (Source.UserName, Source.DisplayName);

      DECLARE @UserId UNIQUEIDENTIFIER = (SELECT Id FROM security.Users WHERE UserName = @username);
      DECLARE @RoleId UNIQUEIDENTIFIER = (SELECT Id FROM security.Roles WHERE Code = @roleCode);
      IF @RoleId IS NULL THROW 51000, 'ROLE_NOT_CONFIGURED', 1;
      IF NOT EXISTS (SELECT 1 FROM security.UserRoles WHERE UserId = @UserId AND RoleId = @RoleId)
        INSERT INTO security.UserRoles (UserId, RoleId) VALUES (@UserId, @RoleId);
      SELECT @UserId AS UserId, @RoleId AS RoleId;
    `);
  return result.recordset[0];
}

function assembleProjects(result) {
  const [projectRows, drawingRows, setRows, stepRows] = result.recordsets;
  const drawings = new Map();
  for (const row of drawingRows) {
    const key = String(row.ProjectId).toLowerCase();
    if (!drawings.has(key)) drawings.set(key, []);
    drawings.get(key).push(row.DrawingNumber);
  }
  const steps = new Map();
  for (const row of stepRows) {
    const key = String(row.ItemDefinitionId).toLowerCase();
    if (!steps.has(key)) steps.set(key, []);
    steps.get(key).push({
      id: String(row.Id), name: row.StepName,
      execution: row.ExecutionType === 'EXTERNAL' ? 'external' : 'internal',
      qcRequired: Boolean(row.RequiresQcApproval),
      productionControlRequired: Boolean(row.RequiresProductionControl),
      barcodeAfter: row.BarcodePolicy === 'AFTER_STEP',
    });
  }
  const sets = new Map();
  for (const row of setRows) {
    const projectKey = String(row.ProjectId).toLowerCase();
    if (!sets.has(projectKey)) sets.set(projectKey, []);
    sets.get(projectKey).push({
      id: String(row.Id), name: row.ItemName, code: row.ItemCode,
      kind: row.ItemType === 'SINGLE' ? 'single' : 'assembly',
      operatorRole: row.OperatorRoleKey || 'اپراتور تولید',
      steps: steps.get(String(row.Id).toLowerCase()) || [],
    });
  }
  return projectRows.map((row) => {
    const key = String(row.Id).toLowerCase();
    return {
      id: String(row.Id), name: row.ProjectName, code: row.ProjectCode,
      itemType: row.ItemType === 'SINGLE' ? 'single' : 'assembly',
      drawings: drawings.get(key) || [], sets: sets.get(key) || [],
      createdAt: row.CreatedAtUtc, updatedAt: row.UpdatedAtUtc,
    };
  });
}

export async function listProjects(projectId = null) {
  const pool = await databasePool();
  const request = pool.request().input('projectId', sql.UniqueIdentifier, projectId);
  const result = await request.query(`
    SELECT Id, ProjectCode, ProjectName, ItemType, CreatedAtUtc, UpdatedAtUtc
      FROM core.Projects WHERE @projectId IS NULL OR Id = @projectId ORDER BY CreatedAtUtc;
    SELECT ProjectId, DrawingNumber FROM core.Drawings
      WHERE @projectId IS NULL OR ProjectId = @projectId ORDER BY CreatedAtUtc;
    SELECT Id, ProjectId, ItemCode, ItemName, ItemType, SetOrder, OperatorRoleKey
      FROM engineering.ItemDefinitions WHERE @projectId IS NULL OR ProjectId = @projectId ORDER BY ProjectId, SetOrder;
    SELECT Steps.Id, Items.Id AS ItemDefinitionId, Steps.StepName, Steps.ExecutionType,
           Steps.RequiresQcApproval, Steps.RequiresProductionControl, Steps.BarcodePolicy
      FROM engineering.RouteSteps Steps
      JOIN engineering.RouteDefinitions Routes ON Routes.Id = Steps.RouteDefinitionId
      JOIN engineering.ItemDefinitions Items ON Items.Id = Routes.ItemDefinitionId
      WHERE Routes.VersionNumber = (SELECT MAX(CurrentRoute.VersionNumber) FROM engineering.RouteDefinitions CurrentRoute WHERE CurrentRoute.ItemDefinitionId = Items.Id)
        AND (@projectId IS NULL OR Items.ProjectId = @projectId)
      ORDER BY Items.ProjectId, Items.SetOrder, Steps.StepOrder;
  `);
  return assembleProjects(result);
}

export async function createProject(input, actor) {
  const pool = await databasePool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const identity = await ensureIdentity(new sql.Request(transaction), actor);
    const projectId = randomUUID();
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, projectId)
      .input('code', sql.NVarChar(60), input.code.trim())
      .input('name', sql.NVarChar(220), input.name.trim())
      .input('itemType', sql.VarChar(20), input.itemType === 'single' ? 'SINGLE' : 'ASSEMBLY')
      .input('userId', sql.UniqueIdentifier, identity.UserId)
      .query(`INSERT INTO core.Projects (Id, ProjectCode, ProjectName, ItemType, CreatedByUserId)
              VALUES (@id, @code, @name, @itemType, @userId);`);
    for (const drawing of input.drawings) {
      await new sql.Request(transaction)
        .input('projectId', sql.UniqueIdentifier, projectId)
        .input('drawing', sql.NVarChar(100), drawing)
        .query(`INSERT INTO core.Drawings (ProjectId, DrawingNumber, RevisionCode)
                VALUES (@projectId, @drawing, N'REV-0');`);
    }
    await new sql.Request(transaction)
      .input('userId', sql.UniqueIdentifier, identity.UserId)
      .input('roleId', sql.UniqueIdentifier, identity.RoleId)
      .input('correlationId', sql.UniqueIdentifier, randomUUID())
      .input('entityId', sql.NVarChar(100), projectId)
      .input('after', sql.NVarChar(sql.MAX), JSON.stringify(input))
      .query(`INSERT INTO ops.AuditLogs (ActorUserId, ActorRoleId, EventType, EntityType, EntityId, CorrelationId, AfterJson)
              VALUES (@userId, @roleId, 'PROJECT_CREATED', 'PROJECT', @entityId, @correlationId, @after);`);
    await transaction.commit();
    return (await listProjects(projectId))[0];
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function replaceProjectRoute(projectId, projectSets, actor) {
  const pool = await databasePool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const identity = await ensureIdentity(new sql.Request(transaction), actor);
    const guard = await new sql.Request(transaction).input('projectId', sql.UniqueIdentifier, projectId)
      .query('SELECT COUNT_BIG(*) AS WorkItemCount FROM production.WorkItems WITH (UPDLOCK, HOLDLOCK) WHERE ProjectId = @projectId;');
    if (Number(guard.recordset[0].WorkItemCount) > 0) {
      const error = new Error('ROUTE_ALREADY_IN_USE'); error.statusCode = 409; throw error;
    }
    const request = new sql.Request(transaction).input('projectId', sql.UniqueIdentifier, projectId);
    const exists = await request.query('SELECT Id FROM core.Projects WITH (UPDLOCK, HOLDLOCK) WHERE Id = @projectId;');
    if (!exists.recordset.length) { const error = new Error('PROJECT_NOT_FOUND'); error.statusCode = 404; throw error; }
    await new sql.Request(transaction).input('projectId', sql.UniqueIdentifier, projectId).query(`
      DELETE Steps FROM engineering.RouteSteps Steps
        JOIN engineering.RouteDefinitions Routes ON Routes.Id = Steps.RouteDefinitionId
        JOIN engineering.ItemDefinitions Items ON Items.Id = Routes.ItemDefinitionId WHERE Items.ProjectId = @projectId;
      DELETE Routes FROM engineering.RouteDefinitions Routes
        JOIN engineering.ItemDefinitions Items ON Items.Id = Routes.ItemDefinitionId WHERE Items.ProjectId = @projectId;
      DELETE FROM engineering.ItemDefinitions WHERE ProjectId = @projectId;
    `);
    for (let setIndex = 0; setIndex < projectSets.length; setIndex += 1) {
      const set = projectSets[setIndex];
      const setId = set.id || randomUUID();
      const setCode = set.code || `SET-${String(setIndex + 1).padStart(3, '0')}`;
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, setId).input('projectId', sql.UniqueIdentifier, projectId)
        .input('code', sql.NVarChar(80), setCode).input('name', sql.NVarChar(220), set.name)
        .input('type', sql.VarChar(20), set.kind === 'single' ? 'SINGLE' : 'ASSEMBLY')
        .input('order', sql.Int, setIndex + 1).input('role', sql.NVarChar(120), set.operatorRole)
        .query(`INSERT INTO engineering.ItemDefinitions (Id, ProjectId, ItemCode, ItemName, ItemType, PlannedQuantity, SetOrder, OperatorRoleKey)
                VALUES (@id, @projectId, @code, @name, @type, 1, @order, @role);`);
      const routeId = randomUUID();
      await new sql.Request(transaction)
        .input('id', sql.UniqueIdentifier, routeId).input('setId', sql.UniqueIdentifier, setId)
        .input('userId', sql.UniqueIdentifier, identity.UserId)
        .query(`INSERT INTO engineering.RouteDefinitions (Id, ItemDefinitionId, VersionNumber, Status, CreatedByUserId)
                VALUES (@id, @setId, 1, 'DRAFT', @userId);`);
      for (let stepIndex = 0; stepIndex < set.steps.length; stepIndex += 1) {
        const step = set.steps[stepIndex];
        await new sql.Request(transaction)
          .input('id', sql.UniqueIdentifier, step.id || randomUUID()).input('routeId', sql.UniqueIdentifier, routeId)
          .input('order', sql.Int, stepIndex + 1).input('code', sql.NVarChar(60), `${setCode}-S${String(stepIndex + 1).padStart(2, '0')}`)
          .input('name', sql.NVarChar(180), step.name).input('execution', sql.VarChar(20), step.execution === 'external' ? 'EXTERNAL' : 'INTERNAL')
          .input('station', sql.NVarChar(60), set.operatorRole).input('contractor', sql.NVarChar(60), step.execution === 'external' ? 'ENGINEERING_PENDING' : null)
          .input('qc', sql.Bit, true).input('production', sql.Bit, true)
          .input('barcode', sql.VarChar(40), 'NO_CHANGE')
          .query(`INSERT INTO engineering.RouteSteps
            (Id, RouteDefinitionId, StepOrder, StepCode, StepName, ExecutionType, WorkstationCode, ContractorCode,
             RequiresQcApproval, RequiresProductionControl, BarcodePolicy)
            VALUES (@id, @routeId, @order, @code, @name, @execution, @station, @contractor, @qc, @production, @barcode);`);
      }
    }
    await new sql.Request(transaction).input('projectId', sql.UniqueIdentifier, projectId)
      .query('UPDATE core.Projects SET UpdatedAtUtc = SYSUTCDATETIME() WHERE Id = @projectId;');
    await new sql.Request(transaction)
      .input('userId', sql.UniqueIdentifier, identity.UserId).input('roleId', sql.UniqueIdentifier, identity.RoleId)
      .input('correlationId', sql.UniqueIdentifier, randomUUID()).input('entityId', sql.NVarChar(100), projectId)
      .input('after', sql.NVarChar(sql.MAX), JSON.stringify({ sets: projectSets }))
      .query(`INSERT INTO ops.AuditLogs (ActorUserId, ActorRoleId, EventType, EntityType, EntityId, CorrelationId, AfterJson)
              VALUES (@userId, @roleId, 'PROJECT_ROUTE_REPLACED', 'PROJECT', @entityId, @correlationId, @after);`);
    await transaction.commit();
    return (await listProjects(projectId))[0];
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function issueWorkItem(input, actor) {
  const pool = await databasePool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const identity = await ensureIdentity(new sql.Request(transaction), actor);
    const route = await new sql.Request(transaction)
      .input('projectId', sql.UniqueIdentifier, input.projectId)
      .query(`SELECT TOP (1) Items.Id AS ItemDefinitionId, Routes.Id AS RouteDefinitionId, Steps.Id AS FirstStepId
        FROM engineering.ItemDefinitions Items
        JOIN engineering.RouteDefinitions Routes ON Routes.ItemDefinitionId = Items.Id
        LEFT JOIN engineering.RouteSteps Steps ON Steps.RouteDefinitionId = Routes.Id AND Steps.StepOrder = 1
        WHERE Items.ProjectId = @projectId
          AND Routes.VersionNumber = (SELECT MAX(CurrentRoute.VersionNumber) FROM engineering.RouteDefinitions CurrentRoute WHERE CurrentRoute.ItemDefinitionId = Items.Id)
        ORDER BY Items.SetOrder, Routes.VersionNumber DESC;`);
    if (!route.recordset.length) { const error = new Error('SET_ROUTE_NOT_FOUND'); error.statusCode = 404; throw error; }
    if (!route.recordset[0].FirstStepId) { const error = new Error('SET_ROUTE_EMPTY'); error.statusCode = 422; throw error; }
    const workItemId = randomUUID();
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, workItemId).input('projectId', sql.UniqueIdentifier, input.projectId)
      .input('itemId', sql.UniqueIdentifier, route.recordset[0].ItemDefinitionId)
      .input('routeId', sql.UniqueIdentifier, route.recordset[0].RouteDefinitionId)
      .input('serial', sql.NVarChar(100), input.serialNumber).input('stepId', sql.UniqueIdentifier, route.recordset[0].FirstStepId)
      .query(`INSERT INTO production.WorkItems (Id, ProjectId, ItemDefinitionId, RouteDefinitionId, SerialNumber, CurrentRouteStepId, CurrentStatus)
              VALUES (@id, @projectId, @itemId, @routeId, @serial, @stepId, 'READY');`);
    const barcodeId = randomUUID();
    await new sql.Request(transaction)
      .input('id', sql.UniqueIdentifier, barcodeId).input('workItemId', sql.UniqueIdentifier, workItemId)
      .input('barcode', sql.NVarChar(160), input.barcode).input('userId', sql.UniqueIdentifier, identity.UserId)
      .query(`INSERT INTO production.Barcodes (Id, WorkItemId, BarcodeValue, IssuedByUserId)
              VALUES (@id, @workItemId, @barcode, @userId);`);
    await new sql.Request(transaction)
      .input('workItemId', sql.UniqueIdentifier, workItemId).input('stepId', sql.UniqueIdentifier, route.recordset[0].FirstStepId)
      .query(`INSERT INTO production.StepExecutions (WorkItemId, RouteStepId, Status) VALUES (@workItemId, @stepId, 'READY');`);
    await new sql.Request(transaction)
      .input('userId', sql.UniqueIdentifier, identity.UserId).input('roleId', sql.UniqueIdentifier, identity.RoleId)
      .input('correlationId', sql.UniqueIdentifier, randomUUID()).input('entityId', sql.NVarChar(100), workItemId)
      .input('after', sql.NVarChar(sql.MAX), JSON.stringify(input))
      .query(`INSERT INTO ops.AuditLogs (ActorUserId, ActorRoleId, EventType, EntityType, EntityId, CorrelationId, AfterJson)
              VALUES (@userId, @roleId, 'WORK_ITEM_ISSUED', 'WORK_ITEM', @entityId, @correlationId, @after);`);
    await transaction.commit();
    return { id: workItemId, barcode: input.barcode, serialNumber: input.serialNumber, status: 'READY' };
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

function actionFor(context, actor) {
  if (!context) return { allowed: false, reason: 'BARCODE_NOT_FOUND' };
  if (actor.role === 'operator') {
    if (!actor.scope) return { allowed: false, reason: 'OPERATOR_ASSIGNMENT_REQUIRED' };
    if (String(actor.scope).trim().toLocaleLowerCase('fa') !== String(context.OperatorRoleKey || '').trim().toLocaleLowerCase('fa')) return { allowed: false, reason: 'OPERATOR_NOT_ASSIGNED' };
    if (!['READY', 'IN_PROGRESS'].includes(context.ExecutionStatus)) return { allowed: false, reason: 'STEP_NOT_READY' };
    return { allowed: true, code: 'OPERATOR_COMPLETE', title: `ثبت اتمام «${context.SetName}»` };
  }
  if (actor.role === 'packaging') {
    const station = `${context.SetName || ''} ${context.OperatorRoleKey || ''}`;
    if (!/پکیج|بسته.?بندی/i.test(station)) return { allowed: false, reason: 'OPERATOR_NOT_ASSIGNED' };
    if (!['READY', 'IN_PROGRESS'].includes(context.ExecutionStatus)) return { allowed: false, reason: 'STEP_NOT_READY' };
    return { allowed: true, code: 'OPERATOR_COMPLETE', title: `ثبت اتمام «${context.SetName}»` };
  }
  if (actor.role === 'qc') return context.ExecutionStatus === 'WAITING_QC'
    ? { allowed: true, code: 'QC_APPROVE', title: 'تأیید کنترل کیفیت' }
    : { allowed: false, reason: 'QC_NOT_READY' };
  if (actor.role === 'production') return context.ExecutionStatus === 'WAITING_PRODUCTION_CONTROL'
    ? { allowed: true, code: 'PRODUCTION_APPROVE', title: 'تأیید کنترل تولید' }
    : { allowed: false, reason: 'PRODUCTION_CONTROL_NOT_READY' };
  return { allowed: false, reason: 'ROLE_CANNOT_SCAN' };
}

function publicScanContext(row, action) {
  return {
    code: row.BarcodeValue, project: { id: String(row.ProjectId), code: row.ProjectCode, name: row.ProjectName },
    set: { id: String(row.ItemDefinitionId), code: row.SetCode, name: row.SetName },
    step: row.RouteStepId ? { id: String(row.RouteStepId), name: row.StepName } : null,
    serialNumber: row.SerialNumber, status: row.WorkItemStatus,
    executionStatus: row.ExecutionStatus, allowed: action.allowed,
    action: action.allowed ? { code: action.code, title: action.title } : null,
    rejectionReason: action.allowed ? null : action.reason,
  };
}

async function barcodeContext(request, code, lock = false) {
  return request.input('barcode', sql.NVarChar(160), code).query(`SELECT TOP (1)
      Barcodes.Id AS BarcodeId, Barcodes.BarcodeValue, WorkItems.Id AS WorkItemId, WorkItems.ProjectId,
      WorkItems.ItemDefinitionId, WorkItems.RouteDefinitionId, WorkItems.CurrentRouteStepId AS RouteStepId,
      WorkItems.SerialNumber, WorkItems.CurrentStatus AS WorkItemStatus,
      Projects.ProjectCode, Projects.ProjectName, Items.ItemCode AS SetCode, Items.ItemName AS SetName, Items.OperatorRoleKey,
      Steps.StepName, Steps.StepOrder, Steps.RequiresQcApproval, Steps.RequiresProductionControl,
      Executions.Id AS StepExecutionId, Executions.Status AS ExecutionStatus
    FROM production.Barcodes Barcodes ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
    JOIN production.WorkItems WorkItems ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''} ON WorkItems.Id = Barcodes.WorkItemId
    JOIN core.Projects Projects ON Projects.Id = WorkItems.ProjectId
    JOIN engineering.ItemDefinitions Items ON Items.Id = WorkItems.ItemDefinitionId
    LEFT JOIN engineering.RouteSteps Steps ON Steps.Id = WorkItems.CurrentRouteStepId
    LEFT JOIN production.StepExecutions Executions ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
      ON Executions.WorkItemId = WorkItems.Id AND Executions.RouteStepId = WorkItems.CurrentRouteStepId
      AND Executions.AttemptNumber = (SELECT MAX(CurrentExecution.AttemptNumber) FROM production.StepExecutions CurrentExecution WHERE CurrentExecution.WorkItemId = WorkItems.Id AND CurrentExecution.RouteStepId = WorkItems.CurrentRouteStepId)
    WHERE Barcodes.BarcodeValue = @barcode AND Barcodes.Status = 'ACTIVE';`);
}

export async function resolveBarcode(code, actor) {
  const pool = await databasePool();
  const result = await barcodeContext(pool.request(), code, false);
  const row = result.recordset[0];
  if (!row) return null;
  return publicScanContext(row, actionFor(row, actor));
}

async function ensureScanSession(request, identity, actor) {
  const stationCode = String(actor.scope || roleCodes[actor.role] || 'UNASSIGNED').slice(0, 60);
  const stationType = String(roleCodes[actor.role] || 'OPERATOR').slice(0, 40);
  const result = await request
    .input('stationCode', sql.NVarChar(60), stationCode).input('stationTitle', sql.NVarChar(180), actor.scope || stationCode)
    .input('stationType', sql.VarChar(40), stationType).input('userId', sql.UniqueIdentifier, identity.UserId)
    .input('roleId', sql.UniqueIdentifier, identity.RoleId).input('sessionId', sql.UniqueIdentifier, randomUUID())
    .query(`
      IF NOT EXISTS (SELECT 1 FROM production.Workstations WHERE Code = @stationCode)
        INSERT INTO production.Workstations (Code, Title, WorkstationType) VALUES (@stationCode, @stationTitle, @stationType);
      DECLARE @StationId UNIQUEIDENTIFIER = (SELECT Id FROM production.Workstations WHERE Code = @stationCode);
      IF NOT EXISTS (SELECT 1 FROM security.UserStationAssignments WHERE UserId=@userId AND RoleId=@roleId AND WorkstationId=@StationId)
        INSERT INTO security.UserStationAssignments (UserId, RoleId, WorkstationId) VALUES (@userId, @roleId, @StationId);
      INSERT INTO production.ScanSessions (Id, UserId, ActiveRoleId, WorkstationId, ExpiresAtUtc)
        VALUES (@sessionId, @userId, @roleId, @StationId, DATEADD(MINUTE, 10, SYSUTCDATETIME()));
      SELECT @sessionId AS SessionId;
    `);
  return result.recordset[0].SessionId;
}

export async function confirmBarcode(input, actor) {
  const pool = await databasePool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const duplicate = await new sql.Request(transaction).input('requestId', sql.UniqueIdentifier, input.clientRequestId)
      .query('SELECT TOP (1) Result FROM production.ScanEvents WITH (UPDLOCK, HOLDLOCK) WHERE ClientRequestId=@requestId;');
    if (duplicate.recordset.length) { await transaction.commit(); return { duplicate: true }; }
    const identity = await ensureIdentity(new sql.Request(transaction), actor);
    const contextResult = await barcodeContext(new sql.Request(transaction), input.code, true);
    const row = contextResult.recordset[0];
    if (!row) { const error = new Error('BARCODE_NOT_FOUND'); error.statusCode = 404; throw error; }
    let action = actionFor(row, actor);
    if (actor.role === 'qc' && input.decision === 'reject') {
      action = row.ExecutionStatus === 'WAITING_QC'
        ? { allowed: true, code: 'QC_REJECT', title: input.reworkMode === 'independent' ? 'ارجاع به بازکاری مستقل' : 'بازگشت به همین مجموعه' }
        : { allowed: false, reason: 'QC_NOT_READY' };
    }
    if (!action.allowed) { const error = new Error(action.reason); error.statusCode = 409; throw error; }
    const scanSessionId = await ensureScanSession(new sql.Request(transaction), identity, actor);
    if (action.code === 'OPERATOR_COMPLETE') {
      const nextStatus = row.RequiresQcApproval ? 'WAITING_QC' : row.RequiresProductionControl ? 'WAITING_PRODUCTION_CONTROL' : 'COMPLETED';
      await new sql.Request(transaction).input('executionId', sql.UniqueIdentifier, row.StepExecutionId).input('status', sql.VarChar(40), nextStatus)
        .query(`UPDATE production.StepExecutions SET Status=@status, OperatorCompletedAtUtc=SYSUTCDATETIME(), StartedAtUtc=COALESCE(StartedAtUtc,SYSUTCDATETIME()) WHERE Id=@executionId;`);
    } else if (action.code === 'QC_APPROVE') {
      const nextStatus = row.RequiresProductionControl ? 'WAITING_PRODUCTION_CONTROL' : 'COMPLETED';
      await new sql.Request(transaction).input('executionId', sql.UniqueIdentifier, row.StepExecutionId).input('status', sql.VarChar(40), nextStatus)
        .query(`UPDATE production.StepExecutions SET Status=@status, QcCompletedAtUtc=SYSUTCDATETIME() WHERE Id=@executionId;`);
    } else if (action.code === 'PRODUCTION_APPROVE') {
      await new sql.Request(transaction).input('executionId', sql.UniqueIdentifier, row.StepExecutionId)
        .query(`UPDATE production.StepExecutions SET Status='COMPLETED', ProductionControlCompletedAtUtc=SYSUTCDATETIME() WHERE Id=@executionId;`);
    } else if (action.code === 'QC_REJECT') {
      const mode = input.reworkMode === 'independent' ? 'INDEPENDENT' : 'SAME_STEP';
      const caseStatus = mode === 'INDEPENDENT' ? 'AWAITING_ROUTE' : 'RETURNED_TO_STEP';
      await new sql.Request(transaction)
        .input('workItemId', sql.UniqueIdentifier, row.WorkItemId).input('executionId', sql.UniqueIdentifier, row.StepExecutionId)
        .input('mode', sql.VarChar(30), mode).input('status', sql.VarChar(30), caseStatus)
        .input('reason', sql.NVarChar(1000), input.comment).input('userId', sql.UniqueIdentifier, identity.UserId)
        .input('roleId', sql.UniqueIdentifier, identity.RoleId)
        .query(`INSERT INTO production.ReworkCases (WorkItemId, SourceStepExecutionId, ReworkMode, Status, Reason, CreatedByUserId, CreatedByRoleId)
                VALUES (@workItemId,@executionId,@mode,@status,@reason,@userId,@roleId);`);
      if (mode === 'SAME_STEP') {
        await new sql.Request(transaction)
          .input('workItemId', sql.UniqueIdentifier, row.WorkItemId).input('stepId', sql.UniqueIdentifier, row.RouteStepId)
          .input('executionId', sql.UniqueIdentifier, row.StepExecutionId)
          .query(`UPDATE production.StepExecutions SET Status='QC_REJECTED', QcCompletedAtUtc=SYSUTCDATETIME(), CompletedAtUtc=SYSUTCDATETIME() WHERE Id=@executionId;
                  DECLARE @Attempt INT = (SELECT ISNULL(MAX(AttemptNumber),0)+1 FROM production.StepExecutions WHERE WorkItemId=@workItemId AND RouteStepId=@stepId);
                  INSERT INTO production.StepExecutions (WorkItemId, RouteStepId, AttemptNumber, Status) VALUES (@workItemId,@stepId,@Attempt,'READY');
                  UPDATE production.WorkItems SET CurrentStatus='READY' WHERE Id=@workItemId;`);
      } else {
        await new sql.Request(transaction).input('workItemId', sql.UniqueIdentifier, row.WorkItemId).input('executionId', sql.UniqueIdentifier, row.StepExecutionId)
          .query(`UPDATE production.StepExecutions SET Status='REWORK_REQUIRED', QcCompletedAtUtc=SYSUTCDATETIME() WHERE Id=@executionId;
                  UPDATE production.WorkItems SET CurrentStatus='ON_HOLD' WHERE Id=@workItemId;`);
      }
    }
    if (action.code !== 'QC_REJECT') {
      const execution = await new sql.Request(transaction).input('executionId', sql.UniqueIdentifier, row.StepExecutionId)
        .query('SELECT Status FROM production.StepExecutions WHERE Id=@executionId;');
      if (execution.recordset[0].Status === 'COMPLETED') {
        await new sql.Request(transaction).input('executionId', sql.UniqueIdentifier, row.StepExecutionId)
          .query('UPDATE production.StepExecutions SET CompletedAtUtc=SYSUTCDATETIME() WHERE Id=@executionId;');
        const next = await new sql.Request(transaction).input('routeId', sql.UniqueIdentifier, row.RouteDefinitionId).input('order', sql.Int, row.StepOrder)
          .query('SELECT TOP (1) Id, @routeId AS RouteDefinitionId, NULL AS ItemDefinitionId FROM engineering.RouteSteps WHERE RouteDefinitionId=@routeId AND StepOrder>@order ORDER BY StepOrder;');
        if (next.recordset.length) {
          await new sql.Request(transaction).input('workItemId', sql.UniqueIdentifier, row.WorkItemId).input('stepId', sql.UniqueIdentifier, next.recordset[0].Id)
            .query(`INSERT INTO production.StepExecutions (WorkItemId, RouteStepId, Status) VALUES (@workItemId,@stepId,'READY');
                    UPDATE production.WorkItems SET CurrentRouteStepId=@stepId, CurrentStatus='READY' WHERE Id=@workItemId;`);
        } else {
          const nextSet = await new sql.Request(transaction)
            .input('projectId', sql.UniqueIdentifier, row.ProjectId)
            .input('currentItemId', sql.UniqueIdentifier, row.ItemDefinitionId)
            .query(`SELECT TOP (1) NextItem.Id AS ItemDefinitionId, NextRoute.Id AS RouteDefinitionId, NextStep.Id
              FROM engineering.ItemDefinitions CurrentItem
              JOIN engineering.ItemDefinitions NextItem ON NextItem.ProjectId = CurrentItem.ProjectId AND NextItem.SetOrder > CurrentItem.SetOrder
              JOIN engineering.RouteDefinitions NextRoute ON NextRoute.ItemDefinitionId = NextItem.Id
                AND NextRoute.VersionNumber = (SELECT MAX(CurrentRoute.VersionNumber) FROM engineering.RouteDefinitions CurrentRoute WHERE CurrentRoute.ItemDefinitionId = NextItem.Id)
              JOIN engineering.RouteSteps NextStep ON NextStep.RouteDefinitionId = NextRoute.Id AND NextStep.StepOrder = 1
              WHERE CurrentItem.Id = @currentItemId AND CurrentItem.ProjectId = @projectId
              ORDER BY NextItem.SetOrder;`);
          if (nextSet.recordset.length) {
            const target = nextSet.recordset[0];
            await new sql.Request(transaction).input('workItemId', sql.UniqueIdentifier, row.WorkItemId)
              .input('itemId', sql.UniqueIdentifier, target.ItemDefinitionId).input('routeId', sql.UniqueIdentifier, target.RouteDefinitionId)
              .input('stepId', sql.UniqueIdentifier, target.Id)
              .query(`INSERT INTO production.StepExecutions (WorkItemId, RouteStepId, Status) VALUES (@workItemId,@stepId,'READY');
                      UPDATE production.WorkItems SET ItemDefinitionId=@itemId, RouteDefinitionId=@routeId, CurrentRouteStepId=@stepId, CurrentStatus='READY' WHERE Id=@workItemId;`);
          } else {
            await new sql.Request(transaction).input('workItemId', sql.UniqueIdentifier, row.WorkItemId)
              .query(`UPDATE production.WorkItems SET CurrentRouteStepId=NULL, CurrentStatus='COMPLETED', CompletedAtUtc=SYSUTCDATETIME() WHERE Id=@workItemId;`);
          }
        }
      } else {
        await new sql.Request(transaction).input('workItemId', sql.UniqueIdentifier, row.WorkItemId).input('status', sql.VarChar(40), execution.recordset[0].Status)
          .query('UPDATE production.WorkItems SET CurrentStatus=@status WHERE Id=@workItemId;');
      }
    }
    await new sql.Request(transaction)
      .input('requestId', sql.UniqueIdentifier, input.clientRequestId).input('sessionId', sql.UniqueIdentifier, scanSessionId)
      .input('workItemId', sql.UniqueIdentifier, row.WorkItemId).input('barcodeId', sql.UniqueIdentifier, row.BarcodeId)
      .input('executionId', sql.UniqueIdentifier, row.StepExecutionId).input('source', sql.VarChar(20), input.inputSource)
      .input('code', sql.NVarChar(200), input.code).input('action', sql.VarChar(80), action.code)
      .input('manualReason', sql.NVarChar(300), input.manualReason || null)
      .query(`INSERT INTO production.ScanEvents (ClientRequestId, ScanSessionId, WorkItemId, BarcodeId, StepExecutionId, InputSource, RawCode, ResolvedAction, Result, ManualEntryReason)
              VALUES (@requestId,@sessionId,@workItemId,@barcodeId,@executionId,@source,@code,@action,'ACCEPTED',@manualReason);`);
    {
      const approvalType = { OPERATOR_COMPLETE: 'OPERATOR', QC_APPROVE: 'QUALITY_CONTROL', QC_REJECT: 'QUALITY_CONTROL', PRODUCTION_APPROVE: 'PRODUCTION_CONTROL' }[action.code];
      const decision = action.code === 'QC_REJECT' ? 'REJECTED' : 'APPROVED';
      await new sql.Request(transaction).input('executionId', sql.UniqueIdentifier, row.StepExecutionId)
        .input('type', sql.VarChar(30), approvalType).input('decision', sql.VarChar(30), decision)
        .input('comment', sql.NVarChar(1000), input.comment || null).input('userId', sql.UniqueIdentifier, identity.UserId).input('roleId', sql.UniqueIdentifier, identity.RoleId)
        .query(`INSERT INTO production.ApprovalDecisions (StepExecutionId, ApprovalType, Decision, DecidedByUserId, DecidedByRoleId, Comment)
                VALUES (@executionId,@type,@decision,@userId,@roleId,@comment);`);
    }
    await new sql.Request(transaction).input('userId', sql.UniqueIdentifier, identity.UserId).input('roleId', sql.UniqueIdentifier, identity.RoleId)
      .input('correlationId', sql.UniqueIdentifier, input.clientRequestId).input('entityId', sql.NVarChar(100), row.WorkItemId)
      .input('after', sql.NVarChar(sql.MAX), JSON.stringify({ action: action.code, code: input.code }))
      .query(`INSERT INTO ops.AuditLogs (ActorUserId, ActorRoleId, EventType, EntityType, EntityId, CorrelationId, AfterJson)
              VALUES (@userId,@roleId,'SCAN_ACTION_ACCEPTED','WORK_ITEM',@entityId,@correlationId,@after);`);
    await transaction.commit();
    return { duplicate: false, action: action.title, next: await resolveBarcode(input.code, actor) };
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function importLegacyState(state, actor) {
  if (!state?.projects?.length) return { imported: 0 };
  const existing = await listProjects();
  const existingCodes = new Set(existing.map((project) => project.code.toLowerCase()));
  let imported = 0;
  for (const project of state.projects) {
    if (existingCodes.has(String(project.code).toLowerCase())) continue;
    const created = await createProject(project, actor);
    if (Array.isArray(project.sets) && project.sets.length) await replaceProjectRoute(created.id, project.sets, actor);
    imported += 1;
  }
  return { imported };
}
