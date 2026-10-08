# UX rework plan: setup-first, Classroom-shaped, fewer buttons

Status: FINAL plan, approved by the user on 2026-10-08. Nothing in this document is implemented yet.
Source of the work: panel feedback ("too many buttons to press", "feels like a lot is happening", Google Classroom flow, setup takes too long, publishing has too much ceremony, files and links must look like lessons, attendance should be a students-by-dates grid, add wizards).

## 1. Decisions (all accepted)

| # | Decision |
|---|----------|
| D1 | Subject workspace follows the Google Classroom shape. Faculty: **Stream, Classwork, People, Grades**. Students: **Stream, Classwork, Grades**. Syllabus and grading policy are the top card of Classwork. Attendance and Progress live under People; Class standing and exports under Grades. Faculty also get a cross-subject **To review** page. |
| D2 | Attendance: a **grid of students by dates** (week or month) is the default on desktop; the current single-day register stays as the alternative and is the phone default. Period (Midterm/Finals) is set per date column. |
| D3 | **Files and external links are lessons**: they get a lesson page, join the sequence, "Up next" and progress, with an explicit "Mark as done". Files preview inline (PDF, images); links open in a new tab from a card. |
| D4 | Publishing: **Assign** (state-aware label), **Return N graded results**, one **pending-publication strip** for grades, a two-step **Review, Publish** for grades, and **Undo instead of confirm** for reversible actions. One consistent confirmation for anything students will see immediately. |
| D5 | **Skeleton first, details later**: a faculty subject wizard creates the whole structure at once as hidden drafts. Grading template is a suggestion that must be explicitly confirmed (the app never guesses percentages). |
| D6 | Wizards and steppers only for rare multi-step jobs: faculty subject setup, finishing a quiz, publishing grades, admin term setup. Never for daily jobs (grading, attendance). |
| D7 | Question entry accelerators: bulk paste import, duplicate quiz, copy from last semester (AI drafting stays). |
| D8 | Class **meeting days** are stored per subject so the attendance grid is pre-filled with class dates. |
| D9 | Gradebook is **read-first** with one **Edit scores** mode and a single Save. |
| D10 | **Study buddy has one door**: the owl. Its dance becomes rarer (every 3 to 5 minutes). |
| D11 | Cross-subject student To-do (built), faculty To review (new), unread dot (built), account filters (built). |
| D12 | One filled primary button per screen; long help text becomes a one-line subtitle plus an information disclosure; dashboards have three blocks. |

### What this supersedes (latest human decision wins)
- DECISIONS.md, Codex #15/#16: "the build integrates Classroom sufficiently; per-subject stream optional later". Now required (D1).
- Files and links as plain materials that cannot be completed. Now lessons (D3).
- Still in force and NOT to be built: streaks, rewards, study-time estimates, invented mastery, prerequisites or locking, adaptive paths, module-release engine, a Details/List/Table switcher for the student lesson and work lists, student-to-student comments, student-visible classmate lists. The attendance Grid/Day toggle (D2) is a data-view choice the user asked for, not that switcher.

## 2. Principles
1. One screen, one job, one primary action. One home per thing.
2. Structure before detail: the subject should look set up within minutes.
3. Confirm only what students see immediately; everything else is undoable.
4. Keep every guarantee already confirmed: immutable publications and grade snapshots, separate individual-result and overall-grade publication, server-side role and ownership checks, drafts invisible to students, AI grounding and the quiz pause, private study chats.
5. Old URLs keep working (alias or redirect) so links, bookmarks and tests survive.

## 3. Baseline and targets
Measured on 2026-10-07 with the control-count audit (visible interactive controls in the page body, dev data with many test items; the patterns are structural).

| Screen | Now | Target |
|---|---|---|
| Faculty gradebook | 67 (43 buttons) | 25 or fewer |
| Faculty assessments list | 58 | 25 or fewer |
| Faculty content list | 37 | 20 or fewer |
| Student dashboard links | 21 | 10 or fewer |
| Faculty subject tabs | 9 | 4 |
| Student subject tabs | 7 | 3 |
| Study buddy entry points | 4 | 1 (the owl) |
| Inputs to a complete-looking subject | about 250 (estimate from the forms, not timed) | about 25 and under 5 minutes |

The last row is a hypothesis until timed with real faculty (see section 6).

## 4. Phases
Each phase ends with: tsc and eslint clean, backend tests green, browser checks green (keyboard, states, sweep, new scenario), the control count re-run and recorded, evidence added to ACCEPTANCE.md, and commits split by area. No external review (Codex) unless the user asks for one.

### Phase 1: Faculty subject wizard and skeleton drafts (D5, D7 copy, D8 field)
- Frontend: wizard at `/faculty/offerings/:id/setup`, six skippable, resumable steps: start from (copy last semester, import syllabus file, template, blank), outline, grading template with live total and explicit confirmation, assessment plan (counts per period), meeting days and term dates, review and publish the syllabus. Entry from a per-subject "Get started" card and from empty states.
- Backend: `POST /teach/offerings/{id}/assessments/plan` creates up to 30 hidden draft assessments (kind, title, category and period validated against the draft policy; idempotency key; audited). `POST /teach/offerings/{id}/copy-from/{source_offering_id}` copies syllabus draft, content and assessments as drafts only (own offerings only, never attempts, scores, submissions or students). Alembic migration: `meeting_days` on offering (bitmask, default 0).
- Gate: tests for isolation, limits, drafts invisible to students, idempotency, copy excludes records; browser scenario from an empty subject to populated Classwork, gradebook columns and attendance dates in 25 inputs or fewer.

### Phase 2: Quiz and activity steppers, question entry (D6, D7)
- Quiz: Basics, Questions (AI draft, bulk paste, or add), Review and Assign, one decision per screen, Save and exit resumes (drafts already autosave). Activity and exam: one short screen each.
- Bulk paste: a documented plain-text format with a preview that shows errors by line; duplicate quiz (`POST .../assessments/{id}/duplicate` creates a draft).
- Gate: parser unit tests (valid, malformed, edge cases with line numbers), stepper accessibility (ordered list, current step, one heading per step), browser scenario creating a quiz by paste.
- After this phase: first usability session with real faculty (section 6).

### Phase 3: Grades and publication (D4, D9)
- Gradebook read-first; **Edit scores** mode with one Save (`PUT .../gradebook/scores` batch, per-cell revision checks, all or nothing, conflicts listed and nothing applied). Pending-publication strip, Review then Publish stepper, "Return N graded results", state-aware Assign label, plain wording for draft versus published. Native `confirm()` replaced by one confirmation component and Undo for reversible actions.
- Gate: existing publication and snapshot tests unchanged and green; new tests for batch conflicts; browser scenarios for edit mode and Return; gradebook at or under 25 controls.

### Phase 4: Attendance grid (D2, D8)
- Grid (students down, dates across, week or month), cell picker for P, L, A, E, date header with "Mark all present" and period, pre-filled class dates from meeting days, "Add date". Day register kept and default on phones. Saves per date through the existing endpoint, debounced, with conflict handling.
- Limits recorded: no holiday calendar in v1 (a date can be left unrecorded or hidden by not adding it).
- Gate: keyboard operation, table semantics (no `role="grid"`), conflict handling, phone fallback; tests for meeting-days authorization and validation.

### Phase 5: Classroom-shaped workspace (D1, D11)
- Tabs become Stream, Classwork, People, Grades (faculty) and Stream, Classwork, Grades (students). Classwork lists everything grouped by syllabus topic with a single "+ Create" menu (Lesson, File, Link, Quiz, Activity, Exam or teacher-scored item, Announcement). Stream is announcements plus recent posts and released results. People holds roster, Attendance and Progress. Grades holds the gradebook, class standing and exports. Gradebook and Class standing stay hidden until there is graded work.
- New faculty **To review** page: the cross-subject grading queue (reuses the dashboard queue logic).
- All old routes resolve (alias or redirect) and a route-compatibility test lists them.
- Gate: sweep and keyboard checks green; control counts at target for assessments and content.

### Phase 6: Files and links as lessons (D3)
- Backend: completion for file and link items, progress steps include them, sequence and "Up next" include them, no change to chat grounding. Inline preview endpoint for PDF and PNG and JPEG only, with `nosniff` and an explicit content-type allow-list (security review item); everything else stays a download.
- Frontend: lesson page for files (inline preview) and links (card with the site name and the teacher's note, opens in a new tab); faculty "+ Create" covers both.
- Gate: tests for idempotent completion, progress counts, authorization (including withdrawn students), inline allow-list; browser scenario.

### Phase 7: Admin stepper and assignment table (D6)
- The setup checklist becomes a stepper: term, subjects, sections, faculty, offerings, students. Teacher assignment becomes one table (subject by section to teacher). "New semester" path copies the last term.
- Backend: `POST /terms/{id}/offerings/bulk`, all or nothing with per-row errors.
- Gate: tests for bulk validation and atomicity; browser scenario from an empty install.

### Phase 8: Dashboards and single doors (D10, D12)
- Study buddy reachable only through the owl; remove the extra cards and links; dance every 3 to 5 minutes; one filled primary per screen; help text to one line plus a disclosure; faculty and student dashboards reduced to three blocks.
- Gate: control counts re-run for every screen in section 3 and recorded; full browser and accessibility sweep; fresh-install rehearsal passes.

## 5. Cross-cutting rules
- Accessibility: every new control keyboard-operable, visible focus, 44px targets, axe clean on the populated screen, no whole-page horizontal scroll, phone layouts reviewed with screenshots.
- Tests: extend the fresh-install flow and the sweep for every new route; keep `e2e:grading`.
- Docs: update DESIGN_SYSTEM.md (route map), ARCHITECTURE.md (new endpoints), OPERATIONS.md (new commands), DECISIONS.md, ACCEPTANCE.md as each phase lands.
- Schema changes only through Alembic migrations; no runtime repair.

## 6. Validation with real people (not done yet)
- Update `docs/USABILITY_SCRIPT.md` with a timed task "set up a new subject until it looks complete" and "publish the Midterm grade".
- Run with 2 to 3 faculty after Phase 2 and again after Phase 8. Record minutes, wrong turns and quotes in ACCEPTANCE.md.

## 7. Risks
| Risk | Mitigation |
|---|---|
| Large navigation change breaks links and tests | Aliases and redirects, a route-compatibility test, e2e updated in the same phase |
| Placeholder drafts clutter the lists | Clear "Draft" state, a "ready to assign" meter, filters; hidden from students and grades until published |
| Grid attendance conflicts with live roll-call | Day register kept; per-date saves with conflict handling |
| Inline file preview opens a security hole | Content-type allow-list, `nosniff`, authorized endpoint only, review before shipping |
| Batch score editing overwrites a colleague's change | Per-cell revision checks, all or nothing, conflicts listed |
| Estimates of effort are wrong | Treat the 250 and 25 input figures as hypotheses until timed |
