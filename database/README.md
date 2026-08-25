# Factory Flow database

The phase-one schema targets Microsoft SQL Server. Run `001_initial_schema.sql`
inside an empty application database after the SQL Server Database Engine and
the application login have been provisioned.

The VM deployment is automated by:

- `npm run db:provision` — creates `WPMES`, applies migrations, enables mixed
  authentication, and creates the least-privileged `wpmes_app` login.
- `npm run db:migrate-state` — imports the previous JSON project data once,
  without overwriting an existing project code.
- `node scripts/smoke-production-flow.mjs` — verifies the complete operator,
  QC, production-control, and packaging gate in an isolated temporary database.

Operator accounts may carry a `scope` value in the identity configuration. It
must match the engineering-defined operator role of a project set; the API
rejects a scan when the role or scope does not match the current production
gate.

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
