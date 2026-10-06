# LearnSync v2 — complete rewrite and implementation handoff

## Answer

The user has accepted the requirements baseline and authorized you to implement all phases autonomously, with runnable acceptance checks between phases.

**Status:** This is a specification, not an implementation report. I have not created or edited files. Save this reply as `docs/IMPLEMENTATION_PLAN.md` in the new project and create the supporting documentation described below.

**Distinction:** Product decisions explicitly confirmed by the user are identified as **confirmed**. Concrete engineering choices added here are **implementation defaults**. They provide a buildable approach without claiming the user individually approved every package, column, or timeout.

---

### 1. Scope, priorities, and source precedence

#### Confirmed project boundaries

- New project: `C:\Dev\others\learnsync-v2`.
- Old project: `C:\Dev\others\learnsync`.
- Fresh database; **no migration of old accounts, records, passwords, or uploads**.
- Single institution and **BS Entrepreneurship only**.
- Capstone pilot running on the developer’s machine.
- Implement the complete accepted feature set in working phases.
- Preserve the old project.
- Real Groq integration must work before declaring the AI milestone complete.
- Keep the established color scheme, with Google Classroom and Brilliant as design inspiration.
- Build simple, connected workflows rather than copying the prototype’s implementation structure.

Source precedence:

1. Latest confirmed human decisions in this conversation.
2. `User-Acess Updated.docx`.
3. Capstone paper.
4. Current colored HTML prototype.
5. Old implementation as a business-rule reference.

Earlier requirements are superseded where they conflict with later decisions. Specifically:

- “Admin manages users only” is superseded by the updated access document.
- “Only program head uploads syllabi” is superseded by faculty ownership.
- Faculty does not have an “extra access” toggle.
- Program head is not a fourth application role.

#### Admin

Keep or implement:

- School years and semesters.
- Initial prospectus upload and reviewed subject extraction.
- Subject catalog management.
- Sections and student rosters.
- Regular student enrollment through section membership.
- Explicit subject enrollment exceptions for irregular students.
- Teacher assignments and teaching-section associations.
- User account invitations, activation, deactivation, and password-reset assistance.
- Additional admin invitations by existing admins.
- Controlled institutional admin-account handover.
- CSV/XLSX student import with preview.
- Term closure, controlled reopening, and new-year setup.
- Student/faculty issue-report review and status updates.
- Relevant audit history.

Exclude from admin teaching access:

- Syllabus editing or publication.
- Lesson/material management.
- Quiz answer keys.
- Submission grading.
- Student assessment records and gradebooks.
- Student AI conversations.

An admin who teaches must use a separate faculty account.

#### Faculty

Keep or implement within assigned offerings:

- Assigned subjects and teaching sections.
- Enrolled-student lists.
- Syllabus upload, editing, chapters/topics, draft recovery, and publication.
- Learning materials and approved references.
- Visual lesson editor.
- Section-targeted announcements.
- Manual quizzes.
- AI-generated quiz drafts requiring faculty review.
- Online quizzes and manually recorded offline quiz results.
- Activities and versioned submissions.
- Attendance.
- Participation, recitation, and other teacher-evaluated assessments.
- Manually recorded examination scores.
- Configurable grading policies.
- Individual assessment-result release.
- Separate Midterm, Finals, and Course grade publication.
- Corrections, review flags, and publication history.
- PDF and Excel grade exports.
- Daily and weekly student-progress views.
- Issue reporting.

Do not give faculty academic catalog, roster, account, or teacher-assignment administration through an elevated faculty permission.

#### Student

Keep or implement:

- Enrolled subjects and historical subject access.
- Published syllabus, chapters/topics, lessons, materials, and references.
- Assigned online quiz attempts.
- Assigned activity submissions.
- Released assessment results and feedback.
- Separately published overall grades.
- Friendly, subject-grounded AI conversations.
- Daily and weekly completion/submission progress.
- Subject announcements.
- Issue reporting.

Students access only their own attempts, submissions, progress, results, and conversations.

#### New or materially strengthened behavior

Compared with the old implementation:

- Actual authenticated server identity and ownership enforcement.
- Secure password hashing.
- Invitation-based account activation and email-verification flow.
- System/light/dark themes.
- Mobile-first layouts.
- Connected routes, breadcrumbs, and contextual Back/Cancel.
- Accessible modals for short forms.
- Server autosave plus browser recovery.
- Explicit draft/published separation.
- Immutable assessment and grade publication snapshots.
- Private, authorized file delivery.
- Distinct individual-result and overall-grade publication.
- Daily/weekly student progress, distinct from faculty coverage.
- Reviewed imports.
- Historical term closure/reopening.
- Study AI isolated from assessment answer stores.

#### Drop or defer

- Old database migration and legacy schema reconciliation.
- Public `/uploads` delivery.
- Browser-supplied identity as authentication.
- SHA256 password storage.
- Emailed temporary passwords.
- Runtime schema creation/repair.
- Prototype role switchers and variant selectors in the real application.
- OCR for scanned documents.
- Multi-program/multi-institution administration.
- Automated activity grading.
- Predictive student-risk analytics.
- External LMS integration.
- Separate notification service, push notifications, or SMS.
- Microservices, command buses, event sourcing, separate read databases, Redis, Celery, and vector databases.
- Online institutional deployment during this pilot.

These exclusions do not remove ordinary email transport for invitations/resets or in-app announcements.

---

### 2. Repository layout, runtime, and package management

#### Observed environment

Read-only inspection found:

- Old virtual environment: **Python 3.12.14**.
- Bundled Node runtime: **v24.19.0**.
- New project currently has source documents and `docs/comms/`; no application scaffold.
- Docker executable exists. **Docker daemon availability is UNKNOWN.**
- Global `py`, Python, npm, and Git availability in Claude’s execution shell must be checked.

#### Implementation defaults

- Python **3.12.x**, using 3.12.14 as the verified available baseline.
- Node **24.x LTS**, using 24.19.0 as the verified available baseline.
- npm with a committed `package-lock.json`.
- Python `venv` and pip.
- `pyproject.toml` for project/tool configuration.
- Separate committed runtime and development requirements files with exact resolved versions.
- Fresh v2 virtual environment; do not reuse the old environment as v2’s environment.
- React 19, TypeScript, and stable mutually compatible Vite/React Router releases.
- SQLAlchemy 2.x and Pydantic 2.x.

Exact dependency minor/patch versions are **UNKNOWN until the initial dependency resolution**. Resolve compatible stable versions, commit the lock/pins, and record them. Do not describe them as already installed in v2.

Python 3.12 remains a supported branch, and Node’s official release information supports using an LTS line. These are compatibility choices, not a claim that the observed patches are the latest. [Python version status](https://devguide.python.org/versions/), [Node release information](https://nodejs.org/en/about/previous-releases).

Proposed layout:

```text
learnsync-v2/
  CLAUDE.md
  README.md
  .gitignore
  .env.example
  compose.yaml

  docs/
    IMPLEMENTATION_PLAN.md
    REQUIREMENTS.md
    DESIGN_SYSTEM.md
    ARCHITECTURE.md
    ACCEPTANCE.md
    OPERATIONS.md
    DECISIONS.md
    reference/
      dashboard-prototype.html
    comms/                       # preserve existing channel records
    sample-modules/              # preserve existing source material
    existing paper/access documents

  backend/
    pyproject.toml
    requirements.txt
    requirements-dev.txt
    alembic.ini
    migrations/
    app/
      main.py
      config.py
      db.py
      security.py
      files.py
      cli.py
      features/
        accounts/
        academics/
        teaching/
        assessments/
        grading/
        study/
        progress/
        support/
    tests/

  frontend/
    package.json
    package-lock.json
    vite.config.ts
    tsconfig.json
    index.html
    src/
      app/
        router.tsx
        providers.tsx
        api.ts
      components/
      styles/
        tokens.css
        global.css
      features/
        accounts/
        academics/
        teaching/
        assessments/
        grading/
        study/
        progress/
        support/
    tests/

  tests/
    e2e/

  scripts/
    backup.ps1
    restore.ps1

  .github/
    workflows/
      ci.yml

  var/                           # ignored runtime data
    uploads/
    backups/
```

This is an organization map, not an instruction to create empty files or folders for every future feature. Add each slice when implementing its milestone.

`CLAUDE.md` should contain:

- Project location and scope.
- Source precedence.
- A short map to the detailed documents.
- Phase order and acceptance-gate requirement.
- Permission boundaries.
- Instructions to report actual results and blockers.
- Instructions to preserve the old project.

Keep requirements in one authoritative place rather than duplicating them across every document.

---

### 3. Backend design

#### Stack

Implementation defaults:

- FastAPI.
- Pydantic 2.
- SQLAlchemy 2 ORM.
- Psycopg 3.
- Alembic migrations.
- `pwdlib[argon2]` for Argon2 password hashing.
- `httpx` for provider HTTP requests.
- `pypdf`, `python-docx`, `python-pptx`, and `openpyxl` for document processing.
- A maintained HTML sanitizer, such as `nh3`, for the visual editor’s HTML.
- ReportLab and openpyxl for real PDF/XLSX exports.
- SMTP through the standard library.

Argon2 through pwdlib follows FastAPI’s documented password-hashing guidance; the session design below deliberately uses opaque cookies rather than the tutorial’s JWT mechanism. [FastAPI security guidance](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/).

#### Slice organization

A slice may contain:

```text
teaching/
  router.py
  schemas.py
  models.py
  commands.py
  queries.py
  documents.py                  # only when parsing needs its own module
```

Responsibilities:

- `router.py`: HTTP binding, authenticated dependencies, response models.
- `schemas.py`: request/response validation.
- `models.py`: feature-owned database mappings.
- `commands.py`: mutations, business validation, transactions.
- `queries.py`: permission-scoped reads and projections.
- Optional helper modules only when their contents justify the split.

Small slices may combine files. Do not introduce a generic repository/service/interface hierarchy.

Cross-cutting modules should remain limited to actual shared concerns: configuration, database sessions, authentication, file handling, and consistent errors.

#### Database sessions and transactions

- Use synchronous SQLAlchemy sessions and ordinary `def` database endpoints.
- Use one session per request and one explicit transaction per command.
- Queries must not mutate records.
- Database constraints enforce uniqueness and core relationships.
- Commands enforce actor permissions, current term state, and publication/revision rules.
- Use row locks or compare-and-swap where concurrency can otherwise lose data.
- Perform slow provider/network calls outside database locks.
- Recheck permissions and draft revision before saving the result of a long operation.

SQLAlchemy documents session transaction boundaries directly; use those rather than inventing a unit-of-work abstraction. [SQLAlchemy session basics](https://docs.sqlalchemy.org/en/20/orm/session_basics.html).

#### Pragmatic CQRS example

**Command**

```text
POST /api/offerings/{offering_id}/syllabus/publish
Body: { draft_id, expected_revision }
```

Flow:

1. Authenticate the faculty account.
2. Verify it is assigned to this offering.
3. Verify the term is open.
4. Lock/check the requested draft revision.
5. Validate outline, grading policy, and references.
6. Freeze the revision as published.
7. Update the syllabus’s current published pointer.
8. Mark affected published grades as requiring review when grading rules changed.
9. Record an audit event.
10. Commit once.

**Query**

```text
GET /api/offerings/{offering_id}/syllabus
```

- Faculty receives its published revision and authorized draft information.
- Student receives the published projection only.
- Admin does not receive teaching content merely because it is an admin.

Both use the same Postgres database. No event bus or separate read store is required.

#### API conventions

Use `/api`, not a speculative versioning framework.

- Authenticate through a server principal.
- Parent-child identifiers must belong to the same offering.
- Explicit student response schemas omit restricted fields.
- Paginated lists default to 25 rows, maximum 100.
- Preserve filters and sorting in query parameters.
- `401`: authentication required.
- `403`: authenticated actor lacks the relevant role/capability.
- `404`: inaccessible or nonexistent resource where revealing existence would leak information.
- `409`: revision conflict, closed term, attempt conflict, or invalid state transition.
- `422`: field/business validation.
- `429`: rate limit.
- Provider/storage failures return safe actionable errors rather than raw exceptions.

Suggested error contract:

```json
{
  "error": {
    "code": "draft_revision_conflict",
    "message": "This draft changed elsewhere. Review the newer version before saving.",
    "field_errors": {},
    "request_id": "..."
  }
}
```

Document this in OpenAPI. Do not create a separate hand-maintained API specification that drifts from the routes.

#### Authentication and sessions

Implementation defaults:

- Random opaque session token in an HttpOnly cookie.
- Store only a hash of the session token in Postgres.
- `SameSite=Lax`, `Path=/`.
- `Secure=true` under HTTPS; explicitly false for the local HTTP pilot.
- Rotate session identifiers after login and privilege/ownership changes.
- Default absolute lifetime: 12 hours.
- Default idle timeout: 30 minutes.
- Logout revokes the server session.
- Password reset, deactivation, and admin handover revoke relevant sessions.
- Rate-limit login, invitation/resets, and AI requests.

CSRF:

- Use a session-bound CSRF token.
- Require it on unsafe browser requests.
- Validate request origin.
- Support an anonymous session/token for login and invitation/reset forms.
- Rotate the CSRF token when the authenticated session rotates.

Authorization:

- Every request checks the current account status and role.
- Faculty authorization checks the offering’s teacher assignment.
- Student authorization checks enrollment and resource targeting.
- Browser route guards improve UX but are not the permission boundary.
- Never accept `teacher_id`, `student_id`, or `admin_user_id` as proof of identity.

Passwords:

- Argon2 with the library’s supported defaults.
- Default minimum 12 characters; permit passphrases.
- Bound password length to prevent abusive input.
- No password composition rules or emailed plaintext passwords.
- No SHA256 compatibility migration.

Invitation/reset defaults:

- Cryptographically random, hashed, single-use tokens.
- Invitation lifetime: 48 hours.
- Reset lifetime: 30 minutes.
- First activation verifies possession of the invitation and sets a user-chosen password.
- Reset requests use a generic response to avoid account enumeration.
- Reissuing an invitation/reset invalidates the prior token.

#### Institutional admin handover

Confirmed:

- Program head has separate institutional admin and personal faculty emails.
- The institutional admin account is transferred to the new head.
- Password sharing is not the handover mechanism.

Implementation default:

- An authenticated admin initiates a named handover.
- The incoming owner accepts through the institutional email flow and sets a password.
- Record old/new owner labels and an ownership generation.
- Revoke prior sessions and pending tokens on completion.
- Preserve audit actor labels and ownership generation so historical actions do not appear to have been performed by the new owner.
- Prevent accidental removal of the last active admin.
- Record account handover separately from teacher reassignment.

#### File storage and authorization

Default storage:

```text
var/uploads/
  {file_uuid_prefix}/
    {file_uuid}
```

Database metadata stores:

- Original filename.
- Verified type.
- Size.
- SHA256 checksum.
- Relative storage key.
- Uploader.
- File purpose.
- Creation/status information.

Rules:

- Generated storage keys, never user-supplied paths.
- No static mount for uploads.
- Download through `GET /api/files/{file_id}/download`.
- Authorize using the file’s attached syllabus/material/submission.
- Student material access requires enrollment, applicable section scope, and publication.
- Student submission access is limited to its owner.
- Assigned faculty can access relevant submissions.
- Admin can access academic import/prospectus files, not teaching submissions.
- Serve user uploads as attachments by default.
- Use safe filenames and response headers.

Default maximum upload: 20 MiB, configurable.

Validate:

- Extension and actual supported file structure.
- Streaming size limit.
- Archive expansion limits for DOCX/PPTX/XLSX.
- Extraction bounds.
- Resource ownership before attaching an existing file ID.

Write to a temporary generated location, finalize metadata/linking safely, and clean up failed/unattached writes. Add a maintenance command for orphaned files rather than a background cleanup service.

File uploads are not recovered offline. The UI must distinguish text draft recovery from file-upload completion.

---

### 4. Proposed data model and lifecycle rules

This is a **new schema**, not a mapping of old SQL tables.

Use UUID primary keys, `timestamptz` timestamps, explicit foreign keys, and named constraints. Use `numeric`/Python `Decimal` for points and grade calculations.

Use JSONB where versioned document structure is the real aggregate; do not normalize every syllabus sentence into its own table.

#### Accounts

| Table | Key columns and relationships |
|---|---|
| `account` | `id`, normalized unique `email`, `display_name`, `role` (`admin/faculty/student`), unique nullable `student_number`, `password_hash`, `status`, `email_verified_at`, `ownership_generation`, timestamps |
| `auth_session` | `id`, nullable `account_id` for pre-login sessions, unique `token_hash`, CSRF value, `created_at`, `last_seen_at`, `expires_at`, `revoked_at` |
| `account_token` | `id`, `account_id`, `purpose` (`invite/reset/handover`), unique `token_hash`, `expires_at`, `consumed_at`, initiating actor |
| `audit_event` | `id`, actor account, actor label/ownership snapshot, action, entity type/id, safe before/after metadata, timestamp |

Student numbers are required for student accounts. Faculty/admin accounts do not need separate profile tables unless additional role-specific data actually appears.

Audit logs must omit passwords, session/reset tokens, provider keys, and unnecessarily duplicated student/chat content.

#### Academic administration

| Table | Key columns and relationships |
|---|---|
| `school_year` | `id`, unique label, start/end dates, status |
| `academic_term` | `id`, `school_year_id`, name/sequence, start/end dates, `status`, closure metadata |
| `subject` | `id`, unique code, title, units, catalog year/semester placement, description, active/archive status |
| `prospectus_import` | `id`, source `file_id`, extracted draft JSON, warnings, revision, review/commit metadata |
| `section` | `id`, `term_id`, name, year level; unique name within term |
| `section_member` | `id`, `section_id`, student account, status; unique student/section association |
| `offering` | `id`, `subject_id`, `term_id`, assigned faculty, status |
| `offering_section` | `offering_id`, `section_id`; composite uniqueness |
| `enrollment` | `id`, `offering_id`, student, teaching section, source (`regular/exception`), status, timestamps; unique student/offering |
| `enrollment_exception` | student, offering, action (`include/exclude`), teaching section for inclusion, reason, actor |
| `student_import` | source file, preview JSON, warnings/errors, revision, committed metadata |

Regular enrollment is derived from:

- Term section membership.
- Catalog year/semester placement.
- Offering-section associations.
- Include/exclude exceptions.

Materialize effective enrollments so teaching queries stay simple. Update them transactionally when administration changes. Preserve withdrawals/history rather than physically deleting students with academic records.

Default: one primary regular section per student per term. Irregular subject attendance is represented by explicit teaching-section exceptions.

One offering belongs to one teacher, one subject, and one term. Multiple sections may share it. Different teachers teaching the same subject get different offerings.

#### Syllabus, content, and announcements

| Table | Key columns and relationships |
|---|---|
| `syllabus` | `id`, unique `offering_id`, current published revision pointer |
| `syllabus_revision` | `id`, `syllabus_id`, version number, state, mutable draft revision counter, `outline_json`, `grading_policy_json`, source file, creator/publisher, publication time |
| `learning_item` | `id`, `offering_id`, kind (`lesson/file/reference`), current published revision pointer, archive state |
| `learning_item_revision` | item FK, version, draft revision counter, state, title, sanitized body, file/reference information, syllabus anchor UUID, timestamps |
| `learning_item_section` | item FK and section FK; absence of rows means all offering sections |
| `teaching_coverage` | offering, section, stable syllabus node key, faculty-recorded coverage/date |
| `announcement` | offering, title/body, author, publication state/time |
| `announcement_section` | announcement and section targeting |

Syllabus JSON contains:

- Course information.
- Outcomes.
- Chapters.
- Optional subsections.
- Topics.
- Stable UUIDs for outline nodes.
- Teaching schedule/week information.
- Grading policy.

Stable node UUIDs survive reordering and renaming. They are not array indexes.

Draft lifecycle:

- One active draft per document.
- Autosave mutates that draft using a revision counter.
- Publishing freezes it.
- Editing published content creates a new draft based on the published revision.
- Student queries follow published pointers only.
- Draft edits do not change current student content.

Deleting/replacing outline nodes requires resolving attached content. Preserve historical anchors and completed work; do not silently drop assessment records because an outline changed.

Faculty coverage and student completion are separate records and labels.

#### Assessments and submissions

| Table | Key columns and relationships |
|---|---|
| `assessment` | `id`, `offering_id`, kind (`online_quiz/offline_quiz/activity/exam/manual`), current published revision, archive state |
| `assessment_revision` | assessment FK, version/state/revision counter, title, instructions, grading period/category, maximum points, availability/deadline, late policy, attempt policy, grading inclusion flag, author/publication metadata |
| `assessment_section` | assessment and target section; no rows means all offering sections |
| `quiz_question` | assessment revision FK, stable question key, type, prompt, choices JSON, private accepted answers, private explanation, points, order |
| `quiz_attempt` | assessment revision FK, student FK, attempt number, state, start/submission times, total score/max score, submission idempotency key |
| `quiz_answer` | attempt FK, question FK, student response, awarded points; unique attempt/question |
| `activity_submission` | assessment revision FK, student FK, submission version, file FK, optional note, submitted time, late flag |
| `submission_permission` | assessment/student, faculty-granted resubmission or deadline exception, reason, expiry/consumption metadata |
| `assessment_score` | assessment/student, selected attempt/submission where applicable, working score, feedback, revision, grading actor/time |
| `assessment_result_publication` | score FK, release number, immutable score/feedback/source snapshot, publisher/time |
| `attendance_session` | offering, section, date, grading period, revision/state |
| `attendance_mark` | session/student, status (`present/absent/late/excused`), unique session/student |

Using a common assessment identity avoids separate unrelated score systems. Type-specific logic still belongs in the appropriate feature functions; do not build a generic configurable assessment framework.

#### Quiz behavior

Confirmed:

- Multiple choice, true/false, and short answer.
- One attempt by default.
- Faculty may configure additional attempts and score selection before publication.
- Student totals appear immediately.
- No student answer keys or solution explanations.

Defaults:

- Multiple choice uses four choices, one accepted choice.
- True/false uses two fixed choices.
- Short answers use teacher-defined accepted strings.
- Normalize Unicode, trim/collapse whitespace, and compare case-insensitively.
- Do not use AI or fuzzy matching to decide short-answer correctness.
- Faculty can make an audited manual correction.
- With multiple attempts, score rule is explicitly `highest` or `latest`; default `highest`.
- Lock answer keys, points, attempt limits, and score-selection rule after attempts begin.
- Keep student attempt responses against the exact published assessment revision.
- Persist an in-progress attempt and saved answers so a page reload does not create another attempt.
- Make submit idempotent and enforce attempt limits transactionally.
- Post-submission screens show totals and attempt metadata, not solutions or a reusable answer-review screen.

Do not add an unrequested quiz timer initially. Availability/deadline enforcement is sufficient.

#### Activity behavior

Confirmed:

- Teacher grades manually.
- Student may replace work before deadline.
- Later replacement requires teacher permission.
- Late submissions blocked by default, configurable per activity.

Defaults:

- PDF activity submission plus optional text note.
- Keep each submitted version.
- Grade against a specific version.
- A new submission never silently overwrites a released result.
- Allowing late work does not automatically authorize replacing a previous submission after its deadline.
- Late penalties are manually applied by faculty.
- Preserve the last released result while a new version/correction awaits review.

#### Grade publication

| Table | Key columns and relationships |
|---|---|
| `grade_publication` | offering/student, period (`midterm/finals/course`), release number, numeric grade/remark, immutable calculation snapshot, syllabus/policy version, publisher/time |
| `grade_review_state` | offering/student/period, `needs_review`, reason, changed time; unique context |

The current published grade is the latest publication for that context. A working recalculation is not a new publication.

The snapshot includes:

- Grading-policy version.
- Categories and weights.
- Source assessment/attendance values and revisions.
- Selected quiz attempts.
- Calculated category, period, and course values.
- Publisher/time.

Corrections or grading-policy changes:

1. Update working data.
2. Set affected grade review flags.
3. Preserve the last published grade.
4. Require faculty review and explicit republication.
5. Append a new immutable publication.

Do not delete the current student-visible grade when working data changes.

#### Grading rules

Retain the existing base calculation:

```text
category raw percentage =
  sum(earned points) / sum(possible points) × 100

optional transmutation =
  50 + raw percentage / 2

period grade =
  sum(category percentage × category weight / 100)

course grade =
  sum(period grade × period share / 100)
```

Rules:

- Base categories: attendance, quiz, activity, exam.
- Midterm and Finals.
- Category weights total 100%.
- Period shares total 100%.
- All totals must be positive.
- Scores are between zero and the item’s maximum.
- Missing required records/scores mean pending, not zero.
- Explicitly recorded zero is a valid score.
- Zero-weight categories do not block a grade.
- Round published results to two decimal places.
- Use unrounded category values in weighted calculations.
- Preserve the old behavior of deriving the course grade from the rounded period grades.
- Default passing threshold: 75.
- Default shares: Midterm 50%, Finals 50%.
- Default transmutation: raw.
- Do not invent default category percentages. Faculty must confirm a valid policy.

Participation/recitation normally uses named activity-category entries. If a syllabus explicitly needs a separate category, support a named manual category with its own configured weight using the same formula.

Attendance:

- Present: 1.
- Absent: 0.
- Late: configurable fraction; default 0.5.
- Excused: excluded from numerator and denominator.
- Unmarked attendance is pending.
- An entirely excused/no-data category is pending when its weight is nonzero.

Keep result publication separate from grade publication:

- Online quiz total: immediately released.
- Other assessment results: faculty releases individually.
- Midterm/Finals/Course grades: separate explicit publication actions.

#### AI, progress, and support

| Table | Key columns and relationships |
|---|---|
| `content_chunk` | published learning-item revision FK, ordinal, extracted text, page/slide locator, searchable vector |
| `study_conversation` | student/account FK, offering FK, title, timestamps |
| `study_message` | conversation FK, role, message text, cited-source metadata, model ID, timestamp |
| `ai_generation` | offering/faculty FK, selected source revisions, requested settings, model, status/error metadata, resulting assessment draft |
| `lesson_completion` | student, learning-item/revision, completed flag/time; unique student/item context |
| `learning_event` | student/offering, event type, logical resource ID, revision/attempt/submission ID, timestamp, idempotency key |
| `issue_report` | reporter, type, title, description, status (`open/in_progress/resolved`), admin review metadata |

AI conversations are private to their owner. Faculty gets progress views, not automatic access to students’ private chats.

Progress:

- Daily/weekly counts use valid completion/submission events.
- Avoid inflation from repeated requests.
- Distinguish quiz attempts from distinct quizzes.
- Distinguish activity revisions from distinct activities submitted.
- Lesson completion is explicitly student-reported.
- Opening a lesson is not proof of completion.
- Completion percentages use published learning steps applicable to the student.
- Topics without assigned learning steps do not magically count as completed.
- Explain denominator changes after new content publication.
- Progress is not a grade or a claim of measured mastery.
- Do not estimate study time.

#### Term and rollover lifecycle

- New school year/term creates new sections, offerings, memberships, and enrollments.
- Keep the subject catalog.
- Do not bulk-delete prior assignments/enrollments.
- Historical grades, drafts, publications, attendance, attempts, submissions, and references survive.
- Closed terms are read-only for faculty and students.
- Admin may explicitly reopen a term with an audit reason.
- Reopening does not give admin teaching-content access.
- Faculty corrections still require result/grade republication.

#### Migration policy

**Confirmed: no migration.**

Do not:

- Import `learnsync.sql` into v2.
- Point v2 at the old database.
- Copy old password hashes.
- Mount old SQL initialization files in v2 Compose.
- Build a legacy migration subsystem.

Alembic creates v2 from an empty database.

Any later old-data migration would be a separate user-approved project.

---

### 5. Frontend, design system, and page inventory

#### Stack defaults

- React + TypeScript + Vite.
- React Router for actual nested routes.
- TanStack Query for server state.
- Native `fetch` for HTTP transport.
- React local state for temporary UI state.
- Native forms and field validation plus server validation.
- Tiptap’s open-source editor with the required formatting/table extensions.
- Plain CSS semantic tokens and a small shared component set.
- Native `<dialog>` for short forms and confirmations.
- No full UI kit initially.
- No Redux, separate client domain model, or generic form engine.

React’s official guidance identifies Vite, React Router, and TanStack Query as options for a client React app. Tiptap provides the established editor integration rather than requiring a homemade contenteditable editor. [React guidance](https://react.dev/learn/build-a-react-app-from-scratch), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview), [Tiptap React integration](https://tiptap.dev/docs/editor/getting-started/install/react).

TanStack Query owns fetched state. Query keys must include account/context identifiers as appropriate. Clear authenticated caches on logout/account change.

Do not automatically retry non-idempotent submissions or publications.

#### Design intent

Use the current prototype’s **Variant A** as the layout baseline.

Borrow:

- Classroom: clear subject organization, restrained navigation, understandable assignments.
- Brilliant: focused next step, readable learning screens, clear progress.

Do not add unrequested gamification, decorative streak mechanics, or reward systems.

The prototype is a UX reference. Its role selectors, canned chat, local demo state, export tricks, and script wrappers are not production architecture.

#### Light palette: preserve existing values

| Token | Value |
|---|---|
| Brand navy | `#12354b` |
| Brand blue | `#186891` |
| Strong blue | `#115477` |
| Soft blue | `#e7f2f7` |
| Canvas | `#f4f7f9` |
| Surface | `#ffffff` |
| Text | `#193447` |
| Muted | `#5d7180` |
| Border | `#d8e2e8` |
| Success | `#167457` |
| Warning | `#ad6b14` |
| Danger | `#b64343` |
| Base panel radius | `14px` |

Use semantic names such as `--surface`, `--text`, `--action`, and `--border`; components should not scatter literal palette values.

#### Themes

Confirmed options: `system`, `light`, `dark`.

Defaults:

- System is the initial preference.
- Store preference locally and in authenticated account preferences when available.
- Apply it before first paint.
- Listen for OS changes only in system mode.
- Use `data-theme` and CSS variables.
- Set CSS `color-scheme`.
- Preserve preference across navigation and refresh.

Suggested dark starting values:

```text
canvas:       #0b1720
surface:      #122634
surface-alt:  #193447
text:         #e7f2f7
muted:        #adc3d0
border:       #31576b
action:       #8ed6e8
action-text:  #12354b
```

These dark values are implementation defaults and require contrast verification. Do not mechanically invert the light theme.

#### Responsive behavior

Defaults:

- Base: under 640px.
- Small/tablet: 640px and above.
- Desktop navigation: 1024px and above.
- Wider content: 1280px and above.

Behavior:

- Single-column base layout.
- Collapsible navigation drawer below desktop.
- Desktop sidebar.
- Large touch targets, approximately 44px.
- Short dialogs fit the viewport and become nearly full-width on small screens.
- Dialog bodies scroll without hiding actions.
- Ordinary lists become cards when a table would be unreadable.
- Gradebooks may scroll horizontally inside a labeled region with sticky student identifiers.
- Avoid whole-page horizontal overflow.
- Show loading, empty, validation, saving, failure, and retry states.
- Use text/icons alongside status colors.

#### Forms and modals

Use a modal when:

- The form is short and self-contained.
- It does not need document review or substantial navigation.
- It can reasonably fit a few simple fields.

Examples:

- Subject metadata.
- Section creation.
- Account invitation.
- Teacher assignment.
- Single score edit.
- Attendance correction.
- Short announcement.
- Confirmation with a required reason.

Use dedicated pages for:

- Prospectus/student import review.
- Syllabus editing.
- Lesson editing.
- Quiz construction/review.
- Activity setup requiring detailed instructions.
- Gradebooks.
- Multi-step workflows.

Native dialog requirements:

- Accessible name.
- Focus moves inside.
- Focus returns to the triggering control.
- Keyboard/Escape behavior.
- No accidental dismissal of unsaved changes.
- Validation errors associated with their fields.

#### Navigation

- Use real links and browser history.
- Keep offering, section, term, and list-filter context in routes/query strings.
- Return from a detail/editor to its originating list/context.
- Direct links use a sensible parent fallback when there is no history.
- Cancel closes a modal or returns to the parent without publishing.
- Save draft and Publish are distinct actions.
- Confirm quiz save/publication clearly.
- Role navigation exposes only authorized destinations.
- Preserve context when changing tabs inside an offering.

#### Page inventory and route defaults

Common:

```text
/login
/accept-invitation
/forgot-password
/reset-password
/account
```

Admin:

```text
/admin
/admin/terms
/admin/prospectus
/admin/subjects
/admin/sections
/admin/sections/:sectionId
/admin/students
/admin/students/import
/admin/offerings
/admin/offerings/:offeringId/enrollment
/admin/accounts
/admin/accounts/:accountId
/admin/issues
/admin/audit
```

Faculty:

```text
/faculty
/faculty/offerings
/faculty/offerings/:offeringId
/faculty/offerings/:offeringId/students
/faculty/offerings/:offeringId/syllabus
/faculty/offerings/:offeringId/content
/faculty/offerings/:offeringId/content/:itemId/edit
/faculty/offerings/:offeringId/quizzes
/faculty/offerings/:offeringId/quizzes/:assessmentId/edit
/faculty/offerings/:offeringId/activities
/faculty/offerings/:offeringId/activities/:assessmentId/submissions
/faculty/offerings/:offeringId/attendance
/faculty/offerings/:offeringId/examinations
/faculty/offerings/:offeringId/gradebook
/faculty/offerings/:offeringId/progress
/faculty/offerings/:offeringId/announcements
/faculty/issues
```

Student:

```text
/student
/student/offerings
/student/offerings/:offeringId
/student/offerings/:offeringId/lessons/:itemId
/student/offerings/:offeringId/materials
/student/offerings/:offeringId/quizzes/:assessmentId
/student/offerings/:offeringId/activities/:assessmentId
/student/offerings/:offeringId/results
/student/offerings/:offeringId/grades
/student/offerings/:offeringId/study
/student/progress
/student/issues
```

Some inventory entries can be tabs on one page with connected routes. They do not require a unique component hierarchy or duplicate layout.

#### Autosave and recovery

Defaults:

- Debounced server save after approximately one second of inactivity.
- Browser recovery updated promptly after edits.
- Flush before pagination/navigation where possible.
- Do not depend solely on page-unload network requests.
- Key recovery by account, offering, entity, and base revision.
- Show `Saving`, `Saved`, `Offline`, `Save failed`, or `Conflict`.
- Retain local unsaved text after network failure.
- On reconnect, retry with the expected server revision.
- On `409`, show recovered/current versions and let the faculty choose how to reconcile.
- Never silently overwrite another tab’s newer work.
- Handle local-storage quota failure visibly.
- Clear sensitive recovery state on intentional logout, after warning about unsaved work.
- Automatic session expiry can preserve account-scoped recovery until the same user signs in again.
- Do not expose one account’s recovery through another account’s UI.

Browser recovery is a convenience on the faculty’s device, not a substitute for server drafts or a guarantee against a compromised/shared browser.

---

### 6. AI design

#### Confirmed choices

- Groq.
- Hosted API.
- Real integration before acceptance.
- English, Filipino, and natural Taglish.
- Friendly conversation, subject-focused instructional answers.
- Ground answers in published materials and faculty-approved references.
- Teacher review before quiz publication.
- Supported Groq model alternatives allowed; document a deviation from the paper.

#### Models

The paper names `llama-3.3-70b-versatile`.

Groq currently lists that model and `openai/gpt-oss-20b` / `openai/gpt-oss-120b`; its documentation marks the Llama offering as Enterprise. Account access is **UNKNOWN** and must be verified. [Groq supported models](https://console.groq.com/docs/models).

Default selection procedure:

1. Verify accessible models with the configured Groq account.
2. Use Llama 3.3 70B if accessible.
3. Otherwise use accessible `openai/gpt-oss-20b` as the pilot baseline.
4. Record the selected model and paper deviation.
5. Keep model IDs in environment configuration.
6. Do not silently switch models during a request.

The `openai/` model prefix here refers to a model served through Groq; it does not change the provider to OpenAI.

#### Grounding: chunking plus Postgres retrieval

Implementation default:

- Extract text from published PDF/DOCX/PPTX, lesson HTML, and reviewed reference snapshots.
- Store chunks in Postgres.
- Use ordinary Postgres full-text retrieval plus title/topic matching.
- Start with the `simple` dictionary so multilingual text is not dependent on English stemming.
- **No embeddings or vector database initially.**

Chunk defaults:

- Approximately 2,000 characters.
- Approximately 200-character overlap.
- Prefer paragraph/page/slide boundaries.
- Retain source revision, title, page/slide, and syllabus anchor.
- Select up to eight relevant chunks within a roughly 12,000-character source-context budget.
- Keep at most six recent conversation messages, separately bounded.
- Explicitly selected lesson/topic can guide retrieval.
- If no adequate context exists, ask for clarification or explain that the materials do not cover it.

Every retrieval query filters:

- Offering.
- Student enrollment.
- Section scope.
- Current publication.
- Reference approval.
- Archive state.

Do not retrieve from:

- Quiz prompts.
- Answer keys.
- Private explanations.
- Activity/exam solution data.
- Student submissions.
- Grades.
- Faculty drafts.
- Other offerings.

Grounding should return source links/locators the student can actually access. Validate citation identifiers rather than trusting arbitrary model-generated URLs.

#### Reference links

- A link alone is not sufficient source text.
- Faculty can request safe extraction and review the extracted snapshot.
- Allow manually supplied reviewed text if extraction fails.
- Validate HTTP/S destinations and block private/local network targets.
- Revalidate redirects and DNS resolution.
- Bound fetch size/time.
- Preserve the old reference-fetch security approach after reviewing and testing it.
- Student questions must not trigger arbitrary browsing or crawling.

#### Conversation flow

1. Authenticate and authorize the offering.
2. Verify conversation ownership and offering association.
3. Validate/rate-limit the message.
4. Retrieve permitted published sources.
5. Build the subject-scoped prompt.
6. Send bounded context/history to Groq.
7. Validate response/citations.
8. Store the conversation message and source metadata.
9. Return a safe response.

Start with normal JSON request/response; streaming is deferred.

Default provider timeout: 45 seconds.

On failure:

- Preserve the student’s entered message.
- Provide a retryable UI state.
- Do not show a fabricated “AI response.”
- Do not expose provider credentials or raw provider errors.
- Bound retries and avoid duplicate saved messages.

#### Assessment protection

- Use distinct study and quiz-generation pipelines.
- Never put private assessment artifacts in study retrieval.
- Instruct the model to offer concept guidance and separate practice examples rather than solve submitted assessments.
- Test direct requests for answers, pasted quiz questions, role spoofing, and source prompt injection.
- Treat retrieved text as source data, not instructions.
- Default: pause the study assistant for an offering while that student has an active online quiz attempt in that offering.

This controls the application’s data exposure. It cannot guarantee prevention of cheating through external tools or detect every disguised question.

#### Quiz-draft generation

1. Faculty selects offering, published sources, question types, counts, and points.
2. Validate assignment and selected sources.
3. Send only approved bounded source context.
4. Request structured output.
5. Validate counts, question types, choices, accepted answers, and positive points.
6. Save as an unpublished assessment draft.
7. Show every question and its source information.
8. Faculty edits and explicitly records review.
9. Editing after review resets the review flag.
10. Publication requires the latest draft to be reviewed.

Defaults:

- Up to 30 questions per generation.
- Manual creation remains available when AI is unavailable.
- Generation errors do not discard an existing quiz draft.
- AI output is never directly published or automatically sent to students.

Provider requests include teaching text and the user’s message as needed, not automatic student names, rosters, or grades. Groq account terms, retention settings, and budget are **UNKNOWN**.

---

### 7. Local development, configuration, seed data, and operations

#### Compose services

Confirmed: native apps, Docker services.

Defaults:

| Service | Internal port | Host binding |
|---|---:|---|
| Postgres 16 | 5432 | `127.0.0.1:15432` |
| Mailpit SMTP | 1025 | `127.0.0.1:11025` |
| Mailpit web inbox | 8025 | `127.0.0.1:18025` |
| FastAPI, native | — | `127.0.0.1:8001` |
| Vite, native | — | `127.0.0.1:5173` |

These defaults avoid the old Compose configuration’s ports. Actual port availability is **UNKNOWN**.

- Separate v2 database and named volume.
- Postgres health check.
- No old SQL mounts.
- No pgAdmin requirement.
- Bind services to loopback for this pilot.
- Pin container versions/digests when creating the scaffold; resolved Mailpit version is currently **UNKNOWN**.

Vite proxies `/api` to FastAPI, keeping browser calls same-origin.

#### Environment variables

Root `.env.example`, ignored real `.env`.

```text
APP_ENV=development
APP_ORIGIN=http://127.0.0.1:5173
APP_TIMEZONE=Asia/Manila

POSTGRES_DB=learnsync_v2
POSTGRES_USER=learnsync_v2
POSTGRES_PASSWORD=<local secret>
DATABASE_URL=postgresql+psycopg://...

UPLOAD_ROOT=<absolute v2 var/uploads path>
UPLOAD_MAX_BYTES=20971520

SESSION_COOKIE_NAME=learnsync_v2_session
SESSION_COOKIE_SECURE=false
SESSION_MAX_AGE_SECONDS=43200
SESSION_IDLE_TIMEOUT_SECONDS=1800
INVITATION_TTL_SECONDS=172800
RESET_TTL_SECONDS=1800

SMTP_HOST=127.0.0.1
SMTP_PORT=11025
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_USE_TLS=false
MAIL_FROM=learnsync@example.test

GROQ_API_KEY=
GROQ_CHAT_MODEL=<verified accessible model>
GROQ_QUIZ_MODEL=<verified accessible model>
AI_TIMEOUT_SECONDS=45

TEST_DATABASE_URL=postgresql+psycopg://.../learnsync_v2_test
```

- Environment configuration is server-side.
- Do not put secrets in `VITE_*` variables.
- Never commit real credentials.
- Validate required configuration at startup.
- Permit non-AI slices to run without a Groq key, with AI explicitly unavailable.
- Missing keys do not count as completed AI acceptance.

Default request limits:

- Login: five attempts/minute per relevant IP/account context.
- Reset/invitation requests: tightly bounded per account/IP.
- Study chat: ten requests/minute per account.
- Quiz generation: two requests/minute per faculty account.

An in-process limiter is sufficient for the single-process local pilot; document its reset/multi-process ceiling. Use a shared limiter only when deployment requires it.

#### Email interpretation

Mailpit demonstrates invitations, verification, and resets locally. It does not prove control of a real institutional mailbox.

Real SMTP provider, institutional domain restrictions, and mailbox handover logistics are **UNKNOWN**. Do not hardcode an invented school email domain.

#### Local commands to implement and document

These are target commands, not commands already verified in v2:

```powershell
# From the new project
docker compose up -d
```

```powershell
# Backend
Set-Location backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.cli bootstrap-admin --email <institutional-email>
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

```powershell
# Frontend, separate terminal
Set-Location frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Implement configuration loading consistently regardless of current working directory.

Bootstrap admin:

- Prompt for the password securely.
- Do not accept a default production password.
- Prevent accidental repeated bootstrap when an admin already exists.
- Audit bootstrap and document recovery separately.

#### Development seed

Separate, explicit development-only command:

```text
python -m app.cli seed-demo
```

Seed:

- One admin.
- Two faculty accounts to test assignment isolation.
- Several students, including an irregular student.
- Two terms: an open term and a closed historical term.
- At least two sections.
- At least two subjects and teacher-owned offerings.
- Draft and published syllabi/content.
- Manual and reviewed AI-origin quiz examples.
- Attendance with all statuses.
- Submitted/unsubmitted/late activities.
- Released/unreleased scores.
- Published and pending-review grades.
- Daily/weekly progress events.
- Announcements and issue reports.

Use fictional names/emails and development-only credentials. The seed must be idempotent and must not run in a non-development environment.

Do not label static seeded quiz examples as proof that real AI works.

#### Backup and restore

- Back up Postgres and private uploads together.
- Include schema/version metadata and a file manifest/checksums.
- Restore to a separate database/upload root first.
- Verify grade history, attachment accessibility, and counts.
- Never test restore over the old project’s database.
- Preserve existing database/upload directories unless an explicit destructive operation is approved.
- Document one manual backup command and one restore procedure; no scheduler is required.

---

### 8. Testing and CI

Because this is a complete rewrite with authentication and academic records, use focused automated suites rather than a self-check for every function.

#### Tool defaults

- pytest.
- FastAPI TestClient/httpx.
- Real Postgres for integration tests.
- Playwright for browser workflows.
- TypeScript build checks and ESLint.
- Ruff for Python linting.

Do not use SQLite to claim Postgres behavior was verified.

#### Backend tests

Prioritize:

**Authentication**

- Invitation activation and replay.
- Expired/reissued invitation.
- Password reset and replay.
- Session expiry/logout/revocation.
- Deactivated account.
- CSRF and origin enforcement.
- Admin handover and retained actor history.
- Last-admin guard.

**Permissions**

- Admin cannot read teaching content or gradebooks.
- Faculty cannot access another teacher’s offering.
- Students cannot access another student’s attempts/submissions/grades/chat.
- Guessing parent/child IDs cannot cross offering boundaries.
- Private downloads respect publication and ownership.
- Restricted fields absent from student JSON, including error responses.

**Academic setup**

- Section-derived enrollment.
- Irregular include/exclude.
- Duplicate memberships/enrollments.
- Import preview and transactional commit.
- Duplicate student number/email.
- New-term associations start fresh.
- Closed-term writes blocked; reopening audited.

**Drafts and files**

- Draft remains private.
- Publishing freezes a revision.
- Stale revision returns conflict.
- Parsing failure retains the source/manual recovery path.
- File size/type/path validation.
- Archive expansion limits.
- Cleanup of failed file associations.

**Assessment and grades**

- Attempt limit and concurrent submission.
- Idempotent quiz submission.
- Resume in-progress attempt.
- Short-answer normalization.
- No answer-key/explanation leakage.
- Late-submission policy.
- Resubmission permission and version preservation.
- Missing score versus explicit zero.
- Weighted points calculation.
- Transmutation.
- Attendance credit/excused behavior.
- Separate score and grade publication.
- Correction retains old publication and marks review.
- Republication appends history.
- No double-counting online/offline records.

**AI/progress**

- Retrieval excludes drafts, other offerings, keys, and submissions.
- Approved-source citations.
- Insufficient-context behavior.
- Prompt injection and assessment-answer requests.
- Provider timeout/error.
- Invalid quiz generation remains unpublished.
- Daily/weekly timezone boundaries.
- Duplicate event requests do not inflate progress.

#### Browser tests

One coherent multi-role scenario plus targeted edge cases:

1. Admin invites users, creates academic context, and assigns teaching.
2. Faculty edits/publishes content.
3. Student views it, completes learning, attempts quiz, and submits work.
4. Faculty grades/releases results and publishes overall grades.
5. Student sees only the correct released projections.
6. Faculty corrects a score and republishes.
7. Admin closes/reopens a term.

Test:

- Desktop and mobile.
- Light, dark, and system.
- Keyboard navigation and dialog focus.
- Direct links and reload.
- Back/Cancel origin context.
- Offline text recovery and revision conflict.
- No whole-page horizontal overflow.
- Logout/account switch clears restricted caches.

#### AI verification

Two separate categories:

- Deterministic provider-mocked checks in ordinary CI.
- Explicit live Groq smoke/evaluation with the real key and selected model.

Live checks must demonstrate:

- An English and Filipino/Taglish grounded answer.
- An unsupported question handled honestly.
- A valid unpublished quiz draft from actual sample material.
- A cheating/prompt-injection probe.

Do not put live provider calls into every CI run. Record the actual model, date, and outcome; never claim a mocked test proves live integration.

#### CI

CI hosting is **UNKNOWN**. Default deliverable: GitHub Actions workflow with portable local commands.

On push/PR:

1. Install pinned Python and npm dependencies.
2. Start isolated Postgres test service.
3. Apply Alembic migrations.
4. Run Python lint/tests.
5. Run frontend lint/typecheck/build.
6. Start apps with test configuration and demo seed.
7. Run the core Playwright flow.
8. Upload failure traces/screenshots.

No automatic public deployment.

Do not invent a percentage coverage target. Require meaningful checks for permissions, data loss, grading, and publication.

---

### 9. Milestones, acceptance gates, and first task

Proceed autonomously after each gate passes. Report unresolved external blockers honestly; do not fabricate completion.

#### Milestone 0 — documentation and runnable skeleton

Build **this first**:

- Save this implementation plan.
- Create short Claude entry instructions and source map.
- Preserve source documents/channel records.
- Initialize backend/frontend dependency manifests and locks.
- Compose Postgres/Mailpit.
- Configuration validation.
- Alembic baseline for accounts/sessions/tokens.
- API health endpoint.
- React shell, themes, and login route.

Acceptance:

- Fresh clone/setup can start both apps and services.
- Database migrations work from empty.
- No connection to old database.
- Themes work before first paint.
- Basic lint/build checks pass.

Do not begin with AI, a generic CQRS framework, or all teaching tables.

#### Milestone 1 — identity and access end to end

- Bootstrap admin.
- Invitations/email activation.
- Login/logout/reset.
- Admin invitations and account management.
- Institutional handover.
- Server permission dependencies.
- Role-specific dashboards/navigation.

Acceptance:

- A real browser can complete invite → password → login.
- Mailpit contains working single-use messages.
- Forged IDs do not bypass permissions.
- All three roles have correct navigation.
- Private pages fail correctly on direct access.
- Session/CSRF tests pass.

#### Milestone 2 — academic administration

- School years/terms.
- Prospectus source upload and reviewed extraction.
- Catalog/sections.
- Student import.
- Teacher-owned offerings.
- Regular and irregular enrollment.
- Close/reopen/new-year workflows.

Acceptance:

- Admin can establish a real teaching context.
- Assigned faculty sees it.
- Correct students see it.
- Other users do not.
- Import errors are previewed; no silent partial commit.
- Historical context survives new-year setup.

Prospectus extraction must produce a reviewed draft, not blindly create subjects. A failed parser still allows manual entry.

#### Milestone 3 — teaching and recoverable drafts

- Syllabus editing/import/publication.
- Stable outline anchors.
- Visual lesson editor.
- Private materials and references.
- Announcements.
- Faculty coverage.
- Server/browser recovery.

Acceptance:

- Student cannot see drafts.
- Published revision remains visible during edits.
- Faculty can reload/reconnect and recover work.
- Multi-tab conflicts are explicit.
- Downloads are authorized.
- Unsupported/scanned source has a clear manual path.
- Back/Cancel and syllabus pagination preserve work.

#### Milestone 4 — assessments and grading

- Manual quizzes.
- Attempt persistence and scoring.
- Activities/submission versions.
- Attendance/offline quizzes/exams/manual assessments.
- Working gradebook.
- Individual result release.
- Separate overall grade publication.
- Corrections/republication history.

Acceptance:

- Complete student assessment-to-grade workflow.
- Concurrent submit does not create extra attempts.
- No student solution fields.
- Missing/zero values behave correctly.
- Released result and grade visibility are independent.
- Corrections preserve last publications.
- Closed term blocks writes.

#### Milestone 5 — real AI and student progress

- Published-content extraction/chunks.
- Subject-scoped study conversations.
- Groq integration and chosen-model record.
- Reviewed AI quiz generation.
- Daily/weekly student and faculty progress views.

Acceptance:

- Real Groq checks pass.
- Published-source citations are usable.
- Private/assessment content excluded from retrieval.
- Invalid AI generation stays draft.
- Faculty review required after latest edits.
- Progress is idempotent and timezone-correct.
- English and Filipino/Taglish behavior demonstrated.
- Limitations against cheating documented.

#### Milestone 6 — exports, support, pilot verification

- Real PDF/XLSX exports.
- Issue-report lifecycle.
- Full mobile/theme/accessibility pass.
- Backup/restore rehearsal.
- Fresh setup rehearsal.
- Documentation updated to actual commands and results.

Acceptance:

- Exports match the selected offering/section/period and publication status.
- Draft exports are visibly marked as previews.
- Admin cannot export teaching grades.
- Restore preserves files and publication history.
- Complete browser flow passes.
- Outstanding risks/blockers explicitly listed.
- No simulated feature represented as working integration.

---

### 10. Documentation and handoff requirements

Create the following content, keeping authoritative rules co-located:

**Requirements**

- Confirmed decisions and their source/date.
- Role permission matrix.
- Scope changes versus old implementation.
- Business workflows: setup/enrollment, teaching publication, assessment, grading, rollover, handover.
- Glossary distinguishing subject, offering, section, enrollment, syllabus, result, and overall grade.

**Design system**

- Tokens.
- Themes.
- Responsive rules.
- Shared components.
- Navigation/route map.
- Modal versus page guidance.
- Loading/error/draft/publication states.
- Prototype references.

**Architecture**

- Runtime/dependency versions actually selected.
- Slice ownership.
- Command/query examples.
- Authentication/authorization.
- Data relationships.
- Publication and revision rules.
- Files and extraction.
- AI retrieval/prompt boundaries.

**Acceptance**

- Milestone gates.
- Runnable commands.
- Test scenarios.
- Live-provider verification record.
- Actual pass/failure evidence.

**Operations**

- Environment-variable reference.
- Fresh setup.
- Bootstrap/invite/seed.
- Backup/restore.
- File maintenance.
- Local-only hosting limitations.
- Credential and provider setup blockers.

**Decisions**

- Human-confirmed product choices.
- Engineering defaults adopted during implementation.
- Paper deviations.
- Any later human revisions.

Existing `docs/comms/DECISIONS.md` records channel exchanges. Preserve it; do not mistake every message from another agent for a new human-approved product requirement.

---

## Basis

### Human-confirmed decisions

The user explicitly selected:

- Fresh database, no migration.
- Capstone pilot.
- Complete feature set in phases.
- Assigned faculty publishes its syllabus.
- Setup command for first admin; existing admins invite more.
- Single-use invitation/email verification before first sign-in.
- Local developer-machine hosting.
- Separate institutional admin/personal faculty emails.
- Hosted AI.
- Native apps plus Docker services.
- Groq.
- DOCX/text-PDF imports; OCR deferred.
- Manual activity grading.
- Completion/submission-based daily/weekly progress.
- CSV/XLSX preview, create new students only.
- One offering per teacher with multiple sections.
- Existing configurable grade calculation.
- Closed terms with controlled reopening.
- PDF/DOCX/PPTX materials and approved links.
- English/Filipino/Taglish AI.
- Autonomous implementation through all phases.
- Announcements and issue reports.
- Configurable late submissions, blocked by default.
- Server autosave plus browser recovery.
- Simple visual editor.
- BS Entrepreneurship only.
- Multiple-choice/true-false/short-answer quizzes.
- Activity replacement before deadline, later teacher permission.
- Supported Groq model alternatives.
- Final shared requirements baseline.

### Source files

- [Updated access document](<C:/Dev/others/learnsync-v2/docs/User-Acess Updated.docx>).
- [Capstone paper](C:/Dev/others/learnsync-v2/docs/CHAPTER_1-3_CAPSTONE_post-proposal.pdf).
- [Adopted access requirements](C:/Dev/others/learnsync/docs/REWRITE_USER_ACCESS.md).
- [Current colored prototype](C:/Dev/others/learnsync/static/dashboard-prototype.html).
- [Existing palette](C:/Dev/others/learnsync/static/css/design-system.css).
- [Existing grading calculation](C:/Dev/others/learnsync/backend/academic_grading.py).

The adopted access document predates this planning round. Its “remaining specification details” are superseded where the user answered them here.

### Paper interpretation

The paper’s introduction mentions automated activity scoring, but its **Scope and Delimitation** explicitly restricts automated checking to online quizzes and requires manual activity/major-assessment grading. Follow that scope section and the user’s confirmed manual-grading decision.

The paper’s cloud-based title does not mean online deployment has been approved for this local pilot.

### Old-code references worth inspecting

- `backend/academic_grading.py`: pure grading formula.
- `backend/syllabus_document.py`: syllabus extraction patterns.
- `backend/reference_fetch.py`: protected external-reference fetching.
- `backend/routers/faculty_syllabus.py`: draft/publication validation ideas.
- `backend/routers/learning_content.py`: content placement/publication ideas.
- Existing grading, document, quiz, and deadline tests.

Review and port useful pure behavior; do not make v2 import the old application at runtime.

### Verified old pitfalls to correct

- Routes trust caller-supplied identity IDs.
- Password hashing is unsalted SHA256.
- Uploaded files are publicly mounted.
- Student quiz projection includes explanations.
- Study AI retrieval includes published quiz questions.
- Some individual scores depend on overall-grade publication.
- Corrections remove current grade publication.
- Runtime schema repair and accumulated legacy tables.
- Blocking database work inside asynchronous routes.
- “Syllabus progress” primarily represents faculty coverage, not the required daily/weekly student progress.

---

## Open questions

### Product decisions requiring another planning round

**None currently block the accepted pilot baseline.** The user accepted the shared baseline. Do not reopen settled choices merely because another architecture is possible.

The detailed table layout, packages, ports, timeouts, and retention defaults above are engineering defaults, not independently approved product facts. Record material changes to them.

### UNKNOWN external facts

| Unknown | Action |
|---|---|
| Docker daemon readiness and port availability | Check during scaffold setup; keep old services isolated. |
| Exact v2 dependency versions | Resolve compatible stable versions and commit pins/lockfiles. |
| Groq key, account model access, quota, budget | Verify explicitly; report inability to perform live acceptance. |
| Real SMTP service and institutional email/domain rules | Use Mailpit for local demonstration; document production gap. |
| Actual prospectus template | Inspect supplied source when available; retain reviewed/manual fallback. |
| Official grade-export form | Deliver labeled tabular PDF/XLSX with source/publication metadata; do not invent official branding/layout approval. |
| CI repository/hosting platform | Provide portable checks and default GitHub Actions workflow. |
| Academic/chat/audit retention policy | Preserve academic history in the pilot; do not silently purge records. Document that an institutional policy is still needed. |
| Public deployment destination and domain | Out of scope until requested. |

### Material risks and limits

- **AI correctness:** source grounding reduces unsupported answers but does not guarantee correctness.
- **Cheating:** answer-store isolation and refusal behavior cannot control outside tools or every disguised prompt.
- **PDF extraction:** scanned/complex layouts need manual review; extraction is not authoritative.
- **Short-answer checking:** accepted-string matching is intentionally limited; teacher correction remains necessary.
- **Browser recovery:** shared or compromised devices can expose local drafts; account isolation/logout cleanup matters.
- **Local email:** Mailpit proves the workflow, not real mailbox ownership.
- **Local hosting:** it is a demonstration/pilot setup, not a continuously available cloud service.
- **Historical integrity:** editing policy/content must never silently rewrite published grades or submitted assessment versions.
- **Schema scope:** implement tables by milestone, not as one untested upfront schema.
- **Scope creep:** embeddings, queues, microservices, OCR, advanced analytics, and multi-program support require demonstrated need or a new user request.

The first concrete deliverable is a documented, reproducible skeleton followed immediately by a secure invitation/login/role-access slice. Build that foundation before teaching or AI workflows.
