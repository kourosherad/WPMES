SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

DECLARE @projectItemTypeDefault sysname;
SELECT @projectItemTypeDefault = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.default_object_id = dc.object_id
WHERE dc.parent_object_id = OBJECT_ID(N'core.Projects') AND c.name = N'ItemType';
IF @projectItemTypeDefault IS NOT NULL
    EXEC(N'ALTER TABLE core.Projects DROP CONSTRAINT [' + @projectItemTypeDefault + N']');
GO

IF COL_LENGTH('core.Projects', 'ItemType') IS NOT NULL
    ALTER TABLE core.Projects ALTER COLUMN ItemType VARCHAR(20) NULL;
GO

UPDATE Projects
SET ItemType = NULL, UpdatedAtUtc = SYSUTCDATETIME()
FROM core.Projects Projects
WHERE Projects.Status = 'DRAFT'
  AND NOT EXISTS (SELECT 1 FROM core.ProjectProfiles Profiles WHERE Profiles.ProjectId = Projects.Id)
  AND NOT EXISTS (SELECT 1 FROM production.WorkItems WorkItems WHERE WorkItems.ProjectId = Projects.Id);

GO

IF COL_LENGTH('production.WorkItems', 'UnitNumber') IS NULL
    ALTER TABLE production.WorkItems ADD UnitNumber INT NULL;
IF COL_LENGTH('production.WorkItems', 'BatchQuantity') IS NULL
    ALTER TABLE production.WorkItems ADD BatchQuantity INT NULL;
GO

;WITH Existing AS (
    SELECT Id, ProjectId,
           ROW_NUMBER() OVER (PARTITION BY ProjectId ORDER BY CreatedAtUtc, Id) AS UnitNumber,
           COUNT(*) OVER (PARTITION BY ProjectId) AS BatchQuantity
    FROM production.WorkItems
)
UPDATE Target
SET UnitNumber = Existing.UnitNumber,
    BatchQuantity = Existing.BatchQuantity
FROM production.WorkItems Target
JOIN Existing ON Existing.Id = Target.Id
WHERE Target.UnitNumber IS NULL OR Target.BatchQuantity IS NULL;
GO

IF EXISTS (SELECT 1 FROM production.WorkItems WHERE UnitNumber IS NULL OR BatchQuantity IS NULL)
    THROW 51000, 'WORK_ITEM_ORDINAL_BACKFILL_FAILED', 1;
GO

ALTER TABLE production.WorkItems ALTER COLUMN UnitNumber INT NOT NULL;
ALTER TABLE production.WorkItems ALTER COLUMN BatchQuantity INT NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_WorkItems_UnitNumber')
    ALTER TABLE production.WorkItems ADD CONSTRAINT CK_WorkItems_UnitNumber CHECK (UnitNumber > 0);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_WorkItems_BatchQuantity')
    ALTER TABLE production.WorkItems ADD CONSTRAINT CK_WorkItems_BatchQuantity CHECK (BatchQuantity > 0 AND UnitNumber <= BatchQuantity);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'production.WorkItems') AND name = N'UX_WorkItems_Project_UnitNumber')
    CREATE UNIQUE INDEX UX_WorkItems_Project_UnitNumber ON production.WorkItems(ProjectId, UnitNumber);
GO
