# Wagon Pars Manufacturing Execution System (WPMES)

Manufacturing execution system with staged planning/engineering project profiles, configurable production routes, QR tracking, QC approval, and final production-control approval.

## Technology

- Node.js and React
- HTML/CSS interface
- SQL Server schema and migration baseline
- HTTPS-ready application server

## Run on a new Windows computer

Prerequisites: Node.js 20+ and Microsoft SQL Server (the provisioning command defaults to `localhost\\SQLEXPRESS`).

```powershell
npm ci
npm run auth:configure
npm run db:provision
npm run build
npm start
```

Then open `http://localhost:8080` and sign in with the administrator account created by `npm run auth:configure`.

For a different SQL Server instance:

```powershell
$env:WPMES_SQL_INSTANCE = 'localhost\\YOUR_INSTANCE'
npm run db:provision
```

The provisioning command creates the `WPMES` database, applies every migration, creates a least-privileged runtime login, and writes the local connection configuration to `secrets/database.json`.

## Existing computer

```powershell
npm install
npm run build
npm start
```

## Security and local data

The `secrets/`, `data/`, database backup, certificate, log, dependency, and build-output files are intentionally excluded from Git. Do not commit database credentials or `public-auth.json`. Transfer an existing database through an encrypted SQL Server backup when its records are required; otherwise `npm run db:provision` creates a clean database from the tracked migrations.
