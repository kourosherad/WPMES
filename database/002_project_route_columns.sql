SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH('core.Projects', 'ItemType') IS NULL
    ALTER TABLE core.Projects ADD ItemType VARCHAR(20) NOT NULL
        CONSTRAINT DF_Projects_ItemType DEFAULT ('ASSEMBLY');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Projects_ItemType')
    ALTER TABLE core.Projects ADD CONSTRAINT CK_Projects_ItemType
        CHECK (ItemType IN ('SINGLE', 'ASSEMBLY'));
GO

IF COL_LENGTH('engineering.ItemDefinitions', 'SetOrder') IS NULL
    ALTER TABLE engineering.ItemDefinitions ADD SetOrder INT NOT NULL
        CONSTRAINT DF_ItemDefinitions_SetOrder DEFAULT (1);
GO

IF COL_LENGTH('engineering.ItemDefinitions', 'OperatorRoleKey') IS NULL
    ALTER TABLE engineering.ItemDefinitions ADD OperatorRoleKey NVARCHAR(120) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ItemDefinitions_SetOrder')
    ALTER TABLE engineering.ItemDefinitions ADD CONSTRAINT CK_ItemDefinitions_SetOrder
        CHECK (SetOrder > 0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'engineering.ItemDefinitions') AND name = N'UX_ItemDefinitions_Project_SetOrder')
    CREATE UNIQUE INDEX UX_ItemDefinitions_Project_SetOrder
        ON engineering.ItemDefinitions(ProjectId, SetOrder);
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wpmes_runtime')
    CREATE ROLE wpmes_runtime AUTHORIZATION dbo;
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::core TO wpmes_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::engineering TO wpmes_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::production TO wpmes_runtime;
GRANT SELECT, INSERT ON SCHEMA::ops TO wpmes_runtime;
GRANT SELECT, INSERT, UPDATE ON OBJECT::security.Users TO wpmes_runtime;
GRANT SELECT ON OBJECT::security.Roles TO wpmes_runtime;
GRANT SELECT, INSERT, UPDATE ON OBJECT::security.UserRoles TO wpmes_runtime;
GRANT SELECT, INSERT, UPDATE ON OBJECT::security.UserStationAssignments TO wpmes_runtime;
DENY UPDATE, DELETE ON SCHEMA::ops TO wpmes_runtime;
GO
