# Deployment

## Database modes

- Local development uses SQLite at `~/.sanaa-yetu/users.sqlite` when `DATABASE_URL` is unset.
- Hosting uses PostgreSQL when `DATABASE_URL` is set. Use the private connection string from your managed PostgreSQL provider and store it as a secret environment variable in the hosting dashboard.
- The server creates the PostgreSQL `users` table on startup. It does not copy local account data to the hosted database.

The legacy `~/.sanaa-yetu/users.json` file is migrated into local SQLite only. If accounts need to move to hosted PostgreSQL, plan and run a separate secure data migration; do not put account files or database credentials in the repository.

## Hosting configuration

Create a Render Postgres database and a Render Node.js web service in the same region. In the web service's **Environment** settings, configure:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | The database's **internal** connection string; keep it secret |
| `PGSSL` | `require` |

Use Node.js 22.13 or newer. Set the service build command to `npm ci` and start command to `npm start`. The app uses Render's `PORT` and binds to `0.0.0.0` in production. `PGSSL=require` encrypts database traffic and supports Render's self-signed TLS for internal connections. The app enables HTTPS at the web-service edge.

On Render, create the database using **New > Postgres**. Pick a name and region, wait for its status to become **Available**, then copy the **Internal Database URL** from its Connect/Info page. Create a web service from the repository containing this project, choose the same region, and set its build and start commands as above. Add the three environment variables in the web service's **Environment** tab and save/redeploy. Do not paste the connection string into source control or chat.

For local development, leave `DATABASE_URL` unset and run `npm start`; the server will use SQLite.

## Before accepting real users

The account records are stored in the selected database, but sessions and rate-limit counters currently live in server memory. They reset when the process restarts and are not shared across multiple app instances. Use a persistent, shared session and rate-limit store before running multiple instances or relying on long-lived production sessions. Configure database backups and test recovery before launch.
