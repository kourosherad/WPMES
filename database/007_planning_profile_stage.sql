SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF NOT EXISTS (SELECT 1 FROM security.Roles WHERE Code = 'PLANNING')
    INSERT INTO security.Roles (Code,Title,RoleType) VALUES ('PLANNING',N'کارشناس برنامه‌ریزی','VIEWER');
GO
