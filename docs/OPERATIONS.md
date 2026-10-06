# Local operations

Copy .env.example to .env and use a unique local Postgres secret. Keep .env ignored. Docker provides independent v2 Postgres on 15432 and Mailpit on 11025/18025. API uses 8001; Vite uses 5173 and proxies /api.

Use a new backend/.venv; npm manages frontend dependencies. This host's Python launcher has no registered Python installation; the available Python 3.12.14 runtime is C:/Users/nicga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe.

Run Alembic before starting the API. Never initialize from old learnsync.sql. Bootstrap admin prompts for a password. Seed data is explicitly development-only.

Detailed configuration and backup rules: IMPLEMENTATION_PLAN.md section 7. Verified runnable commands will be added as each milestone passes.

## AI (Milestone 5)

Settings (`.env`): `GROQ_API_KEY`, `GROQ_CHAT_MODEL`, `GROQ_QUIZ_MODEL`, `AI_TIMEOUT_SECONDS`, `AI_MESSAGES_PER_MINUTE` (per student, default 10) and `AI_PROVIDER_MODE`.

- `AI_PROVIDER_MODE=groq` is the real provider and the only mode for production. `fake` swaps in a built-in simulator and is honoured only when `APP_ENV=development`; the UI and `/api/ai/status` label it. While it is set, nothing proves Groq works and `ai-check` refuses to pass.
- To go live: set a key, set `AI_PROVIDER_MODE=groq` (or delete the line), run `python -m app.cli ai-check` (lists models, then sends English, Filipino and Taglish chat requests to the configured chat model and a JSON-mode request to the configured quiz model through the app's own code, exits non-zero on any failure). To try Llama 3.3 70B, set both model variables to `llama-3.3-70b-versatile`, restart and run the check again.
- `python -m app.cli reindex-chunks` rebuilds the searchable study text for every published item (run it after a bulk import or if a lesson shows 0 passages by mistake). Publishing indexes automatically and never fails because of it.
- The study text lives in `content_chunk` (Postgres full-text). Backups of the database include it; it is derived data and can always be rebuilt with the command above.
- Provider problems appear to users only as short fixed messages; the status code (never the body) is logged under `learnsync.ai`.

## Exports, backups, rehearsals and browser checks (Milestone 6)

### Grade exports
Gradebook page, "Export grades": period (midterm, finals, course), section, and basis. Files are real PDF/XLSX and are not an official institutional form. Only the teacher who owns the offering can export (administrators and students are refused); closed terms can still be exported; each export is audited (who, offering, period, basis, section, count; never the file).
- Published grades: the latest release per student, exactly what students can see. Category percentages, policy version, passing grade and transmutation come from each release's own snapshot ("as released"), so a later policy change does not rewrite history; if releases span policy versions each row shows its version. Students with no release say "Not published"; a release whose working data changed says "review pending".
- Working preview: today's calculated values. Every PDF page and the top of the sheet carry a red "PREVIEW - NOT PUBLISHED" banner and the file name ends in -PREVIEW.
- Names, numbers, labels and notes that start with `= + - @` are neutralised so a spreadsheet never runs them.

### Backup (one consistent copy)
Stop the API first (writes must be quiet; the script refuses while port 8001 answers, `-AllowLive` is for development rehearsals only), keep Docker Postgres running, then:

```powershell
pwsh scripts/backup.ps1 -Out D:\learnsync-backups
```
It produces `learnsync-<timestamp>/` with `database.dump` (pg_dump custom format), `uploads/` and `manifest.json` (schema revision, row counts for every table, SHA-256 of every stored file, fingerprints of grade releases, result releases and content/assessment revisions). It fails and leaves nothing behind if a file the database refers to is missing or altered, and it re-checks at the end that nothing changed while it ran. `.env` and provider keys are never copied; keep the folder private.

### Restore (always into a separate copy first)
```powershell
pwsh scripts/restore.ps1 -Backup D:\learnsync-backups\learnsync-<timestamp> -TargetDb learnsync_restore_check -TargetUploads D:\restore-check\uploads
pwsh scripts/verify-restored-api.ps1 -Database learnsync_restore_check -Uploads D:\restore-check\uploads -OfferingId <an offering id>
```
The restore refuses the live database name, an existing database, the live upload root (or anything inside/around it) and a non-empty folder. It ends every login session and emailed link in the copy, then compares counts, file checksums and history with the manifest. `verify-restored-api.ps1` starts a second API (port 8003) on the copy and checks sign-in, a stale session cookie, published content, file downloads at their original size, grade releases and exports. To actually switch to a restored copy, stop the live API, point `DATABASE_URL` and `UPLOAD_ROOT` at the copy and start it (keep the old data until you are satisfied). Never restore over the old LearnSync v1 database.

### Fresh-installation rehearsal
```powershell
pwsh scripts/rehearse-fresh.ps1          # add -Keep to leave the fresh stack and database in place
```
Creates an empty database `learnsync_fresh` and an empty upload folder, runs `alembic upgrade head` and checks the schema is at head, bootstraps the first administrator with a generated password (never printed or stored), starts a second API (8002) and web app (5174), runs the complete browser flow (`frontend/e2e/flow.mjs`: invitations by emailed link, structure, syllabus, lesson, quiz, student attempt, grade publication, exports, permission boundaries, issue report, accessibility), tears everything down, and proves the live data is unchanged. Needs Docker Postgres and Mailpit (`docker compose up -d`), the backend venv and `npm install` in `frontend/`.

### Browser checks (headless Microsoft Edge through playwright-core; no browser download)
Run against a running dev stack (API 8001, web 5173):
```powershell
cd frontend
npm run e2e:sweep      # axe-core WCAG 2 A/AA, whole-page overflow and 44px targets: 3 roles x light/dark x 1280px/375px
npm run e2e:keyboard   # skip link, dialog focus trap and restoration, visible focus, live theme switching
npm run e2e:states     # signed-out screens, every dialog opened by a New/Invite/Add/Draft/Create button, an in-progress quiz attempt
npm run e2e:gallery    # screenshots into var/screens for a visual review
```
The sweep logs in once per role (the sign-in limiter allows 5 attempts a minute).

### Safety rules the scripts enforce (read before changing them)
- Backup refuses while ANY v2 writer is running: an API on any port or a maintenance command (`uvicorn app.main`, `-m app.cli`). Stop them all; `-AllowLive` exists only for development rehearsals.
- Restore resolves the target to its real long-form path (8.3 short names expanded, junctions and symbolic links rejected) and refuses a target that equals, contains or lies inside the live upload root, an occupied folder, the live or an existing database, and any protected folder. Protected folders are the old LearnSync v1 project next to this repository plus anything listed in `PROTECTED_PATHS` (semicolon-separated) in `.env`. The check is repeated immediately before files are written.
- Verify a restored copy BEFORE you use it: using it (signing in, exporting) writes audit rows, so a later comparison with the manifest will show extra audit entries even though nothing was lost. `restore.ps1` verifies at the end for exactly this reason; `verify-restored-api.ps1` is the step that uses the copy.
- The manifest records the schema revision, row counts for every table, a SHA-256 of every stored file, and a content hash of every table except sessions and one-time tokens (a restore deliberately ends every login and emailed link). A backup made by an older version of the tool is reported as such and must be retaken.
- Keyboard-only check of the core workflows (needs the dev stack running): `npm run e2e:keyboard-flows`. `npm run test:e2e` runs every browser check.
