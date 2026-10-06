# LearnSync v2

A local BS Entrepreneurship teaching pilot built with FastAPI, React and Postgres. The old project and database are preserved and never touched.

Start with `docs/IMPLEMENTATION_PLAN.md`. Milestone status and the checks that were actually run are in `docs/ACCEPTANCE.md`; decisions are in `docs/DECISIONS.md`; the AI limits are in `docs/AI.md`; operations (backups, restores) are in `docs/OPERATIONS.md`. The reference HTML in `docs/reference` is a design prototype, not a working backend.

## Run it locally without Docker

You need three things running: PostgreSQL, the API (port 8001) and the web app (port 5173). Email (Mailpit) is optional.

### 1. Install the tools

| Tool | Version | Notes |
|---|---|---|
| Python | **3.12** (3.13 is not supported) | `python --version` must say 3.12.x |
| Node.js | **24.x** | `node --version` |
| PostgreSQL | 14 or newer (developed on 16) | native install, any port |
| Git | any | |

Windows: `winget install PostgreSQL.PostgreSQL.16`, `winget install Python.Python.3.12`, `winget install OpenJS.NodeJS`. macOS: `brew install postgresql@16 python@3.12 node`. Linux: your package manager.

### 2. Create the database

Open a SQL shell as the Postgres admin (`psql -U postgres`) and run, choosing your own password:

```sql
CREATE ROLE learnsync_v2 LOGIN PASSWORD 'pick-a-local-secret';
CREATE DATABASE learnsync_v2      OWNER learnsync_v2;
CREATE DATABASE learnsync_v2_test OWNER learnsync_v2;   -- only needed to run the tests
```

The app needs no Postgres extensions and no superuser. **Never** load the old `learnsync.sql` into this database; v2 starts empty and is built by migrations.

### 3. Configure

```powershell
Copy-Item .env.example .env      # macOS/Linux: cp .env.example .env
```

Edit `.env` (it is git-ignored). A native Postgres listens on **5432**, not the 15432 that Docker mapped, so change the two URLs:

```
DATABASE_URL=postgresql+psycopg://learnsync_v2:pick-a-local-secret@127.0.0.1:5432/learnsync_v2
TEST_DATABASE_URL=postgresql+psycopg://learnsync_v2:pick-a-local-secret@127.0.0.1:5432/learnsync_v2_test
```

If the password contains `@`, `:`, `/` or `#`, URL-encode it in those URLs. Leave `APP_ORIGIN=http://127.0.0.1:5173`. The other `POSTGRES_*` lines are only used by Docker and can be ignored. Open the app at `127.0.0.1`, not `localhost`: the session cookie and the origin check expect it.

### 4. Backend

```powershell
cd backend
py -3.12 -m venv .venv                       # macOS/Linux: python3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
.\.venv\Scripts\python -m alembic upgrade head
```

(macOS/Linux: `.venv/bin/python` instead of `.\.venv\Scripts\python`.) `alembic upgrade head` builds every table; run it again after pulling new code.

### 5. Create the first administrator

Pick one:

```powershell
# a real first admin; prompts for a password of 12+ characters
.\.venv\Scripts\python -m app.cli bootstrap-admin --email you@school.edu --name "Your Name"

# or, for trying things out only (refused unless APP_ENV=development):
.\.venv\Scripts\python -m app.cli seed-demo
```

`seed-demo` creates `admin@`, `faculty1@`, `faculty2@`, `student1@` to `student3@example.com`, all with the password `LearnSync-demo-2026`. It creates accounts only: the admin then adds a school year and term, subjects, sections and a subject offering in the app before teachers and students have anything to work in.

### 6. Start the API and the web app

Two terminals:

```powershell
# terminal 1: API on http://127.0.0.1:8001
cd backend
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8001

# terminal 2: web app on http://127.0.0.1:5173 (proxies /api to the API)
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173> and sign in. If the API runs on another port, start Vite with `VITE_API=http://127.0.0.1:PORT`; to change the web port use `VITE_PORT`. Restart the API after backend code changes (or add `--reload` to the uvicorn command).

Uploaded files are stored privately in `var/uploads` (set `UPLOAD_ROOT` to move it). It is git-ignored.

### 7. Email (optional)

Invitations and password resets are sent by SMTP. With nothing listening on the SMTP port, **inviting a user fails with "Email could not be sent"**. Seeded demo accounts do not need email. To receive the links locally without Docker, download the single-file [Mailpit](https://github.com/axllent/mailpit/releases) binary and run:

```powershell
mailpit --smtp 127.0.0.1:11025 --listen 127.0.0.1:18025   # inbox at http://127.0.0.1:18025
```

`.env.example` already points SMTP at `127.0.0.1:11025`. Or set the `SMTP_*` and `MAIL_FROM` values to any real SMTP server (set `SMTP_USE_TLS=true` for STARTTLS).

### 8. AI features (optional)

Study help and AI quiz drafting use Groq. Put a key in `GROQ_API_KEY` and run `python -m app.cli ai-check` to prove it works. Without a key those features show a short "not set up" message and everything else works. For screens only, `AI_PROVIDER_MODE=fake` (development only) swaps in a simulator that proves the plumbing, not answer quality. Details and limits: `docs/AI.md`.

### 9. Tests and checks

```powershell
cd backend
.\.venv\Scripts\python -m ruff check app tests
.\.venv\Scripts\python -m pytest -q          # uses TEST_DATABASE_URL, which must end in _test

cd ..\frontend
npx tsc -b ; npm run lint ; npm run build
```

The browser checks (`npm run e2e:sweep`, `e2e:keyboard`, `e2e:states`, `node e2e/flows-back.mjs`) drive the installed Microsoft Edge against a running API and web app, with the demo accounts. They need Edge at its default install path and `seed-demo` data; the sign-in limiter allows 5 attempts a minute, so run them one at a time. Do not run the backend tests in two terminals at once: they share one test database.

### What does not work without Docker

The PowerShell scripts in `scripts/` (`backup.ps1`, `restore.ps1`, `verify-restored-api.ps1`, `rehearse-fresh.ps1`) run `pg_dump`, `pg_restore` and `createdb` inside the Docker Postgres container, so they **need Docker** as they are written. Without Docker, a manual backup is:

```powershell
pg_dump -U learnsync_v2 -h 127.0.0.1 -Fc -f learnsync-backup.dump learnsync_v2
# and copy var/uploads (the files the database refers to) alongside it
```

and a restore is `createdb` a new database followed by `pg_restore --no-owner -d <new database> learnsync-backup.dump`. Restore into a separate database first and check it before pointing `.env` at it. `python -m app.cli backup-manifest` and `verify-restore` (see `docs/OPERATIONS.md`) work without Docker; they only need `DATABASE_URL`.

## Run it with Docker instead

`compose.yaml` starts Postgres 16 on 127.0.0.1:15432 and Mailpit on 11025 (SMTP) and 18025 (inbox). Keep the `.env.example` URLs as they are, run `docker compose up -d`, then follow steps 4 to 9 above.

## Ports

| Port | What |
|---|---|
| 5173 | web app (Vite) |
| 8001 | API |
| 5432 | your native Postgres (15432 if you use the Docker one) |
| 11025 / 18025 | Mailpit SMTP / inbox (optional) |
| 8002, 5174, 8003 | only used by the rehearsal and restore-check scripts |

## Troubleshooting

- **`connection refused` or `password authentication failed`**: the URL in `.env` does not match the role, password or port you created; the default port is 5432 for a native install.
- **`ModuleNotFoundError` or a wrong Python**: the venv must be Python 3.12 (`.venv\Scripts\python --version`).
- **Blank page or API errors at `localhost`**: use `http://127.0.0.1:5173`.
- **`TEST_DATABASE_URL must point to an isolated *_test database`**: create `learnsync_v2_test` and set the variable, as in step 3.
- **Sign-in says too many attempts**: the limiter allows 5 a minute per address; wait a minute.
