SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'production.ReworkCases', N'U') IS NULL
BEGIN
    CREATE TABLE production.ReworkCases (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ReworkCases_Id DEFAULT NEWSEQUENTIALID(),
        WorkItemId UNIQUEIDENTIFIER NOT NULL,
        SourceStepExecutionId UNIQUEIDENTIFIER NOT NULL,
        ReworkMode VARCHAR(30) NOT NULL,
        Status VARCHAR(30) NOT NULL,
        Reason NVARCHAR(1000) NOT NULL,
        CreatedByUserId UNIQUEIDENTIFIER NOT NULL,
        CreatedByRoleId UNIQUEIDENTIFIER NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ReworkCases_CreatedAt DEFAULT SYSUTCDATETIME(),
        ResolvedAtUtc DATETIME2(3) NULL,
        RowVersion ROWVERSION NOT NULL,
        CONSTRAINT PK_ReworkCases PRIMARY KEY (Id),
        CONSTRAINT FK_ReworkCases_WorkItem FOREIGN KEY (WorkItemId) REFERENCES production.WorkItems(Id),
        CONSTRAINT FK_ReworkCases_Execution FOREIGN KEY (SourceStepExecutionId) REFERENCES production.StepExecutions(Id),
        CONSTRAINT FK_ReworkCases_UserRole FOREIGN KEY (CreatedByUserId, CreatedByRoleId) REFERENCES security.UserRoles(UserId, RoleId),
        CONSTRAINT CK_ReworkCases_Mode CHECK (ReworkMode IN ('SAME_STEP','INDEPENDENT')),
        CONSTRAINT CK_ReworkCases_Status CHECK (Status IN ('RETURNED_TO_STEP','AWAITING_ROUTE','ROUTE_ASSIGNED','COMPLETED','CANCELLED')),
        CONSTRAINT CK_ReworkCases_Reason CHECK (LEN(LTRIM(RTRIM(Reason))) >= 3)
    );

    CREATE INDEX IX_ReworkCases_WorkItem_CreatedAt ON production.ReworkCases (WorkItemId, CreatedAtUtc DESC);
    CREATE INDEX IX_ReworkCases_Open ON production.ReworkCases (Status, CreatedAtUtc) INCLUDE (WorkItemId, ReworkMode);
END;
GO
