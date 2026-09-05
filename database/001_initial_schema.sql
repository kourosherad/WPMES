SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'core') EXEC(N'CREATE SCHEMA core');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'engineering') EXEC(N'CREATE SCHEMA engineering');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'production') EXEC(N'CREATE SCHEMA production');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'security') EXEC(N'CREATE SCHEMA security');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'ops') EXEC(N'CREATE SCHEMA ops');
GO

CREATE TABLE security.Users (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Users_Id DEFAULT NEWSEQUENTIALID(),
    UserName NVARCHAR(100) NOT NULL,
    DisplayName NVARCHAR(180) NOT NULL,
    EmployeeCode NVARCHAR(50) NULL,
    IdentityProviderId NVARCHAR(200) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(3) NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT PK_Users PRIMARY KEY (Id),
    CONSTRAINT UQ_Users_UserName UNIQUE (UserName)
);

CREATE TABLE security.Roles (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Roles_Id DEFAULT NEWSEQUENTIALID(),
    Code VARCHAR(60) NOT NULL,
    Title NVARCHAR(150) NOT NULL,
    RoleType VARCHAR(40) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Roles_IsActive DEFAULT (1),
    CONSTRAINT PK_Roles PRIMARY KEY (Id),
    CONSTRAINT UQ_Roles_Code UNIQUE (Code),
    CONSTRAINT CK_Roles_Type CHECK (RoleType IN ('OPERATOR','QUALITY_CONTROL','PRODUCTION_CONTROL','PACKAGING','ENGINEERING','ADMIN','VIEWER'))
);

CREATE TABLE security.Permissions (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Permissions_Id DEFAULT NEWSEQUENTIALID(),
    Code VARCHAR(120) NOT NULL,
    Title NVARCHAR(180) NOT NULL,
    CONSTRAINT PK_Permissions PRIMARY KEY (Id),
    CONSTRAINT UQ_Permissions_Code UNIQUE (Code)
);

CREATE TABLE security.UserRoles (
    UserId UNIQUEIDENTIFIER NOT NULL,
    RoleId UNIQUEIDENTIFIER NOT NULL,
    ValidFromUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserRoles_From DEFAULT SYSUTCDATETIME(),
    ValidToUtc DATETIME2(3) NULL,
    AssignedByUserId UNIQUEIDENTIFIER NULL,
    CONSTRAINT PK_UserRoles PRIMARY KEY (UserId, RoleId),
    CONSTRAINT FK_UserRoles_User FOREIGN KEY (UserId) REFERENCES security.Users(Id),
    CONSTRAINT FK_UserRoles_Role FOREIGN KEY (RoleId) REFERENCES security.Roles(Id),
    CONSTRAINT FK_UserRoles_AssignedBy FOREIGN KEY (AssignedByUserId) REFERENCES security.Users(Id)
);

CREATE TABLE security.RolePermissions (
    RoleId UNIQUEIDENTIFIER NOT NULL,
    PermissionId UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT PK_RolePermissions PRIMARY KEY (RoleId, PermissionId),
    CONSTRAINT FK_RolePermissions_Role FOREIGN KEY (RoleId) REFERENCES security.Roles(Id),
    CONSTRAINT FK_RolePermissions_Permission FOREIGN KEY (PermissionId) REFERENCES security.Permissions(Id)
);
GO

CREATE TABLE core.Projects (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Projects_Id DEFAULT NEWSEQUENTIALID(),
    ProjectCode NVARCHAR(60) NOT NULL,
    ProjectName NVARCHAR(220) NOT NULL,
    CustomerName NVARCHAR(220) NULL,
    Status VARCHAR(30) NOT NULL CONSTRAINT DF_Projects_Status DEFAULT ('DRAFT'),
    Priority TINYINT NOT NULL CONSTRAINT DF_Projects_Priority DEFAULT (2),
    PlannedStartDate DATE NULL,
    PlannedDeliveryDate DATE NULL,
    CreatedByUserId UNIQUEIDENTIFIER NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_Projects_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(3) NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT PK_Projects PRIMARY KEY (Id),
    CONSTRAINT UQ_Projects_Code UNIQUE (ProjectCode),
    CONSTRAINT FK_Projects_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES security.Users(Id),
    CONSTRAINT CK_Projects_Status CHECK (Status IN ('DRAFT','ACTIVE','ON_HOLD','COMPLETED','CANCELLED')),
    CONSTRAINT CK_Projects_Priority CHECK (Priority BETWEEN 1 AND 4)
);

CREATE TABLE core.Drawings (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Drawings_Id DEFAULT NEWSEQUENTIALID(),
    ProjectId UNIQUEIDENTIFIER NOT NULL,
    DrawingNumber NVARCHAR(100) NOT NULL,
    RevisionCode NVARCHAR(30) NOT NULL,
    Title NVARCHAR(250) NULL,
    FileStorageKey NVARCHAR(500) NULL,
    FileSha256 CHAR(64) NULL,
    IsCurrentRevision BIT NOT NULL CONSTRAINT DF_Drawings_Current DEFAULT (1),
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_Drawings_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Drawings PRIMARY KEY (Id),
    CONSTRAINT FK_Drawings_Project FOREIGN KEY (ProjectId) REFERENCES core.Projects(Id),
    CONSTRAINT UQ_Drawings_Project_Number_Revision UNIQUE (ProjectId, DrawingNumber, RevisionCode)
);
GO

CREATE TABLE engineering.ItemDefinitions (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ItemDefinitions_Id DEFAULT NEWSEQUENTIALID(),
    ProjectId UNIQUEIDENTIFIER NOT NULL,
    DrawingId UNIQUEIDENTIFIER NULL,
    ItemCode NVARCHAR(80) NOT NULL,
    ItemName NVARCHAR(220) NOT NULL,
    ItemType VARCHAR(20) NOT NULL,
    PlannedQuantity INT NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_ItemDefinitions_IsActive DEFAULT (1),
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ItemDefinitions_CreatedAt DEFAULT SYSUTCDATETIME(),
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT PK_ItemDefinitions PRIMARY KEY (Id),
    CONSTRAINT FK_ItemDefinitions_Project FOREIGN KEY (ProjectId) REFERENCES core.Projects(Id),
    CONSTRAINT FK_ItemDefinitions_Drawing FOREIGN KEY (DrawingId) REFERENCES core.Drawings(Id),
    CONSTRAINT UQ_ItemDefinitions_Project_Code UNIQUE (ProjectId, ItemCode),
    CONSTRAINT CK_ItemDefinitions_Type CHECK (ItemType IN ('SINGLE','ASSEMBLY')),
    CONSTRAINT CK_ItemDefinitions_Quantity CHECK (PlannedQuantity > 0)
);

CREATE TABLE engineering.RouteDefinitions (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RouteDefinitions_Id DEFAULT NEWSEQUENTIALID(),
    ItemDefinitionId UNIQUEIDENTIFIER NOT NULL,
    VersionNumber INT NOT NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_RouteDefinitions_Status DEFAULT ('DRAFT'),
    Notes NVARCHAR(1000) NULL,
    CreatedByUserId UNIQUEIDENTIFIER NOT NULL,
    PublishedByUserId UNIQUEIDENTIFIER NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_RouteDefinitions_CreatedAt DEFAULT SYSUTCDATETIME(),
    PublishedAtUtc DATETIME2(3) NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT PK_RouteDefinitions PRIMARY KEY (Id),
    CONSTRAINT FK_RouteDefinitions_Item FOREIGN KEY (ItemDefinitionId) REFERENCES engineering.ItemDefinitions(Id),
    CONSTRAINT FK_RouteDefinitions_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES security.Users(Id),
    CONSTRAINT FK_RouteDefinitions_PublishedBy FOREIGN KEY (PublishedByUserId) REFERENCES security.Users(Id),
    CONSTRAINT UQ_RouteDefinitions_Item_Version UNIQUE (ItemDefinitionId, VersionNumber),
    CONSTRAINT CK_RouteDefinitions_Status CHECK (Status IN ('DRAFT','IN_REVIEW','PUBLISHED','RETIRED')),
    CONSTRAINT CK_RouteDefinitions_Version CHECK (VersionNumber > 0)
);

CREATE TABLE engineering.RouteSteps (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RouteSteps_Id DEFAULT NEWSEQUENTIALID(),
    RouteDefinitionId UNIQUEIDENTIFIER NOT NULL,
    StepOrder INT NOT NULL,
    StepCode NVARCHAR(60) NOT NULL,
    StepName NVARCHAR(180) NOT NULL,
    ExecutionType VARCHAR(20) NOT NULL,
    WorkstationCode NVARCHAR(60) NULL,
    ContractorCode NVARCHAR(60) NULL,
    RequiresOperatorConfirmation BIT NOT NULL CONSTRAINT DF_RouteSteps_Operator DEFAULT (1),
    RequiresQcApproval BIT NOT NULL CONSTRAINT DF_RouteSteps_Qc DEFAULT (1),
    RequiresProductionControl BIT NOT NULL CONSTRAINT DF_RouteSteps_ProductionControl DEFAULT (1),
    BarcodePolicy VARCHAR(40) NOT NULL CONSTRAINT DF_RouteSteps_BarcodePolicy DEFAULT ('NO_CHANGE'),
    StandardDurationMinutes INT NULL,
    ConfigurationJson NVARCHAR(MAX) NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT PK_RouteSteps PRIMARY KEY (Id),
    CONSTRAINT FK_RouteSteps_Route FOREIGN KEY (RouteDefinitionId) REFERENCES engineering.RouteDefinitions(Id),
    CONSTRAINT UQ_RouteSteps_Route_Order UNIQUE (RouteDefinitionId, StepOrder),
    CONSTRAINT UQ_RouteSteps_Route_Code UNIQUE (RouteDefinitionId, StepCode),
    CONSTRAINT CK_RouteSteps_Order CHECK (StepOrder > 0),
    CONSTRAINT CK_RouteSteps_ExecutionType CHECK (ExecutionType IN ('INTERNAL','EXTERNAL')),
    CONSTRAINT CK_RouteSteps_ExternalConfig CHECK ((ExecutionType = 'INTERNAL') OR ContractorCode IS NOT NULL),
    CONSTRAINT CK_RouteSteps_BarcodePolicy CHECK (BarcodePolicy IN ('NO_CHANGE','ON_ITEM_CREATION','BEFORE_STEP','AFTER_STEP','ON_FACTORY_RECEIPT','MANUAL_WITH_APPROVAL')),
    CONSTRAINT CK_RouteSteps_ConfigurationJson CHECK (ConfigurationJson IS NULL OR ISJSON(ConfigurationJson) = 1)
);
GO

CREATE TABLE production.Workstations (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Workstations_Id DEFAULT NEWSEQUENTIALID(),
    Code NVARCHAR(60) NOT NULL,
    Title NVARCHAR(180) NOT NULL,
    WorkstationType VARCHAR(40) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Workstations_IsActive DEFAULT (1),
    CONSTRAINT PK_Workstations PRIMARY KEY (Id),
    CONSTRAINT UQ_Workstations_Code UNIQUE (Code)
);

CREATE TABLE security.UserStationAssignments (
    UserId UNIQUEIDENTIFIER NOT NULL,
    RoleId UNIQUEIDENTIFIER NOT NULL,
    WorkstationId UNIQUEIDENTIFIER NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_UserStationAssignments_Active DEFAULT (1),
    CONSTRAINT PK_UserStationAssignments PRIMARY KEY (UserId, RoleId, WorkstationId),
    CONSTRAINT FK_UserStationAssignments_UserRole FOREIGN KEY (UserId, RoleId) REFERENCES security.UserRoles(UserId, RoleId),
    CONSTRAINT FK_UserStationAssignments_Station FOREIGN KEY (WorkstationId) REFERENCES production.Workstations(Id)
);

CREATE TABLE production.WorkItems (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_WorkItems_Id DEFAULT NEWSEQUENTIALID(),
    ProjectId UNIQUEIDENTIFIER NOT NULL,
    ItemDefinitionId UNIQUEIDENTIFIER NOT NULL,
    RouteDefinitionId UNIQUEIDENTIFIER NOT NULL,
    SerialNumber NVARCHAR(100) NOT NULL,
    CurrentRouteStepId UNIQUEIDENTIFIER NULL,
    CurrentStatus VARCHAR(40) NOT NULL CONSTRAINT DF_WorkItems_Status DEFAULT ('CREATED'),
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_WorkItems_CreatedAt DEFAULT SYSUTCDATETIME(),
    CompletedAtUtc DATETIME2(3) NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT PK_WorkItems PRIMARY KEY (Id),
    CONSTRAINT FK_WorkItems_Project FOREIGN KEY (ProjectId) REFERENCES core.Projects(Id),
    CONSTRAINT FK_WorkItems_Item FOREIGN KEY (ItemDefinitionId) REFERENCES engineering.ItemDefinitions(Id),
    CONSTRAINT FK_WorkItems_Route FOREIGN KEY (RouteDefinitionId) REFERENCES engineering.RouteDefinitions(Id),
    CONSTRAINT FK_WorkItems_CurrentStep FOREIGN KEY (CurrentRouteStepId) REFERENCES engineering.RouteSteps(Id),
    CONSTRAINT UQ_WorkItems_Serial UNIQUE (SerialNumber),
    CONSTRAINT CK_WorkItems_Status CHECK (CurrentStatus IN ('CREATED','WAITING_FOR_BARCODE','READY','IN_PROGRESS','WAITING_QC','WAITING_PRODUCTION_CONTROL','WAITING_EXTERNAL_DISPATCH','AT_CONTRACTOR','WAITING_INCOMING_INSPECTION','WAITING_PACKAGING','COMPLETED','ON_HOLD','SCRAPPED'))
);

CREATE TABLE production.Barcodes (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Barcodes_Id DEFAULT NEWSEQUENTIALID(),
    WorkItemId UNIQUEIDENTIFIER NOT NULL,
    BarcodeValue NVARCHAR(160) NOT NULL,
    Status VARCHAR(20) NOT NULL CONSTRAINT DF_Barcodes_Status DEFAULT ('ACTIVE'),
    IssuedByUserId UNIQUEIDENTIFIER NOT NULL,
    IssuedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_Barcodes_IssuedAt DEFAULT SYSUTCDATETIME(),
    RevokedAtUtc DATETIME2(3) NULL,
    ReplacesBarcodeId UNIQUEIDENTIFIER NULL,
    CONSTRAINT PK_Barcodes PRIMARY KEY (Id),
    CONSTRAINT FK_Barcodes_WorkItem FOREIGN KEY (WorkItemId) REFERENCES production.WorkItems(Id),
    CONSTRAINT FK_Barcodes_IssuedBy FOREIGN KEY (IssuedByUserId) REFERENCES security.Users(Id),
    CONSTRAINT FK_Barcodes_Replaces FOREIGN KEY (ReplacesBarcodeId) REFERENCES production.Barcodes(Id),
    CONSTRAINT UQ_Barcodes_Value UNIQUE (BarcodeValue),
    CONSTRAINT CK_Barcodes_Status CHECK (Status IN ('ACTIVE','REVOKED','DAMAGED','REPLACED'))
);

CREATE TABLE production.StepExecutions (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_StepExecutions_Id DEFAULT NEWSEQUENTIALID(),
    WorkItemId UNIQUEIDENTIFIER NOT NULL,
    RouteStepId UNIQUEIDENTIFIER NOT NULL,
    AttemptNumber INT NOT NULL CONSTRAINT DF_StepExecutions_Attempt DEFAULT (1),
    Status VARCHAR(40) NOT NULL CONSTRAINT DF_StepExecutions_Status DEFAULT ('READY'),
    StartedAtUtc DATETIME2(3) NULL,
    OperatorCompletedAtUtc DATETIME2(3) NULL,
    QcCompletedAtUtc DATETIME2(3) NULL,
    ProductionControlCompletedAtUtc DATETIME2(3) NULL,
    CompletedAtUtc DATETIME2(3) NULL,
    RowVersion ROWVERSION NOT NULL,
    CONSTRAINT PK_StepExecutions PRIMARY KEY (Id),
    CONSTRAINT FK_StepExecutions_WorkItem FOREIGN KEY (WorkItemId) REFERENCES production.WorkItems(Id),
    CONSTRAINT FK_StepExecutions_RouteStep FOREIGN KEY (RouteStepId) REFERENCES engineering.RouteSteps(Id),
    CONSTRAINT UQ_StepExecutions_Attempt UNIQUE (WorkItemId, RouteStepId, AttemptNumber),
    CONSTRAINT CK_StepExecutions_Attempt CHECK (AttemptNumber > 0),
    CONSTRAINT CK_StepExecutions_Status CHECK (Status IN ('READY','IN_PROGRESS','WAITING_QC','QC_REJECTED','WAITING_PRODUCTION_CONTROL','PRODUCTION_CONTROL_REJECTED','REWORK_REQUIRED','ON_HOLD','COMPLETED'))
);
GO

CREATE TABLE production.ScanSessions (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ScanSessions_Id DEFAULT NEWSEQUENTIALID(),
    UserId UNIQUEIDENTIFIER NOT NULL,
    ActiveRoleId UNIQUEIDENTIFIER NOT NULL,
    WorkstationId UNIQUEIDENTIFIER NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ScanSessions_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAtUtc DATETIME2(3) NOT NULL,
    RevokedAtUtc DATETIME2(3) NULL,
    ClientFingerprintHash CHAR(64) NULL,
    CONSTRAINT PK_ScanSessions PRIMARY KEY (Id),
    CONSTRAINT FK_ScanSessions_Assignment FOREIGN KEY (UserId, ActiveRoleId, WorkstationId) REFERENCES security.UserStationAssignments(UserId, RoleId, WorkstationId),
    CONSTRAINT CK_ScanSessions_Expiry CHECK (ExpiresAtUtc > CreatedAtUtc)
);

CREATE TABLE production.ScanEvents (
    Id BIGINT IDENTITY(1,1) NOT NULL,
    EventId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ScanEvents_EventId DEFAULT NEWID(),
    ClientRequestId UNIQUEIDENTIFIER NOT NULL,
    ScanSessionId UNIQUEIDENTIFIER NOT NULL,
    WorkItemId UNIQUEIDENTIFIER NULL,
    BarcodeId UNIQUEIDENTIFIER NULL,
    StepExecutionId UNIQUEIDENTIFIER NULL,
    InputSource VARCHAR(20) NOT NULL,
    RawCode NVARCHAR(200) NOT NULL,
    ResolvedAction VARCHAR(80) NULL,
    Result VARCHAR(20) NOT NULL,
    RejectionReason NVARCHAR(500) NULL,
    ManualEntryReason NVARCHAR(300) NULL,
    OccurredAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ScanEvents_OccurredAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_ScanEvents PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_ScanEvents_EventId UNIQUE (EventId),
    CONSTRAINT UQ_ScanEvents_ClientRequest UNIQUE (ClientRequestId),
    CONSTRAINT FK_ScanEvents_Session FOREIGN KEY (ScanSessionId) REFERENCES production.ScanSessions(Id),
    CONSTRAINT FK_ScanEvents_WorkItem FOREIGN KEY (WorkItemId) REFERENCES production.WorkItems(Id),
    CONSTRAINT FK_ScanEvents_Barcode FOREIGN KEY (BarcodeId) REFERENCES production.Barcodes(Id),
    CONSTRAINT FK_ScanEvents_StepExecution FOREIGN KEY (StepExecutionId) REFERENCES production.StepExecutions(Id),
    CONSTRAINT CK_ScanEvents_Source CHECK (InputSource IN ('USB_SCANNER','CAMERA','MANUAL')),
    CONSTRAINT CK_ScanEvents_Result CHECK (Result IN ('ACCEPTED','REJECTED','DUPLICATE')),
    CONSTRAINT CK_ScanEvents_ManualReason CHECK ((InputSource <> 'MANUAL') OR ManualEntryReason IS NOT NULL)
);

CREATE INDEX IX_ScanEvents_WorkItem_OccurredAt ON production.ScanEvents (WorkItemId, OccurredAtUtc DESC);
CREATE INDEX IX_ScanEvents_Session_OccurredAt ON production.ScanEvents (ScanSessionId, OccurredAtUtc DESC);

CREATE TABLE production.ApprovalDecisions (
    Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ApprovalDecisions_Id DEFAULT NEWSEQUENTIALID(),
    StepExecutionId UNIQUEIDENTIFIER NOT NULL,
    ApprovalType VARCHAR(30) NOT NULL,
    Decision VARCHAR(30) NOT NULL,
    DecidedByUserId UNIQUEIDENTIFIER NOT NULL,
    DecidedByRoleId UNIQUEIDENTIFIER NOT NULL,
    Comment NVARCHAR(1000) NULL,
    ChecklistResultJson NVARCHAR(MAX) NULL,
    DecidedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ApprovalDecisions_DecidedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_ApprovalDecisions PRIMARY KEY (Id),
    CONSTRAINT FK_ApprovalDecisions_Execution FOREIGN KEY (StepExecutionId) REFERENCES production.StepExecutions(Id),
    CONSTRAINT FK_ApprovalDecisions_UserRole FOREIGN KEY (DecidedByUserId, DecidedByRoleId) REFERENCES security.UserRoles(UserId, RoleId),
    CONSTRAINT CK_ApprovalDecisions_Type CHECK (ApprovalType IN ('OPERATOR','QUALITY_CONTROL','PRODUCTION_CONTROL','PACKAGING','INCOMING_INSPECTION')),
    CONSTRAINT CK_ApprovalDecisions_Decision CHECK (Decision IN ('APPROVED','REJECTED','REWORK','ON_HOLD')),
    CONSTRAINT CK_ApprovalDecisions_ChecklistJson CHECK (ChecklistResultJson IS NULL OR ISJSON(ChecklistResultJson) = 1)
);
GO

CREATE TABLE ops.AuditLogs (
    Id BIGINT IDENTITY(1,1) NOT NULL,
    EventId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_AuditLogs_EventId DEFAULT NEWID(),
    ActorUserId UNIQUEIDENTIFIER NULL,
    ActorRoleId UNIQUEIDENTIFIER NULL,
    EventType VARCHAR(120) NOT NULL,
    EntityType VARCHAR(100) NOT NULL,
    EntityId NVARCHAR(100) NOT NULL,
    CorrelationId UNIQUEIDENTIFIER NOT NULL,
    IpAddress VARCHAR(45) NULL,
    UserAgentHash CHAR(64) NULL,
    BeforeJson NVARCHAR(MAX) NULL,
    AfterJson NVARCHAR(MAX) NULL,
    OccurredAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AuditLogs_OccurredAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_AuditLogs PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_AuditLogs_EventId UNIQUE (EventId),
    CONSTRAINT FK_AuditLogs_User FOREIGN KEY (ActorUserId) REFERENCES security.Users(Id),
    CONSTRAINT FK_AuditLogs_Role FOREIGN KEY (ActorRoleId) REFERENCES security.Roles(Id),
    CONSTRAINT CK_AuditLogs_BeforeJson CHECK (BeforeJson IS NULL OR ISJSON(BeforeJson) = 1),
    CONSTRAINT CK_AuditLogs_AfterJson CHECK (AfterJson IS NULL OR ISJSON(AfterJson) = 1)
);

CREATE INDEX IX_AuditLogs_Entity ON ops.AuditLogs (EntityType, EntityId, OccurredAtUtc DESC);
CREATE INDEX IX_AuditLogs_Actor ON ops.AuditLogs (ActorUserId, OccurredAtUtc DESC);

CREATE TABLE ops.OutboxEvents (
    Id BIGINT IDENTITY(1,1) NOT NULL,
    EventId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_OutboxEvents_EventId DEFAULT NEWID(),
    EventType VARCHAR(160) NOT NULL,
    AggregateType VARCHAR(100) NOT NULL,
    AggregateId NVARCHAR(100) NOT NULL,
    PayloadJson NVARCHAR(MAX) NOT NULL,
    SequenceNumber BIGINT NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_OutboxEvents_CreatedAt DEFAULT SYSUTCDATETIME(),
    PublishedAtUtc DATETIME2(3) NULL,
    AttemptCount INT NOT NULL CONSTRAINT DF_OutboxEvents_AttemptCount DEFAULT (0),
    LastError NVARCHAR(2000) NULL,
    CONSTRAINT PK_OutboxEvents PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_OutboxEvents_EventId UNIQUE (EventId),
    CONSTRAINT UQ_OutboxEvents_Sequence UNIQUE (SequenceNumber),
    CONSTRAINT CK_OutboxEvents_PayloadJson CHECK (ISJSON(PayloadJson) = 1),
    CONSTRAINT CK_OutboxEvents_AttemptCount CHECK (AttemptCount >= 0)
);

CREATE INDEX IX_OutboxEvents_Unpublished ON ops.OutboxEvents (PublishedAtUtc, Id) INCLUDE (EventType, AggregateType, AggregateId, SequenceNumber);
GO

-- Roles are seeded without users. Production identities must come from the approved identity provider.
INSERT INTO security.Roles (Code, Title, RoleType)
SELECT Seed.Code, Seed.Title, Seed.RoleType
FROM (VALUES
    ('OPERATOR', N'اپراتور تولید', 'OPERATOR'),
    ('QUALITY_CONTROL', N'مسئول کنترل کیفیت', 'QUALITY_CONTROL'),
    ('PRODUCTION_CONTROL', N'مسئول کنترل تولید', 'PRODUCTION_CONTROL'),
    ('PACKAGING', N'مسئول پکیجینگ', 'PACKAGING'),
    ('PLANNING', N'کارشناس برنامه‌ریزی', 'VIEWER'),
    ('ENGINEERING', N'کارشناس مهندسی', 'ENGINEERING'),
    ('SYSTEM_ADMIN', N'مدیر سامانه', 'ADMIN')
) AS Seed(Code, Title, RoleType)
WHERE NOT EXISTS (SELECT 1 FROM security.Roles Existing WHERE Existing.Code = Seed.Code);
GO

