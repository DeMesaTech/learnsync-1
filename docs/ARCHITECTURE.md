# Architecture

FastAPI + synchronous SQLAlchemy 2 sessions + Psycopg 3; Alembic owns schema changes. React + TypeScript + Vite + React Router + TanStack Query; native fetch; Tiptap for formatted teaching content.

One Postgres database. Each feature owns commands (writes/transactions) and queries (authorized projections). No bus, generic repository, event sourcing, separate read database, or runtime schema repair.

Opaque hashed server sessions, HttpOnly cookies and session CSRF tokens; Argon2 passwords. Parent/child resources are scoped by authenticated role, offering ownership/enrollment and section targeting. Restricted fields must never enter student responses.

Files remain outside webroot and are delivered by an authorized API. Drafts use compare-and-swap revisions; published documents and grade snapshots are immutable.

Approved schema/lifecycles: IMPLEMENTATION_PLAN.md sections 3-4. AI retrieval restrictions: section 6.


### Additions: learning order, paging and chat deletion
- `learning_item.position` orders items inside a chapter/topic; students read them in syllabus order, then position (`teaching/items.ordered_published`, the single source for the lesson list, the dashboard next step and the Next link). `PUT /api/teach/offerings/{id}/items-order` reorders one group. Learner payloads add `completed`, `up_next`, `next_lesson`; work payloads add `bucket` and `late_allowed` (`assessments/learner.bucket_of`, shared with the dashboard).
- Paging: `GET /api/admin/issues` takes `page`, `page_size` (max 100), `status`, `type`, `q` and returns `total`; study conversations and messages take `limit` and a `before` timestamp cursor and return `has_more` / `has_earlier`; announcements take `limit`.
- `DELETE /api/learn/offerings/{id}/study/conversations/{cid}` hard-deletes the student's own conversation (allowed after withdrawal or term close).

## Study slice (Milestone 5)

`features/study` owns derived study text (`content_chunk`, from published learning-item revisions only), private conversations, reference-link text snapshots, AI quiz generation records, lesson completions and progress events. It calls `teaching` and `assessments` only through their access helpers and models; `assessments` calls only `study.events.record_event`, which has no other imports, to avoid cycles.

All provider traffic goes through `study/provider.py` (safe error codes, no provider bodies). Retrieval (`study/retrieval.py`) is the single place that decides what the model may read; chat and quiz generation use separate pipelines. AI quiz drafts are ordinary unpublished assessment drafts flagged `ai_generated`, published only when `reviewed_counter == draft_counter`. Progress events are unique per (student, type, ref) and are written in the same transaction as the action that earned them. Details: `docs/AI.md`, `docs/DECISIONS.md`.

## Exports, support and backup (Milestone 6)

`features/exports` builds one format-independent table per request (`tables.py`: published releases from their own snapshots, or a working preview marked as such) and renders it to real XLSX/PDF (`render.py`); the router is faculty-only and audits each download. `features/support` holds issue reports (students/faculty create, administrators review). `app/backup.py` computes the manifest and verifies restored copies; `scripts/` orchestrates Docker/pg_dump/restore around it. Browser verification lives in `frontend/e2e/` (headless Edge via playwright-core). Commands and results: `docs/OPERATIONS.md`, `docs/ACCEPTANCE.md`.

## Versions actually selected (from the manifests, 2026-10-06)

Python 3.12.14 (the interpreter inside backend/.venv); FastAPI 0.142.2, Uvicorn 0.54.0, SQLAlchemy 2.1.3 (synchronous sessions), Psycopg 3.3.6, Alembic 1.20.0, Pydantic 2.13.5 / pydantic-settings 2.15.0, Argon2 (argon2-cffi 25.1.0 via pwdlib 0.3.1), httpx 0.28.1, nh3 0.3.7 (lesson sanitising), pypdf 6.19.0 / python-docx 1.2.0 / python-pptx 1.0.2 (text extraction), ReportLab 4.5.1 and openpyxl 3.1.5 (exports); tests: pytest 9.1.1, ruff 0.16.10. Postgres 16.15 (Docker, `postgres:16-alpine`) and Mailpit 1.27.10. Node 24.21; React 19, React Router 7, TanStack Query 5, Tiptap 3, Vite 7, TypeScript 5.9; browser checks: playwright-core 1.63 driving the installed Microsoft Edge, axe-core 4.14. Exact pins: `backend/requirements*.txt`, `frontend/package-lock.json`.

### UX rework, Phase 1 (skeleton-first setup)
`assessments/planning.py` owns three commands, all faculty-only and scoped to the teacher's own offering: `POST /api/teach/offerings/{id}/assessments/plan` creates up to 30 hidden draft assessments in one transaction (idempotent through a `plan_key` stored in the audit event; category and period are checked against the draft or published policy), `PUT /api/teach/offerings/{id}/schedule` stores `offering.meeting_days` (bitmask, Monday = 1, migration `29f75f29e858`), and `POST /api/teach/offerings/{id}/copy-from/{source_id}` copies one of the teacher's own earlier subjects into an EMPTY one as drafts only (syllabus draft, lessons, links, files with their bytes duplicated, assessments with questions; never sections, dates, attempts, scores, submissions, students, announcements or attendance). Offering summaries carry `meeting_days`.
