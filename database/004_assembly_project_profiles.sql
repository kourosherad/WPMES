SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'core.ProjectProfiles', N'U') IS NULL
BEGIN
    CREATE TABLE core.ProjectProfiles (
        ProjectId UNIQUEIDENTIFIER NOT NULL,
        MainDrawingNumber NVARCHAR(100) NULL,
        ProfileJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ProjectProfiles_Json DEFAULT (N'{}'),
        SourceFileName NVARCHAR(260) NULL,
        ImportedRowCount INT NOT NULL CONSTRAINT DF_ProjectProfiles_RowCount DEFAULT (0),
        UpdatedByUserId UNIQUEIDENTIFIER NOT NULL,
        UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_ProjectProfiles_UpdatedAt DEFAULT SYSUTCDATETIME(),
        RowVersion ROWVERSION NOT NULL,
        CONSTRAINT PK_ProjectProfiles PRIMARY KEY (ProjectId),
        CONSTRAINT FK_ProjectProfiles_Project FOREIGN KEY (ProjectId) REFERENCES core.Projects(Id),
        CONSTRAINT FK_ProjectProfiles_User FOREIGN KEY (UpdatedByUserId) REFERENCES security.Users(Id),
        CONSTRAINT CK_ProjectProfiles_Json CHECK (ISJSON(ProfileJson) = 1),
        CONSTRAINT CK_ProjectProfiles_RowCount CHECK (ImportedRowCount >= 0)
    );
END;
GO
