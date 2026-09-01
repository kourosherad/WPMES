IF COL_LENGTH(N'production.StepExecutions', N'ProductionOperationCompletedAtUtc') IS NULL
BEGIN
  ALTER TABLE production.StepExecutions ADD ProductionOperationCompletedAtUtc DATETIME2(3) NULL;
END;
GO
