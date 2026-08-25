# Factory Flow database

The phase-one schema targets Microsoft SQL Server. Run `001_initial_schema.sql`
inside an empty application database after the SQL Server Database Engine and
the application login have been provisioned.

Important deployment rules:

- Do not use `sa` from the application.
- Prefer a dedicated Windows service identity or a least-privileged SQL login.
- The application identity must not own the database and must not receive
  `db_owner`.
- Enable encrypted SQL connections, SQL Server Audit, encrypted backups, and
  a tested restore schedule before production use.
- Schema deployment must use a separate migration identity from the runtime
  application identity.
- `ops.AuditLogs` is append-only at the application layer. Direct update/delete
  permissions must not be granted to the application login.
- Manual barcode entry is persisted in `production.ScanEvents` with its reason.
- Separation of duties is enforced by the API policy layer and recorded in the
  audit log; database foreign keys ensure every decision references an assigned
  user role.
