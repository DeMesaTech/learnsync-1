# Acceptance status

Implementation started 2026-10-06. No milestone is yet accepted.

| Milestone | Status | Evidence |
|---|---|---|
| 0 Skeleton | Passed (2026-10-06) | See evidence below |
| 1 Identity | Passed (2026-10-06) | See evidence below |
| 2 Academics | Passed (2026-10-06), with listed non-blocking gaps | See M2 entries below |
| 3 Teaching | Passed (2026-10-06), with listed non-blocking gaps | See M3 entries below |
| 4 Assessment/grading | Passed (2026-10-06), with listed non-blocking gaps | See M4 entries below |
| 5 AI/progress | Passed technically against the REAL Groq provider (live checks, grounding verification, limits measured); language-quality acceptance (a Filipino-proficient review of Filipino/Taglish answers and drafted questions) still pending | See the M5 live entry near the end |
| 6 Pilot verification | Built and rehearsed (exports, issue reports, backup/restore, fresh install + 27-check browser flow, accessibility sweep); NOT accepted while M5's real-Groq checks are blocked | See M6 entry below |

Acceptance gates are defined in IMPLEMENTATION_PLAN.md section 9. Never equate seeded examples or mocked AI with live acceptance.

## Evidence log

### 2026-10-06 (Claude takeover)
- `ruff check app tests`: pass. `pytest -q`: 7 passed (test DB migrated to head).
- Frontend: `npm run lint` clean, `npm run build` (tsc -b + vite) OK.
- Dev DB reset (downgrade base / upgrade head / seed-demo) to replace unusable `@example.test` seed accounts with `@example.com`.
- `GET /api/health` via API (8001) and via Vite proxy (5173): `{"status":"ok"}`.
- Browser: login page renders, no console errors; demo admin sign-in lands on `/admin`.
- Live flow against running stack (admin invites faculty -> Mailpit email with `#token=` fragment link -> accept -> replay rejected 422 -> faculty login 200 -> faculty `GET /accounts` 403 -> admin deactivates -> faculty session invalid -> login 401): all as expected.
- Pytest already covers reset (revokes sessions), handover (retains previous actor), last-admin guard, role denial, expired session.
- Browser: signed-in admin visiting `/faculty` and `/student` sees "Access unavailable"; signed-out visit to `/admin/accounts` redirects to `/login`; admin account list renders; faculty and student logins succeed (200).
- Email-before-commit: accepted. Send failure -> 503 and nothing created; commit failure after send leaves a dead (harmless) link, fixed by resend.
- Deferred to M6: Playwright suite, theme-before-paint check, full a11y/mobile pass.

### 2026-10-06 (Milestone 2, academic administration)
Backend (`app/features/academics`, `app/features/files`; migrations 23bd97b89037, 48885aaab658):
- 26 pytest tests pass (`test_academics.py` 10, `test_imports.py` 9, accounts 7); `ruff` clean.
- Covered: admin-only enforcement (401/403), subject code normalisation/uniqueness, assigned faculty sees offering and
  roster, enrolled student sees subject, unlinked student and other faculty see nothing (404 / empty), placement mismatch
  rejected, one active section per term (partial unique index), withdrawals kept as history and re-admission, include/exclude
  enrollment exceptions, closed term blocks writes (409 `term_closed`) and reopen needs a reason, new-year copy of
  sections+offerings without students while the closed term's history is untouched, duplicate offering / non-faculty teacher.
- Imports: student CSV/XLSX preview creates nothing; commit with any error row creates nothing (409); commit re-validates;
  invitations sent after commit; wrong extension / fake zip / empty / missing columns / non-UTF-8 rejected; uploads stored
  under generated keys outside the web root and never served statically. Prospectus: DOCX text extracted to a reviewable
  draft, edits use a revision check (stale save 409), invalid draft cannot commit and creates nothing, existing catalog
  codes are never overwritten, unreadable file falls back to manual entry.
- Bug found by tests and fixed: stored files have no extension, so parsers now read from in-memory streams; corrupt but
  zip-valid spreadsheets return 422 instead of 500.

Browser (real running stack, desktop + 375px mobile emulation):
- Created a school year through the dialog; committed an extracted prospectus draft through the review page into the
  catalog; imported students through the import page (preview showed the invalid-email row, "Import" button disabled while
  an error exists; corrected file imported 3 invited students and placed them in the section); term workspace showed the
  section (3 students) and the offering (ENT 101, Demo faculty 1, 3 enrolled).
- Faculty1 sees exactly the assigned subject and a read-only roster; faculty2 gets 404 on that offering and roster and an
  empty "My subjects"; an unrelated student gets 403 on the roster and an empty "My subjects"; student gets 403 on admin APIs.
- Mobile 375px: found and fixed page-wide horizontal overflow (absolutely positioned `.sr-only` header cell escaping the
  table wrapper); admin pages now have scrollWidth == viewport width.

### 2026-10-06 (Milestone 2 review round: bugs found and click-through)
Independent review flagged four risks; all checked:
- FIXED (real bug): committing a student import for students already in the target section returned 409
  `already_in_section` although the preview said OK. Same-section placement is now a no-op; regression test
  `test_reimporting_the_same_file_is_a_no_op` (nobody is re-invited, no duplicate placement). 27 tests pass.
- FIXED (real bug): after a failed prospectus commit the page kept stale rows, so "Fix the highlighted subjects" showed
  nothing highlighted. Verified in browser on the manual-entry path: invalid units now show "Units must be a number from
  0 to 99", nothing is created; correcting the value and committing creates the subject.
- HARDENED: Edit-offering teacher select is now controlled. Browser check: select shows the current teacher; saving
  without changes leaves the teacher unchanged.
- Student with data: added Demo student 1 to BSE 1-A in the Manage-students dialog; signing in as that student shows
  ENT 101 in My subjects. Other students/faculty see nothing (earlier entry).

Browser click-through completed on the real stack: new school year dialog; close term (confirm prompt) -> workspace read-only
(Add section / Assign / Edit disabled, banner shown, student list still viewable); reopen with reason; add section; manage
section students (search, add); assign subject; edit offering; enrollment exceptions include (shows "irregular" + reason),
remove (history kept as Withdrawn) and exclude (regular student shown Withdrawn with reason); subject add (code uppercased),
edit/archive (hidden from active list); prospectus extraction -> review -> commit; manual prospectus entry with invalid
then valid rows; student import preview with error row (Import disabled) then corrected import.

Remaining gaps (non-blocking for M3, tracked for M6):
- Prospectus extraction on a real PDF/DOCX prospectus (no sample template available; synthetic DOCX/CSV only). Manual entry works.
- The OS file picker was not used (file set programmatically on the real input; same upload code path).
- Light theme and keyboard/contrast audit of the new pages; Playwright suite; theme-before-paint check.
- The dev database now contains test data (school year 2026-2027, subjects, 6 demo + 3 invited students, one offering).

### 2026-10-06 (Milestone 2 follow-up after Codex review)
- Three policy changes implemented with tests (30 pytest tests pass, ruff clean, frontend lint/build clean): audited placement
  override, opt-in copying of offerings, faculty roster active-by-default with a history filter. API restarted on the new code.
- UI for these three changes builds and type-checks but was not click-tested in a browser (override reason field only appears after a
  `placement_mismatch` error; verified by API tests).

### 2026-10-06 (Milestone 3, teaching content and recoverable drafts)
Backend (`app/features/teaching`, files router; migration f8b2e20a48f0): 50 pytest tests pass (20 new in `test_teaching.py`),
ruff clean. Covered: assigned-faculty-only teach API (other faculty 404, student/admin 403, anonymous 401, faculty cannot
use the learn API); syllabus draft -> publish -> new draft -> publish with versions and superseded history; students never see
drafts; published stays visible while a new draft is edited; two-tab conflict returns 409 and does not overwrite; discard
draft keeps published; invalid grading policy blocks publish; duplicate outline ids rejected; syllabus import reads a DOCX
(course info, chapters/topics/weeks/activities/assessments/exam rows) and falls back to manual editing for unreadable
files (draft_exists guard); lesson HTML sanitised (script, onclick, javascript: links stripped); section targeting and
archiving; never-published items deletable, published items archive-only; file download authorisation (owner faculty before
publish, students only after publish and only if enrolled/targeted/not archived, other faculty/admin/anonymous refused,
attachment disposition, upload type and magic-byte checks); anchors protect syllabus nodes (publish blocked until items are
re-attached/archived; item publish needs the topic in the published syllabus); coverage per section, invisible to other
sections; announcements targeted, locked once published; closed terms block every faculty write but not reads and are
re-enabled by reopening; withdrawn students get 404 on all course content but keep the subject entry.
A mutation check confirmed the download test fails when the "published revision only" rule is removed.

Browser (real stack): the institution's real DOCX syllabus (EPA 2, from the old project) was imported through the real
page into an editable draft (course info, 4 outcomes, 9 chapters/exam rows with weeks, activities, assessments); autosave
showed "Unsaved changes..." then "Saved" and the edit was on the server after reload; with the network blocked the page
showed "Offline" with a retry control and kept an account-scoped browser copy; after a reload the recovery banner offered
"Restore my changes", which saved to the server and cleared the copy; a change made from "another tab" produced the
"Conflict" state with an explicit choice (server was not overwritten) and "Load the newer version" adopted it; publishing
through the Review step; a lesson created through the dialog, written in the Tiptap editor (typing, Bold, bullet list; a
pasted script/onclick/img was stripped), published; a PDF material uploaded through the real file input and published;
student sees the published syllabus (with the teacher's "Covered in class" badge), the lesson and the file, and the
download returns an attachment; announcement created, published, visible to the student; phone width (375px): student
syllabus/lessons/lesson, faculty syllabus editor (all 5 steps), content list, lesson editor, announcements all have no
horizontal overflow and editor toolbar buttons are 44px.
Bug found by browser testing and fixed: the file-upload handler read the form after an `await` (React clears
`currentTarget`), so uploads silently did nothing.

Known gaps (non-blocking, tracked):
- Imported syllabi keep the document's hard line breaks: long chapter titles and some topics arrive split across lines
  (faculty must review; the import warning says so). Only DOCX was tuned on a real template; PDF import is minimal (chapter
  headings only).
- No UI for syllabus *subsections* (the data model supports them).
- A published syllabus's grading policy is stored and shown but not yet used (Milestone 4).
- Orphaned uploaded files (replaced drafts, deleted items) are not cleaned up yet (planned maintenance command, M6).
- Light theme and keyboard/contrast audit of the new pages; Playwright suite (M6).
- Dev DB now also holds: a published syllabus v2 (imported EPA 2), a published lesson with an open draft, a PDF material, an
  announcement, one coverage mark.

### 2026-10-06 (Milestone 3 review round: blocking defects found and fixed)
An independent read of the code paths my first checks did not reach found four defects; all reproduced, fixed and re-verified.
- FIXED - student downloads 404 after a draft/republish: `may_download` picked an arbitrary revision sharing the file, so a
  published file became undownloadable as soon as the teacher opened the editor (draft shares the file) or republished.
  Reproduced by `test_download_survives_new_drafts_and_republishing` (failed 404 before the fix); now judged across all
  revisions that reference the file, and a draft-only file stays private.
- FIXED - "Restore my changes" could silently overwrite newer server work: restore ignored the base counter stored with the
  recovery copy. Browser reproduction: copy made at revision 1, server moved to revision 2 from another tab, reload, Restore.
  Now restore uses the stored base counter: the page shows the Conflict panel and the server stayed untouched.
- FIXED - `flush()` returned false while a save was in flight (false "resolve the save problem" on Publish, false leave
  prompts, stale-counter 409s on Discard). It now joins the running save. Browser check with a 3 s delayed save: status
  "Saving...", moving to Review waited for the save, no prompt or alert, server had the text, Publish succeeded (version 2).
- FIXED - autosave rejected half-finished input as "Save failed": a half-typed reference URL or an emptied grading label now
  saves as a draft and is only refused at publish (`test_reference_drafts_save_freely...`,
  `test_incomplete_grading_policy_saves_as_draft...`).
- NEW - warning before sign-out when browser-only unsaved copies exist (previously the shell deleted them silently).
Navigation cases exercised in the browser: leaving right after typing (flushes first, server has the text, no prompt);
leaving while offline (prompt appears; Cancel stays with text intact; OK leaves and the recovery banner is offered on
return); sign-out with unsaved work (prompt; "no" keeps the session and the copy; "yes" signs out and clears it).
Also added: textless/scanned PDF syllabus import falls back to manual editing (test). 53 pytest tests pass; ruff, eslint and
the typed build are clean.

### 2026-10-06 (Milestone 4, assessments and grading)
Backend (`app/features/assessments`, migration 559daccd3b81, 14 tables): 101 pytest tests pass in total (48 new across
`test_assessments.py`, `test_activities.py`, `test_grading.py`); ruff, eslint and the typed build are clean.
Covered by tests:
- Definitions: faculty-only access; quiz validation lists every problem; graded work refuses to publish without a confirmed
  policy; drafts invisible to students; two-tab draft conflict; student payloads (list, attempt, reload, submit result,
  results) contain no answer keys, explanations or accepted answers.
- Attempts: start/resume (reload returns the same attempt), answers persisted server-side, scoring of multiple choice,
  true/false and normalised short answers, totals released immediately, idempotent submit, attempt limits, highest/latest
  score rule, availability window and late policy, expired attempts finalised with saved answers, unknown questions rejected.
  REAL concurrency: 8 parallel starts -> exactly one attempt; 8 parallel submits -> scored and released once; after
  submitting, 8 parallel starts -> exactly one new attempt (mutation check: with the per-student lock disabled this test fails).
- Locking: after attempts begin, answer keys, points, attempt limit and score rule cannot change (409); wording and
  deadlines can; question identities (keys) persist across revisions.
- Corrections: audited manual correction changes the working score and flags grades, but the student keeps the released
  score until faculty release again; releases are immutable snapshots with history.
- Scores: pending (no value) vs explicit zero; score limits; revision conflicts (incl. first save at revision 0); only
  currently enrolled, targeted students; online-quiz scores can be typed in only for no-shows.
- Activities: PDF only; every version kept; free replacement before the deadline; after it only the late policy (first
  submission) or a faculty permission (reason, expiry, single use, personal); downloads limited to the owner and assigned
  teacher; a new version never changes a released result and shows "new version since grading".
- Attendance, calculation and publication: hand-computed scenario (midterm 81.00, finals 93.00, course 87.00); missing
  = pending, zero counts, zero-weight categories never block, unmarked/all-excused attendance is not a grade, transmutation,
  course grade from ROUNDED period grades (38.34 vs 38.33), publication of ready students only with reasons for the rest,
  review flags on score/attendance/assessment-setting/policy changes with the last published grade preserved, republication
  appends a new release, results and grades are released independently, students receive only grade+remark, closed terms
  block every write, simultaneous grade publications do not collide.
Review findings fixed before building the UI (each had a failing test first):
- Attempt endpoints now verify the attempt belongs to the offering in the URL (a student could previously use an open
  subject to submit into a closed term or a subject they had left).
- No-shows/abandoned attempts could never be resolved: added audited "close open attempts" (after the deadline) and score
  entry for students who never attempted; gradebook cells show not attempted / in progress / submitted.
- A grading-policy change could silently drop graded work from the calculation: syllabus publish now refuses, naming the
  assessments; "attendance" cannot be an assessment category.
- Also: per-offering lock for grade publication; scores refused for students outside the assessment audience.
Browser (real stack): policy published; a quiz built in the real builder (category, period, one question of each type,
choices, accepted answers, autosaved total 5) and published; a student opened it, answered, RELOADED mid-attempt (same
attempt, answers restored), submitted: 4.00/5.00 with " SOLE   proprietorship " accepted, total released, nothing secret in
the page; activity PDF uploaded through the real form; teacher saw the version, the download is an attachment, and the
"new version since you graded" notice; Ana (no-show) recorded as an explicit zero through the page. Gradebook: the hand
scenario shows 81.00 / 93.00 / 87.00, Ana and Cara pending with "Not attempted", "Unreleased change" labels; publishing the
midterm showed "1 published, 2 not ready" with reasons; editing the exam 40->44 through the cell dialog showed working grade
85.00 with "Published 81.00 (v1) Needs review" and the banner while the student still saw 81.00 and only the auto-released
quiz result; releasing results and republishing gave 85.00 (v2), cleared the flag, and the student then saw 85.00 and the
three released results. Phone width (375px): all new teacher and student pages have no page-wide overflow; the gradebook
scrolls inside its own labelled region.
Bug found by browser testing and fixed: the first score save for a student with no score row always reported a conflict
(new rows started at revision 1 while pages send 0). Regression test added.

Known gaps (not accepted, tracked):
- Not click-tested in a browser: the locked-after-attempts editor state, the answer-review/correction dialog, the "allow
  resubmission" dialog, the attendance page save, the "close open attempts" button, late/closed student messages, the
  withdrawn student results-only layout. Their endpoints are covered by pytest.
- No PDF/Excel grade export yet (Milestone 6); no light-theme, keyboard or contrast audit of the new pages; no Playwright suite.
- Short answers are exact-after-normalisation by design; faculty correct individual answers.
- Faculty-entered scores for an online quiz are replaced by a real attempt if the student later submits one.
- Dev DB now also holds: a published syllabus v3 with a grading policy, one quiz with an attempt, five scored assessments,
  attendance days, a published midterm grade (v2), an activity submission.

### 2026-10-06 (Milestone 4 review round 2: flagging, snapshot provenance, remaining click-through)
A second independent review read paths my first checks did not reach. Each defect below had a failing test first; 109 pytest
tests now pass (8 new), ruff/eslint/typed build clean.
- FIXED - grade review flags missed several kinds of working-data change: a second/expired/closed quiz attempt (finalize
  never flagged), and graded work published AFTER grades were out. Over-flagging fixed too: practice work (not counted toward
  the grade) no longer flags anything, and every flag is limited to the affected work's period (a midterm change no longer
  flags finals). Tests: second attempt flags the midterm only; new graded work flags only its period; practice scores flag nothing.
- FIXED - grade snapshots now carry their sources (plan section 4): per category the assessments with revision version,
  score, maximum, selected quiz attempt / activity submission id, and the attendance days with their statuses. Test publishes,
  changes a score, republishes and reads both immutable snapshots.
- FIXED - a quiz submitted after a strict deadline silently dropped the answers sent with it; the response now says so
  (`answers_ignored`) and the page explains that only previously saved answers were scored.
- FIXED - the student quiz autosave could stall in "Saving soon..." when the student typed during a save; it now saves again
  when the running save finishes.
- FIXED - duplicate category/period keys in a grading policy are refused at syllabus publish.
- FIXED - attendance marks can be returned to "not marked" (null), which makes the grade pending again.
- ADDED - test for the institution's actual shape: flat custom categories participation 15 / quizzes 10 / projects 25 /
  examination 50 with teacher-evaluated items (83.50 by hand).
- FIXED (found in the browser) - the "Attendance saved" confirmation never appeared (the register remounts after saving).
Browser click-through of the flows previously not exercised, all on the real stack: the answer-review dialog (shows the
student answer, the faculty-only accepted answers and automatic score; Save disabled until a change and a reason) and a
correction (attempt 4 -> 5, working score updated, the student kept seeing 4, the published midterm was flagged "needs review"
with the reason); "Close open attempts" (an abandoned attempt was scored from its saved answer, 2/2, with confirmation);
the locked-after-attempts editor (banner shown; add/remove controls absent; points, type, correct-answer radios and the
attempt limit disabled; wording editable) and a wording-only republish to version 2 with the SAME question keys; the withdrawn
student's results-only layout (notice, single Results tab, "View my results" entry); the "allow resubmission" dialog (reason,
default one-week expiry, "a resubmission permission is open" shown); attendance clear/restore through the page (a cleared mark
made the midterm pending with "1 attendance day(s) not marked"; restoring brought the grade back).
Remaining gaps (not accepted, tracked): late/closed student messages were not clicked through (covered by tests); no
light-theme, keyboard or contrast audit and no Playwright suite for the new pages (Milestone 6); no grade export yet (M6).
Grading defaults are NOT institution-confirmed: raw (untransmuted) scores, 50/50 period shares, passing grade 75 and late
attendance counting 0.5 are configurable defaults the faculty must confirm in the syllabus policy.

### 2026-10-06 (Milestone 5, study help, AI quiz drafts and progress)
STATUS: **built and tested against a fake provider and a development simulator; the real-Groq acceptance items are NOT done.**
There is no `GROQ_API_KEY` in this environment, so nothing here proves behaviour on a real model.

Checks run: 170 pytest tests pass (61 new for M5: chunking/extraction, retrieval allow-list with mutation checks, citations,
study chat, reference workflow, quiz generation + review gate, progress); `ruff check .`, ESLint, the typed build and the production
build are clean. Migrations `e9266f8088cb` and `d577a614444a` upgraded, downgraded and upgraded again cleanly. `ai-check` was run and fails with the safe "not set up" message.

Plan acceptance, item by item:
- Real Groq checks pass - **NOT DONE (blocked: no API key; `.env` is on `AI_PROVIDER_MODE=fake`, which must be switched to `groq` first).** `provider.complete` is unit-tested against fakes only (errors map to fixed
  safe messages, no key or body leakage). Needed from the owner: put `GROQ_API_KEY` in `.env`, set `AI_PROVIDER_MODE=groq`, run `python -m app.cli ai-check` (it sends
  English/Filipino/Taglish chat and JSON-mode requests, and refuses to pass on the simulator), then ask one question and draft one quiz.
  Also unverified: whether `openai/gpt-oss-20b` counts hidden reasoning tokens against `max_tokens` (caps are 1500 for chat and
  1500 + 300 per question for drafts, max 12000). Requests send `max_completion_tokens` and, for gpt-oss only, `reasoning_effort=low`; a reply cut off
  (`finish_reason=length`) is rejected as an unusable response and nothing is saved. Groq's page for this model did not settle the parameter
  details, so these request fields are unverified until a real `ai-check`.
- Chosen-model record - **PARTLY.** `.env` names `openai/gpt-oss-20b` for chat and quiz. `ai-check` tests exactly the CONFIGURED models and only suggests
  Llama 3.3 70B (set it in `.env`, then re-run); it has not been run against a real key, so the model choice is unverified.
- Published-source citations are usable - tested (citation validation, internal links built from retrieved rows) and clicked through in the
  browser with the simulator: the answer showed "Sources: Lesson 1 ..." linking to the lesson.
- Private/assessment content excluded from retrieval - tested, including a mutation check that fails if a draft, archived item, other offering,
  other section or assessment text could be retrieved, and that quiz questions/answers never appear in a prompt.
- Invalid AI generation stays draft - tested: ten kinds of malformed output are rejected whole and nothing is saved; provider errors save nothing;
  a term closed or a source archived DURING the provider call stops the save.
- Faculty review required after latest edits - tested and clicked through: publish disabled, review unlocks it, editing the title cancelled
  the review and disabled publish again, server refuses with 409 `review_required`, stale review is a 409 conflict.
- Progress idempotent and timezone-correct - tested: retries, expiry and faculty closing do not count, every activity version is an event but one
  step, withdrawn/closed-term refused, Manila day/week boundaries (a 23:30 UTC event lands on the next Manila day; weeks start Monday).
- English and Filipino/Taglish behaviour demonstrated - **NOT DONE (needs a real model).** Prompts ask for it and the not-covered reply is bilingual;
  the simulator only echoes source text.
- Limitations against cheating documented - `docs/AI.md`.

Browser run on the real stack with the DEVELOPMENT SIMULATOR (clearly labelled in the UI). The browser pane could not draw (screenshots timed out), so this was
driven and read through the DOM (clicks, typed values, page text, layout measurements); nobody has LOOKED at the rendered chat, bar chart or banners yet: faculty drafted a quiz from a lesson
(AI banner, per-question source line, "needs review" badge on the list), review gate behaviour above, reference text (typed, approved, a real HTTPS
fetch of a public article, publish -> 5 searchable passages), student marked a lesson complete, asked study help (cited source shown), took and
submitted the AI quiz (no sources/answer data in the attempt view), "My progress" went 1/6 -> 2/6 steps, faculty progress page showed the class
with no chat content, no horizontal overflow at 375 px on the new student and faculty pages and the generate dialog.

Defects found while building/verifying and fixed: `safe_index` raised after a failed flush (now a SAVEPOINT, regression test); the CLI did not load every
model so `reindex-chunks` crashed (it now loads them); the simulator quoted the rules instead of the lesson and failed on sources with a locator (tests added);
the generate dialog offered a corrupt PDF as a source (now only items with searchable text).

Remaining gaps (tracked, not accepted): real Groq (above); no embeddings (plain full-text, so paraphrased questions can miss a lesson; Filipino
questions over English lessons rely on shared words); scanned PDFs/images have no text (no OCR, faculty see "0 passages"); no keyboard/contrast audit
or Playwright suite for the new pages (M6); editing a published AI quiz needs a fresh review by design; chat has no streaming; no pagination of long
conversations; faculty cannot see which sources students ask about (privacy by design).
Dev DB additionally holds: a published AI-drafted practice quiz, a published reference item with approved text, one student's lesson completion,
chat messages and a submitted attempt. `.env` now sets `AI_PROVIDER_MODE=fake` (development only; `.env.example` ships `groq`).

### 2026-10-06 (Milestone 6, exports, support, pilot verification)
STATUS: **built and rehearsed; the pilot is NOT fully accepted** because Milestone 5's real-Groq checks are still blocked by the missing API key (`.env` is on the development simulator).

Checks run: 203 pytest tests pass (33 new in M6: exports 21, issue reports 6, backup/verify 6); `ruff check .`, `npm run lint`, the typed build and the production build are clean; migration `c1cc39ea1b74` (issue reports) upgraded, downgraded and upgraded again.

Plan acceptance, item by item:
- Exports match the selected offering/section/period and publication status - tested (published vs working, section filter, period, course columns, release metadata from the snapshot, mixed policy versions) and the real PDFs were opened and READ in headless Edge (published and preview, three students).
- Draft exports are visibly marked as previews - tested: a banner in the first sheet row and on every PDF page (a 150-row document was generated and every page checked), and "-PREVIEW" in the file name; the UI warns before downloading.
- Admin cannot export teaching grades - tested (403 for administrators, students, other teachers get 404, anonymous 401) and checked again in the browser flow.
- Restore preserves files and publication history - FIRST rehearsal (superseded, see the second addendum): it verified far less than stated, because the manifest covered only 4 tables. REDONE with the corrected tooling on the real dev data (518 rows in 46 tables, 44 content fingerprints, 7 files): backup refused while any v2 writer ran, then succeeded; the restored copy matched the manifest (row counts for every table, SHA-256 of every file, and a content hash of every table including grade snapshots and the audit trail); 173 sessions and 3 emailed links were revoked in the copy; a second API on the copy accepted sign-in, rejected a pre-backup session cookie, served 3 published items, downloaded the PDF at its original 125 bytes, showed the grade release and produced both exports; altering one grade snapshot in the copy made verification fail. The rehearsal database and folders were removed afterwards.
- Complete browser flow passes - `scripts/rehearse-fresh.ps1`: empty database, migrations to head, bootstrap administrator, then 27 checks in headless Edge: invitations delivered by email and accepted, structure built, a lesson written in the editor and published, a quiz authored and published, the student read the lesson, took the quiz (no answers revealed), progress 2 of 2, the teacher published the midterm grade (the student saw 100), XLSX and PDF exports downloaded and opened, the preview named as a preview, students cannot reach or export the gradebook, administrators cannot export or read it, the teacher cannot read a student's study conversations, an issue report went from student to administrator and back with a reply, and the finished pages had no axe violations or overflow. The live data was proven unchanged afterwards.
- Outstanding risks/blockers explicitly listed - below.
- No simulated feature represented as working integration - the simulator is labelled in the UI and in the status endpoint, `ai-check` refuses to pass on it, and Milestone 5 remains "live acceptance blocked".

Accessibility, theme and mobile pass (automated, Microsoft Edge): axe-core WCAG 2 A/AA on 152 page states (admin, faculty, student main pages; light and dark; 1280 px and 375 px) plus whole-page overflow and 44 px target checks, and 8 keyboard/theme checks (skip link, dialog focus trap and focus restoration, visible focus, "System" theme following the operating system live, an explicit choice overriding it). The first sweep found and I fixed: the theme selector lost its label below 640 px (critical, 38 pages), muted text on tinted badges at 4.45:1, a scrollable table region without keyboard access, and 76 undersized back/brand/download links. The final sweep: 0 violations, 0 layout problems. Visual review of screenshots (student study, progress in light and dark, phone layout, faculty gradebook with the export panel, administrator reports, the two PDFs) found no layout defects; the same review exposed that the running API had not been restarted with the new routes, which automated checks had not caught.

Remaining risks (not accepted, tracked):
- Real Groq verification and English/Filipino/Taglish behaviour (Milestone 5) - needs `GROQ_API_KEY`, `AI_PROVIDER_MODE=groq`, then `python -m app.cli ai-check`.
- The institution's official grade-export form, retention and backup schedule are unknown; exports are clearly labelled "not an official institutional form"; no off-site or scheduled backup exists (one manual command by design).
- The backup and restore scripts are PowerShell + Docker (Windows host); they were rehearsed only against the Docker Postgres used here, not a managed database or a Linux host. Restore into place (replacing the live installation) is documented but was deliberately not performed.
- The browser flow builds the school year, subject, section, offering and syllabus through the same API calls the setup pages make rather than clicking through those pages (those pages were exercised in earlier milestones); email is Mailpit only, not a real SMTP service.
- Browser coverage is Microsoft Edge (Chromium) through emulated viewports; no Firefox/Safari, no physical phone, no screen reader or user testing; axe-core catches only part of WCAG.
- Not load-tested: a real class's size, concurrent publication and large PDF exports; passwords policy, session lifetime and rate limits are the defaults chosen in Milestone 1.
- Grading defaults remain unconfirmed by the institution (raw scores, 50/50 period shares, passing 75, late attendance 0.5).
- Dev database/state: contains test data from all milestones; `.env` is on the simulator; a backup of it is in `var/backups/`.

#### Milestone 6 addendum: independent review round (same day)
An independent review of the finished milestone asked for stronger evidence and found defects my checks had not reached. All of the following were done after the entries above:
- FIXED - the restore upload-folder guard compared paths case-sensitively (Windows paths are not), so `VAR\UPLOADS\x` slipped past the "inside the live upload root" check. My first attempt to patch it silently failed and my own test then ran a real restore into a subfolder of the live upload root (plus a stray database). Both artefacts were removed, the live files and databases were re-checked (the six live upload folders unchanged; the only difference from the earlier manifest was ten new audit-log rows from later sign-ins and exports), and the guard was corrected and re-tested with mixed case, a parent folder, a deep child and `..` segments: all five refused with no side effects. The backup's "API is running" check now takes `-ApiPort` instead of assuming 8001.
- FIXED - PDF layout with many categories: names broke inside words and the table needed 6 pages. Widths are now allocated by weight (tested for 8 to 16 columns) and the stress file (7 categories, 55 rows, mixed policy versions, course period) is 3 readable pages with the preview banner on each. Known limit: a very long category heading can still wrap inside a word when there are 7 or more categories; more than about 16 columns is not supported.
- ADDED - a real clean install: the tree was copied without `.venv`, `node_modules`, `.env`, `dist` or `var`; a brand-new Python 3.12 venv installed from `requirements.txt` and `requirements-dev.txt`; `import app.main` worked; all 200 backend tests passed from that venv; `npm ci`, `npm run lint` and `npm run build` passed in the copy. A diff of the settings against `.env.example` found no required setting missing (two optional ones, `AI_MESSAGES_PER_MINUTE` and `UPLOAD_ROOT`, were undocumented and are now listed). The earlier "fresh installation" rehearsal reuses the existing venv, node_modules, `.env` and Docker volume, so it proves a fresh DATABASE and upload folder, not a fresh machine.
- ADDED - accessibility states the main sweep missed: `npm run e2e:states` audits the signed-out screens (login, forgot/reset password, accept invitation, not-found), every dialog opened from a New/Invite/Add/Draft/Create button on the admin and faculty pages (invite user, new school year, add subject, new item, draft a quiz with AI, new assessment, new announcement), and an in-progress quiz attempt, in light and dark at 1280 and 375 px: 52 checks, 0 axe violations. It found two undersized sign-in links, now fixed. Precise coverage of all browser checks: axe-core WCAG 2 A/AA, whole-page overflow and 44 px targets over 152 signed-in page states plus those 52 states; keyboard behaviour on the admin accounts page only (skip link, dialog focus trap and restoration, visible focus, live theme switching); a visual read of selected screenshots, not every page.
- DOCUMENTED - actual route map in `docs/DESIGN_SYSTEM.md` and actual dependency versions in `docs/ARCHITECTURE.md`.

Gaps found by that review and NOT closed:
- The plan's comprehensive development seed (two terms with one closed, attendance in every status, late and unsubmitted activities, released and unreleased scores, review-flagged grades, progress events, issue reports) is not built: `seed-demo` creates six accounts only, and the development database holds data created by hand and by test calls. The flow script's setup calls would be the basis of a fuller seed.
- The multi-role flow and the sweeps were not run on a clean machine; they ran against the dev machine's stack.

Repository/configuration changes made in Milestone 6 (so nothing is a surprise): ruff ignores import ordering in generated migrations; Vite reads `VITE_PORT` and `VITE_API` (defaults unchanged); ESLint has a block giving `frontend/e2e` Node and browser globals; `npm run test:e2e` now runs the keyboard and sweep checks (the earlier placeholder expected `@playwright/test`, which was removed); `bootstrap-admin` accepts `--password-env NAME` for scripted setup; new `backup-manifest`, `verify-restore` and `revoke-restored` commands; `.env.example` gained `AI_PROVIDER_MODE` and two optional settings; `.env` is on the development AI simulator. No git commits exist. `var/backups/` holds a dump of the development database including password hashes (gitignored; keep private or delete).

#### Milestone 6 second addendum: final Codex review (channel #10) and two incidents of my own
Codex reviewed the finished milestone. Its findings and what was done:
- Course export semantics: AGREED. A published Course export reproduces its own release, so its Midterm/Finals columns are labelled "(used for this Course release)" and show the values stored with that release, not newer period releases. Tested: after a midterm republication the Course row still shows the original midterm value, and the Course review flag survives until the Course grade itself is republished.
- Backup consistency: the backup now refuses while ANY v2 writer runs (an API on any port, or a maintenance command), not just port 8001 (conservative: any Python running `uvicorn app.main` or `-m app.cli`; `-AllowLive` overrides). The manifest now fingerprints the COMPLETE content of every table except sessions and one-time tokens (44 tables), so a changed snapshot, revision body, score, feedback or audit entry is detected; tested by altering each.
- Restore alias safety: the guard now resolves 8.3 short names and rejects junctions/symlinks in the target path, compares real long paths case-insensitively in both directions, and re-checks right before writing. Tested with a junction to the live root, mixed case, `..` segments and a short name.
- Keyboard: AGREED a targeted keyboard-only pass was needed. `frontend/e2e/keyboard-flows.mjs` completes, with Tab/Space/Enter/Escape and typing only: a student quiz with all three question types and submission; a faculty dialog with a validation refusal, the lesson editor, an autosave edit-conflict resolution and publish; a gradebook score editor (opens, holds focus, Escape returns focus) and reaching the publish and export controls; phone navigation; and a dialog showing a server error. 17 checks. It found one real defect, fixed: Escape did not close the open phone menu or return focus to its button. Every keyboard stop had a visible focus indicator.
- Seed: AGREED non-blocking; `seed-demo` is account-only and the comprehensive seed stays an open gap. The reproducible construction of a teaching context is `scripts/rehearse-fresh.ps1`.
- Issue reports: no privacy concern; rate-limit records are database rows keyed to the reporter and not exposed.

Two defects of my own tooling found while doing that, both disclosed here:
- The backup manifest covered only 4 tables. The command-line process only loaded some model modules, so the table counts and fingerprints silently skipped everything else, while pytest (which loads every model) could not see it. Consequently the first restore rehearsal's "counts and history match" was much weaker than I reported; the database dump and the file checksums were complete, the table-level verification was not. Fixed (all models are registered; a test runs the real command-line path in a separate process and compares with every table in the database) and the backup/restore rehearsal was repeated in full (see the corrected bullet above).
- While testing the restore guard I ran a case using an 8.3 short name (`LEARNS~1`), which Windows resolves to the OLD LearnSync v1 folder (`C:\Dev\others\learnsync`, a read-only reference). The guard behaved as designed for what it checked, but nothing forbade writing there, so a real restore copied the upload files into `learnsync\var\uploads\viashort` (and created a stray database). I removed exactly what was created (the folder after confirming it held only the six upload shards copied from this project, and its two empty parent folders `var\uploads` and `var`) and dropped the database; the old project's top level is unchanged. The scripts now have a protected-folders guard (`Assert-NotProtected`: the sibling `learnsync` folder plus anything in `PROTECTED_PATHS` in `.env`) used by restore, backup and the rehearsal, and the same case is now refused. An earlier, similar slip (a guard patch that silently did not apply, so a test restore ran into a subfolder of the live upload root) was cleaned up the same way and is described in the first addendum.

Final verification on the final code: 203 backend tests pass; `ruff`, `npm run lint`, the typed build and the production build are clean; the accessibility sweeps (152 signed-in states, 52 states of dialogs, signed-out screens and a quiz attempt) report 0 violations and 0 layout problems; keyboard checks 8/8 and 17/17; the fresh-installation rehearsal passes 27/27 and proves the live data unchanged. Pilot acceptance still waits on Milestone 5's real Groq checks.

#### Design gap found by the user after Milestone 6 (not previously recorded)
The plan (section 5) names the prototype's Variant A as the layout baseline, with Google Classroom and Brilliant as inspiration. I applied its palette, tokens, theming and general restraint, but I did NOT build its layout: the prototype has a dark navy sidebar, a student dashboard (daily progress strip, "pick up where you left off", course updates, next milestone, study-assistant card) and a to-do page. The built home pages (`/admin`, `/faculty`, `/student`) are bare placeholders with one button, "My subjects" is a plain card list, and there is no cross-subject to-do or progress dashboard. I never compared the finished screens with the prototype before reporting the milestones, so earlier "design system" statements overstated the match. Open work: role dashboards, a student to-do, the "next step" prompt, and styling the subject cards like the prototype.

#### Design-completion gate (Milestone 6), run after the user's question and Codex's ruling (channel #11)
Codex ruled that following Variant A is a REQUIRED completion of the agreed design, with a gate: compare the three dashboards and representative pages with the prototype in light, dark, system, desktop and phone; exercise links, back/cancel and empty/loading/error states; accessibility and keyboard checks on changed screens; verify counts against real authorised records; no demo-only claims in screenshots. This is what was built and checked.

Built:
- Navy sidebar in the prototype's treatment (grouped navigation with icon plus visible text, current-location marker, its own focus colour so keyboard focus stays visible on navy), logo mark, institution tag, name and role with an initials avatar. In dark mode the sidebar is a darker navy; on phones it is the existing hamburger menu (Escape closes it).
- Role dashboards at `/student`, `/faculty`, `/admin`, backed by `GET /api/dashboard/{student,faculty,admin}`:
  - Student: greeting, "Learning activity this week" (Monday to Sunday from VALID events only, no streak or study-time language), counters for today, a "Your next step" card (the first incomplete applicable published lesson, otherwise the nearest to-do), subject cards with progress bars, To do, "Awaiting feedback", "Another attempt available", Course updates (published announcements, newly published materials, the student's own released results and published grades from the last 30 days) and a Study help card.
  - Faculty: "Your next teaching task" (submissions to grade, else grades needing review, else drafts), a counts strip, subject cards with workflow links, upcoming deadlines, per-subject progress summary (class average, quiet students; labelled "not a grade").
  - Admin: academic-management shortcuts, "needs your attention" (open reports, then invitations not accepted, then unconfirmed imports), counts, open terms, recent account changes (sign-ins excluded), reports shortcut.
- Subject cards in the prototype's style on both "My subjects" pages (code, term badge, progress bar, quick links, Open).
- Rules enforced server-side and tested (11 tests): per-offering authorisation (section targeting, enrolment, published only), nothing from withdrawn enrolments or closed terms, a submitted quiz with attempts left is "Another attempt available" rather than unfinished, submitted work with no released result is "Awaiting feedback", opening a lesson changes nothing, drafts/unreleased scores/other sections/other students never appear, the faculty dashboard counts only the teacher's own offerings and never includes study conversations, the admin dashboard contains no grade/score/submission/draft/conversation data.
- Defects found while checking and fixed: the header theme selector did not save to the account, so a saved preference silently undid it on the next load (found by reading the code against Codex's review target; now covered by a check); greeting used the last word of the name ("Good evening, 1."); admin activity was dominated by sign-ins; phone header wrapping and week-tile overflow; the dashboard grid overflowed the page on phones (its columns grew to fit a table); undersized links on the new cards.

Compared with Variant A, deliberately NOT copied: the demo role/variant switcher; "18 min study time"; pre-filled ticks for past days (ours show only real events); a separate To-do page and separate Daily/Weekly/Assessment-results sidebar entries (Codex: optional; the dashboard To-do list and the per-subject Progress and Results tabs cover them); the horizontal phone nav strip (we keep the accessible hamburger); the prototype's sample names and figures. Wording differs in places ("Your next step" rather than "Pick up where you left off", because we cannot claim a reading position).

Checks (final code): 214 backend tests pass; ruff, ESLint, typed build clean; axe-core sweep of 152 signed-in page states (including the three new dashboards, light/dark, 1280 and 375 px) 0 violations and 0 layout problems; 52 states (signed-out screens, dialogs, quiz attempt) 0 problems; keyboard checks 11/11 (theme persistence after reload and sign-out/Back included) and keyboard-only workflows 20/20 (dashboards included); screenshots of the three dashboards, the subject lists, dark mode and the phone layout were read and compared with the prototype's student, faculty and admin screens. Codex's other review targets: modal-versus-page rules (short forms use dialogs; syllabus, content, quiz editor, gradebook and imports use pages) and the table scroll regions were consistent with what I could see; logout clears the query cache and the hard navigation leaves nothing for Back. I did not do a line-by-line audit of every page against section 5.

Not done / open: the comparison is by eye against screenshots, not pixel-measured; real classroom-sized data was not used (the dev database holds a handful of students); the dashboards were not exercised on a physical phone; Real Groq verification (Milestone 5) is still the pilot blocker.

Final fresh-installation rehearsal on this code: 27/27 checks, live data proven unchanged. The "Design gap" entry above is resolved by this gate, apart from the open items listed here.

#### Design gate: Codex post-build review (channel #12) and closure
Codex found no missing required element and no design blocker, with two changes, both applied:
- Faculty progress wording: "N students quiet this week" became "N enrolled students with no recorded learning activity in the last 7 days", with the explanation that it counts lesson completions and submissions only (not attendance, effort or risk, and not a grade); the page intro no longer says who "may need a nudge". The "average" is now labelled "Average completion" and defined as the mean of each student's completed steps out of the steps that apply to them (students with no applicable steps are left out).
- Student fallback: when all lessons are done the card says "Your next task" and shows the nearest to-do; when nothing remains it says "You're up to date" with links to the subjects and Study help.
Codex's confirmations to keep true: following a link re-checks authorisation on the server (the dashboard only lists links; the pages enforce access, and the query cache is cleared on sign-out); updates are titles only for the student's own records; admin activity shows actor label, action and time with no emails or tokens; short forms are native dialogs, long editors and the gradebook are pages with back links, draft/published state is explicit ("Published v1 · editing draft"), and wide tables scroll inside their own region (all already covered by the checks above).
Re-run after these changes: both accessibility sweeps (0 violations, 0 layout problems), keyboard checks 11/11 and 20/20, and the fresh-installation rehearsal 27/27 with the live data unchanged. The design-completion gate is closed. Pilot acceptance still waits on Milestone 5's real Groq checks.

#### Milestone 5 live Groq verification (the user added `GROQ_API_KEY`; `.env` now has `AI_PROVIDER_MODE=groq`)
STATUS: the real provider path now WORKS and was exercised end to end through the app; acceptance is still NOT complete (limits below). Model in use: `openai/gpt-oss-20b` for chat and quiz drafting (chosen model recorded; Llama 3.3 70B was not tried).

Executed against the real provider:
- `python -m app.cli ai-check`: 11 models listed; English, Filipino and Taglish chat replies and a JSON-mode request all succeeded with the app's own request code (`max_completion_tokens`, `reasoning_effort=low` accepted).
- Study questions through the real endpoints as a student (English, Filipino, mixed Filipino/English), an off-topic question, a prompt-injection attempt, a request for quiz answers, and a question the materials barely cover.
- Quiz drafting through the real endpoint as faculty from a lesson and a fetched web article; the draft saved unpublished, `ai_generated`, review required before publishing (409 `review_required` confirmed).
- Provider headers read: this key's limit for the model is 8,000 tokens per minute and 1,000 requests per day.

What the real model did that the simulator and fakes never could, and what was done (all with tests):
1. NOT GROUNDED. It explained topics from general knowledge that the materials do not contain, wrote tags as "[ S1 ]" or omitted them (so every "cited" flag was false), and once attached a FALSE [S1] to an outside-knowledge explanation. Fixes: a strict prompt; tolerant tag reading; replies must be JSON with a verbatim quote for every cited source and each quote is checked to literally appear in that source (an invented quote or tag makes the reply untrusted); a second small, temperature-0 call checks that the cited passages state everything the answer says (false or unparseable = not shown); an unverifiable reply gets one repair attempt and otherwise the student sees the honest bilingual "not found in your published materials". Students see "Where this came from" with the verified quotes. After the change the real model answered the on-topic questions with short, quoted, cited answers and refused the off-topic, injection, quiz-answer and barely-covered questions; one borderline case (break-even analysis, which the article mentions only in passing) was answered in one run and refused in another. This is a strong mitigation, not a guarantee: the assistant's wording around a verified quote can still be wrong.
2. PROVIDER LIMIT. 8,000 tokens a minute means only two or three study questions a minute fit school-wide, and quiz drafting and chat collided (the app showed the safe "busy" message). Token use was cut (5 chunks / 8,000 characters of sources, 4 history messages, smaller output caps). A class cannot be served by this tier; see the risks below.
3. WRONG LANGUAGE. One quiz draft came back in French from English sources. Faculty now choose the quiz language (Same as the materials, English, Filipino, Taglish) and the prompt states it; 0 of 3 later drafts were non-English (one observation before, three after: not proof).
4. Groq returns HTTP 400 `json_validate_failed` when its JSON mode produces malformed JSON; it was mislabelled "model unavailable". It is now a bad reply that gets the repair attempt.
5. Study help stayed paused forever because of an unfinished attempt on an ARCHIVED quiz. An attempt now pauses study help only while the quiz is published, not archived and not past a strict deadline.

NOT DONE / unverified: judgement of the Filipino and Taglish answers and drafted questions by a fluent reader (I can only judge English); a load test; behaviour on Llama 3.3 70B; a paid tier; more than a handful of questions per scenario (these are samples, not a measured accuracy); one `quiz_in_progress` refusal during a live run that I could not explain or reproduce.

Codex review of these findings (channel #14), and what was done:
- The grounding design ((b) quotes + (c) support check) is acceptable for the pilot on conditions, all applied: the support check now says explicitly that a source which merely mentions a term does not support a definition, formula, steps or example (and `ai-check` runs that exact trap against the real model: it passed); the docs state the residual risks (docs/AI.md: a quote proves a passage exists, not that it supports every claim; the same-model verifier can be wrong; retrieval can miss material; language needs human review; assessment isolation cannot stop outside tools). Codex's blocker, which still applies: an answer that materially exceeds its evidence presented as verified.
- Distinct friendly messages: missing evidence ("I couldn't find enough information in your published materials"), a request for assessment answers (a friendly decline that offers a separate practice example), and an unverifiable or malformed reply ("I couldn't produce a reliably supported answer"); prompt injection gets the ordinary subject-scope response.
- A shared provider cooldown: after a 429 the provider's own retry-after (bounded 1 to 60 s, default 20 s) pauses every request in the process; a rate limit is never repaired or retried as bad content; the student's question is kept (tested). Limits are documented as observed for this account and model; a paid tier is not a mandatory pilot feature and whether it would give whole-class capacity is unknown.
- Quiz language: the selection is saved with the draft (new column `ai_language`, migration e67a8c8e4e4a upgraded, downgraded and upgraded) and with the generation record; the review screen shows it and reminds faculty to check the language; wrong-language drafts stay unpublished and can be discarded and regenerated.
- Closing checks Codex listed: `ai-check` now exercises the final pipeline (7 probes, all passed against the real model with the reduced budgets, including the verifier on its own and quiz validation); `json_validate_failed` is a bad reply (repair, nothing saved); a lesson archived while the provider is thinking is never cited (tested); the study pause at the archive and deadline boundaries (archived, strict deadline passed, late work still accepted) is tested; truncated replies are rejected for chat and quiz (tested at the provider level and for drafting); the Filipino-proficient review of a small English/Filipino/Taglish sample is STILL PENDING and is the remaining condition for claiming language-quality acceptance. Technical integration can be reported as verified while that review is pending.
- Open (Codex, unknown): the verifier's false-acceptance rate and multi-call capacity were not measured.
Pilot acceptance now waits on that language review (and the institution's confirmations listed earlier), not on provider access.

#### Flow versus the mockup (the user asked; Codex reviewed, channel #13)
Codex compared the prototype's page-by-page journeys for all three roles with the built routes. Verdict: the built flow follows the intended journeys; keeping teaching work inside each subject (tabs and card shortcuts) instead of one sidebar entry per subject screen is permitted by plan section 5 and was judged an acceptable consolidation; the dashboard's direct links keep the prototype's shortest daily paths. Separate sidebar entries for To-do, My grades, Study assistant, Daily/Weekly progress, Assessment results, Teacher assignments, Students, Examination records, Student progress, Grading, Assessments and a Help page are OPTIONAL (not twelve extra destinations merely to mirror the prototype). DO NOT BUILD: fake study time, pre-completed days, canned chat, role switchers, historical mapping, report attachments, section-code approval flows.
Three REQUIRED changes, all done:
1. Back/Cancel return to where the user came from (the dashboard, a term workspace, the assessments list), with a parent fallback for direct links; never an unconditional history jump. A reload keeps its place. Implemented for lessons, work items and attempts, the grading page and rosters, and the dashboard and subject cards pass their origin along.
2. The student syllabus links each chapter/topic to its published lessons and materials.
3. "Results" is now "Grades & results" with the headings "Published grades" and "Released assessment results".
OPTIONAL items left for later: next-lesson and My-work links after completing a lesson, a "Create assessment" shortcut from content, an assessment-type filter, and the labels "Chapters & topics" (for "Coverage") and "Assign teacher & sections".
Checks: 14 flow checks on the dev stack (dashboard to lesson/work and back, faculty dashboard to grading and back, term workspace to roster and back, direct-link fallbacks, phone width 44px, Enter on Back) and the fresh-installation flow extended to 29 checks (the dashboard next step and a syllabus topic linking to its lesson, each with its Back). Two script mistakes of mine were found while writing them: a reload deliberately keeps its history state, and the sign-in limiter allows only five attempts a minute.
Also noticed while verifying: someone else was using the dev application during one of my rehearsals (live audit rows by "Demo faculty 1" fetching an electric-current article that no script of mine touches), which made the "live data unchanged" proof fail once; the fresh stack left no accounts or events in the live database, and a re-run in a quiet moment passed (29/29, live data unchanged).

#### Learning flow, dialogs, paging and study-chat deletion (user request; Codex rulings #15 and #16)
The user found the student Lessons and My work pages overwhelming (flat cards, no sequence, no done status, "which quiz now?") and asked about modals, paging and deleting AI chats. Codex ruled the fix is STRUCTURE, not a view switcher (not built), and required the items below as an extension of the design gate, not a new milestone.

Built and checked:
1. Lessons & materials (student): grouped under the published syllabus chapter/topic in syllabus order, then the faculty-set order inside the topic, unattached items under "Other materials"; each lesson shows "Completed" or "Not marked complete" (files and links are resources and get no completion chip); an "Up next" marker, a "Continue" button, "N of M lessons marked complete", "Next lesson: …" after marking complete and "All published lessons completed" with a link to My work at the end. One ordering function (`ordered_published`) feeds the list, the dashboard "next step" (via progress steps) and the Next link, so they cannot disagree.
2. Faculty Content: the same grouping, Up/Down buttons per item (announced in a live region, disabled in a closed term), states "Draft", "Published vN", "Published vN with newer draft", "Archived", and a title search. Order is stored per item (`learning_item.position`, migration `cb4f92b46a0b`, existing items numbered by creation time per subject); reorder is `PUT /api/teach/offerings/{id}/items-order` for one group and refuses a stale list (409).
3. My work (student): server-computed `bucket` per item (To do, Another attempt available, Upcoming, Submitted·awaiting feedback, Completed, Closed), sorted earliest deadline first with no-deadline last (Upcoming by opening time), an "Up next" marker on the nearest to-do, "Late submission allowed" only when late answers still count, attempts used/left shown, a submitted activity keeps "Submitted" until feedback is released (never a zero). The dashboard To do / Awaiting / Another attempt lists now read the same bucket.
4. Faculty Assessments: a searchable list with a type and status filter showing type, syllabus placement, audience, grading category, availability and deadline and publication state. Individual publish per assessment is kept (Codex: sufficient; no bulk/scheduled publish, no "Coming soon", no prerequisites or locking).
5. Report a problem is a dialog; the dialog component now asks before Escape or × throws away typed text; the dialog stays open with the typed text after a server error; focus returns to the opener.
6. Admin reports: server-side paging (default 25, max 100) with status, type and text filters and a total, replacing the silent 200 cap. Study conversations and messages page newest-first ("Load more chats", "Load earlier messages"); announcements ("Load more announcements"). Gradebook: find-a-student, section and period filters, sticky header and contained scrolling (filters only change the view, Publish still acts on every ready student). Subject catalog and faculty content/assessments: client-side search (these are bounded lists; Codex accepted client filtering for bounded lists, I did not build server search for the catalog).
7. Study chats: a student can delete a whole conversation (own only; messages and saved sources are hard-deleted; the audit keeps the count, never the text). Withdrawn students and closed terms can still read and delete their own history but cannot ask; the withdrawn tab bar now shows "Study help history". The page explains how chats are handled (private within LearnSync, text sent to the provider, answers can be wrong, no effect on progress or grades, backups may keep copies until they expire).

Checks actually run: backend 235 tests pass (new: ordering/reorder/completion/next-lesson, paging and filters of reports, conversation deletion and withdrawn access, conversation/message paging); ruff clean; tsc, eslint (0 warnings) and production build clean; accessibility sweep 152 pages 0 violations and 0 layout problems (it first found 21px link targets in the new lists, fixed); state sweep 52 pages 0 problems; keyboard 11/11; keyboard-flows 21/21 (the Escape test was rewritten for the discard prompt); flows-back 12/12; the fresh-installation rehearsal 37/37 (new: second lesson, grouping and chips, Up next, reorder by button, student sees the new order, Next lesson, My work Completed, deleting a chat) and the live installation proven untouched afterwards.

Not done / known limits: no drag-and-drop (Up/Down buttons only; Codex: optional); Order is by item, not by revision, so a reorder takes effect for students immediately (Codex preferred revision-level storage so draft ordering cannot change the published sequence; I judged a reorder to be a teaching-order decision, not content, and it is audited; say if you want it per revision); the standalone file-replace form stays inline in the editor (it is part of the editor); my own list of reports is not paged (limited to 10 new reports an hour); server-side catalog search was not built; no automatic expiry of study chats (no retention policy was confirmed); deactivating an account does not delete its chats. A Codex post-build review of this work is recorded in DECISIONS.md.

Codex post-build review of the above (channel #17) found six real defects; all fixed and re-tested:
1. Reorder only compared the SET of items, so a second tab with an old order could overwrite a newer one. The request now carries the order the editor was looking at (`expected_ids`), the group is locked while it is compared, and any difference returns 409 (tested: stale order, non-permutation, foreign list).
2. Faculty grouping used `published ?? draft` anchors per field, so an item published as unattached but with a draft topic was grouped differently from the server. Both now take the anchor of the revision students see, else the draft (tested).
3. The last lesson said "All published lessons completed" even if earlier lessons were not done. The API now returns `all_completed` and `first_incomplete`; the page says "End of the lesson sequence" and offers the first unfinished lesson (tested).
4. Announcement "Load more" grew a `limit` past the API cap of 200. Announcements, and the reporter's own reports, now use bounded pages (`limit` max 100, `offset`, `has_more`); tested with more rows than a page.
5. Chat paging used a bare timestamp and skipped rows that tie. Conversations and messages now use an opaque `timestamp~[role~]id` cursor matching the full sort order; tested with every row at the same instant.
6. My own reports are paged.
Wording: the Content page now says reordering takes effect for students immediately and edits stay drafts; the disabled reorder in "Other materials" is explained with a link to the item; Publish grades states that it covers all ready students across all sections regardless of table filters.
Codex accepted: item-level order (a live, audited teaching-order action), client-side catalog/content/assessment search for pilot sizes (it is NOT bounded by design: larger histories need server paging), no drag-and-drop, the inline file replace, and no chat expiry.
Re-checks: backend 237 pass; fresh rehearsal 41/41, including 42 lessons (student list answered in about 0.4 s), no sideways scroll and 44px targets at 375px for the student and faculty lists, and the content search; I also looked at the phone screenshots. Observation: with 42 lessons the phone page is very long (about 7,000 px); groups are not collapsible, which I left alone.

#### Per-student standing page for faculty (user request; Codex #18)
Students often ask a teacher where they stand. Faculty can open one student's standing in one subject from the roster, the progress table or the gradebook ("Open full standing"): `/faculty/offerings/{id}/students/{studentId}`, API `GET /api/teach/offerings/{id}/students/{studentId}/standing` (assigned faculty only; the student must have an enrolment record in that subject, else 404). Read-only and assembled from the authoritative calculations (the gradebook row, attendance marks, progress steps), so it cannot disagree with them. Codex agreed with the scope and required the working/released separation below.
Shows: header (name, number, section, enrolment status, withdrawn and closed-term notices); per period "Current calculation" (may include unreleased scores) apart from "Visible to student" (last published grade and release number, needs-review flag) with a per-category breakdown; every applicable assessment with due date, hand-in status, working score, released score and a "differs" flag, practice work marked "Not counted toward grade"; historical work (archived or no longer shown) with a retained score or release; attendance totals per period and a day-by-day list; learning progress (steps, last valid activity). Not shown: any study-chat content or counts, projections, "points needed to pass", other subjects. A withdrawn student shows only the published grades, released results and marked attendance days, with a note that no working grade is calculated.
Checks run: backend 238 tests pass (new: standing equals the gradebook row; working vs released; submitted status; another faculty, administrator, student and an unrelated student are refused; another offering is 404; a withdrawn student keeps a readable record with no invented working grade); axe 0 violations and no overflow or small targets at 1280 and 375 px in light and dark (looked at the screenshot); the fresh rehearsal (45 checks) opens the page from the roster, checks the headings, that Back returns to the roster, and that a student and an administrator are refused.
Not done / limits: no printable or PDF export of one student (Codex: optional; class exports exist); read access is not audited (Codex agreed for the pilot, consistent with the gradebook); the whole class is computed to show one student (fine for a class, not for thousands); a keyboard-only walkthrough of this page was not run separately.

#### Class standing tab, ranking and the moved export (user request; Codex #19); Study help chat redesign
1. **Class standing** is a new faculty tab. It lists the ENROLLED students of the subject with Rank, Student, Section, the per-criterion values, Grade, Remark and Status for one chosen period, ranked within all sections of the subject or within one section. The basis is Published grades (default, what students can see) or a Working preview (marked as unpublished). One basis is ranked at a time, never mixed. Ranking is standard competition ranking on the two-decimal grade (1, 2, 2, 4); a student with no published or complete grade is listed UNRANKED ("N ranked · M awaiting publication"), which is different from a grade of zero (a zero is ranked). Search filters the displayed rows only and never changes a rank. Remarks come from the release (published) or the current confirmed policy (working); releases made under different policy versions are ranked as recorded, with a note. Optional summary: average, highest, lowest and passed, each over the ranked students. Ranks are faculty-only (the endpoint refuses students and administrators) and appear nowhere else: not in student APIs, the student dashboard or the AI.
2. **Export grades moved** from the Gradebook to Class standing and uses the page's own period, section and basis ("what you see is what you download"), the whole selected scope whatever the search box shows, and a Rank column. The PDF keeps the red preview banner on every page and the Excel sheet its banner. The export file records how the rank was made ("Rank within [scope], based on [period] [basis]. N students ranked; M unranked. Ties use competition ranking"). The rank is computed by one function (`exports/tables.add_rank`) used by both the page and the files, so they cannot disagree. The older un-ranked export (no `rank` flag) is unchanged for API callers.
3. **Study help** now looks like a chat: a conversation list beside the chat, your messages as bubbles on the right, a header with the conversation title and a clearly visible red "Delete conversation" button (with the same confirmation dialog), a message area that scrolls and keeps the newest message in view, a composer under it (Enter sends, Shift+Enter adds a line, a counter and a "Focus on" lesson picker), starter questions on an empty chat, an animated thinking indicator that respects reduced motion, and a one-line privacy note that expands. On phones the list stacks above the chat.
Checks: new backend tests for ranks with ties, unranked versus zero, section scope, the export agreeing with the page, and refusal of students, administrators and other teachers; browser checks at 1280 and 375 px in light and dark showed 0 accessibility violations and no small targets on Class standing and Study help; the fresh rehearsal and sweeps are recorded below in the final gate line.
Not done: the Rank column is not offered on the old Gradebook export link; rank both within section and class at once is not shown (Codex: optional); no percentile, curve, honours or student leaderboard (Codex: do not build).

#### Friendly study help (user request; Codex #20)
Greetings, thanks and "what can you do" get a warm reply with no provider call and lesson buttons; non-answers keep their honest meaning but are friendlier and end with related or next lessons, labelled differently ("Related lessons you could explore" versus "Your next published lessons"). New backend tests: English and Filipino greetings, thanks and help produce a reply with no provider or support-check call; "Hi, give me the quiz answers" is not small talk; a retried greeting produces one reply; an unanswerable question still returns the honest non-answer with suggestions that exclude drafts and archived lessons. Migration `dd341f0c7da5` adds `study_message.suggestions` (existing rows default to none). Browser-checked on dev data (greeting and an off-topic question): 0 accessibility violations, no small targets. Not changed: grounded answers, the verification pipeline, the assessment-answer refusal. Not built (Codex: optional): a general intent classifier for off-topic chit-chat; unusual greetings or longer small talk go through normal retrieval and get the friendly non-answer with suggestions. Filipino wording of the new messages has not been reviewed by a fluent reader (same pending review as the rest of the Filipino output).

#### Lesson helpers: simplify, summarize, example, analogy (user request; Codex #21)
The starter chips ("Explain the first lesson in simple words") failed because their text was searched as keywords. They are now four action buttons (Explain simply, Summarize, Give an example, Everyday analogy) on one lesson: the one chosen under "Focus on", else the student's next lesson. The API takes an allow-listed `action` plus `selected_item_id`; the server validates the lesson (published, targeted, not archived, this subject), builds the message from its title, retrieves only that lesson's passages and sends no history. Grounding, the support check, rate limits, the active-quiz pause, withdrawn and closed-term blocks and retry idempotency are unchanged. The analogy is stored apart from sources (`study_message.analogy`, migration `0ddf61490d8e`), shown in a separate box labelled "Everyday analogy: illustrative, not from the lesson", and only when the explanation passed grounding and the same verification call judged it faithful; otherwise it is omitted with a plain note. Checks run: backend tests for the actions (the message built from the title, only the chosen lesson's text in the prompt, no history, a missing lesson or a draft, archived or unknown item rejected, no invented example, retry identity, an analogy accepted only when both checks pass, rejected for digits, tags, links or a negative verdict, never shown when grounding fails) plus the whole study suite; live checks on the real model; axe 0 violations. Honest limits: the analogy check is the same model; a model may call a restatement an "example"; samples are small; Filipino and Taglish output is still pending fluent review.

#### Dashboard UX pass (user request: more features / better flow; shortlist items 1-3)
Done 2026-10-07 (Claude; NOT yet reviewed by Codex).
- Student dashboard: "Your next step" now precedes the weekly strip; the strip had no CSS and rendered as a numbered list on phones, now a 7-day grid.
- Faculty dashboard: "Submissions to grade" / "Grades to review" tiles link to the list; new "Needs grading" card (top 5 activities by waiting submissions, deep-linked to scores); the next-task icon is no longer a check mark for drafts/grading (`icon` in the task payload).
- Admin dashboard: "Get started" checklist derived from existing records (term, subjects, sections, offerings, students, non-admin accounts); empty once all steps are done.
- Checks run: `pytest` 245 passed (new assertions for queue/review_link/icon and a unit test of `setup_steps`); `tsc`, eslint clean; `npm run test:e2e`: keyboard 21/21, states 52 checked/0 problems, sweep 156 pages 0 layout problems. The sweep first found one contrast failure caused by my `opacity` on future days; fixed and re-run clean.
- Seen in screenshots: student phone and faculty desktop (light). The admin checklist was viewed ONLY with a mocked API response (the seeded admin has every step done), and the "Needs grading" card was not seen rendered (seed has nothing waiting); both rest on tests.
- Not done: shortlist items 4-8, empty-install and invitation-acceptance walkthroughs, real-user walkthrough.

#### Empty-install walkthrough (same pass; throwaway database `learnsync_walk`, API 8004, web 5175, since dropped)
- Fresh database + bootstrap admin only. Viewed at 1280 and 375: dashboard, school years, subject catalog, prospectus import, accounts. Empty states are clear and each names its next action; the "Get started" checklist renders from real data.
- Defect found in my own checklist and fixed: it ordered "assign teachers" before "invite faculty", but creating an offering requires an existing faculty account (`commands.py` `account_with_role`). New order: term, subjects, sections, faculty, offerings, students (student import sends the invitations). Unit test and dashboard tests updated; 12 dashboard tests pass. Full suite and sweep were NOT re-run after this reorder.
- Friction seen, not changed: the "New school year" dialog has 7 empty date fields (year + two semesters, no defaults) and offers "Copy sections from" even when no earlier year exists.
- Not walked: invitation acceptance by a new user (needs Mailpit link), term workspace, student import.

#### Dashboard UX pass, part 2: school-year dialog, invitation flow, first-run walkthrough (2026-10-07, Claude)
- School-year dialog: entering the year's start/end prefills any EMPTY semester dates (split at the midpoint; edits are never overwritten) and "Copy sections from" is hidden when no earlier term exists. Checked in the browser against the live app without submitting.
- Invitation flow walked on a throwaway database (invite by admin, Mailpit email, accept page, sign in as the new faculty; database dropped afterwards). Defects fixed: the accept/reset page showed no password rule (only a browser tooltip) and, after saving, stayed on the same form with the button live. Now: "At least 12 characters." is shown, and success goes to the sign-in page with "Your account is ready." Verified end to end for three invitees. Checklist order corrected earlier (faculty before offerings).
- Checks after all changes: pytest 245 passed; tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; accessibility sweep 156 pages, 0 violations, 0 layout problems.
- Seen but NOT changed: invitation email subject is the raw "LearnSync: invite"; creating a school year opens BOTH semesters as "open" at once; on an empty term the primary button is "Assign a subject" although sections come first; password-reset page (the other user of the same form) was not exercised in a browser.
- Not done: Codex review of this pass; walk of student import; walk with real users; shortlist items 4-8.

#### Dashboard UX pass: Codex review (channel #22) and follow-up (2026-10-07, Claude)
- Codex found no permission/privacy problem in the admin or faculty dashboards and agreed with the checklist order and the redirect after accept/reset. It judged several labels and the checklist's "done" logic to overstate. Applied:
  - Faculty labels: "Assigned subjects in open terms", "Subject enrollments" (the number sums per-subject enrollments, not distinct people), "Students with grades to review" (it counts students), "Activity submissions to grade", card "Activity submissions needing grading / Top 5 by number awaiting grading", and the next-task headline wording.
  - Checklist: faculty step counts active or invited faculty only; subjects step counts active subjects only; sections/offerings/students are judged in ONE term (the first open term), matching the link they open; last step reads "Enroll students". A unit test pins the single-term rule.
  - School years page now says an "open" term is editable and its dates show the academic period (Codex: not a defect that both semesters open; no lifecycle change needed).
- Reset-password in a browser on a throwaway database (since dropped): emailed link -> new password -> sign in with the new password OK; old password rejected; replaying the link rejected ("invalid or expired"); a session opened before the reset was revoked. NOT checked: opening a link while another account is signed in; reopening a second token link inside the same page instance.
- After these changes: pytest 245 passed; tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; sweep 0 violations, 0 layout problems.
- Open for a human decision: Codex says the year-copy option that copies teacher assignments ("review the teachers afterwards") may conflict with a fresh-association rollover rule. DECISIONS.md (M2 defaults) records "New-year setup copies sections and offerings only"; I found no later decision overruling it, so I did not change it.
- Codex's ordering for the unbuilt items: walk student import and a faculty grading queue with real pending submissions first; accounts filters only for a demonstrated task; cross-subject To-do optional; unread dot deferred (it introduces read-state semantics); remove only confusing admin duplicates.

#### Walk of the faculty grading queue and student import (2026-10-07, Claude; throwaway database, since dropped)
- Setup through the API and UI: demo accounts, a term, section, offering, published syllabus and grading policy, one published Activity; two students uploaded a PDF each.
- Faculty dashboard with REAL pending work: hero "2 activity submissions ready to grade", tile "Activity submissions to grade" = 2 (linked), card "Activity submissions needing grading" lists "Business idea pitch, 2 submissions waiting"; its link opens the scoring page and "Back to Dashboard" returns to the dashboard. Scoring one submission made the dashboard drop to 1 and the card to "1 submission waiting". Seen at 1280 (and 375 captured, not reviewed).
- Student import: preview flags a row with an unknown section ("Section 9Z does not exist in this term"), blocks the import and disables the button; after fixing the file, 2 students were imported and invited and the page offers "Back to the term". Clear on desktop; phone width not reviewed.
- Friction seen, NOT changed: scoring is one row at a time, each with its own Save and a status line at the top (about 1.2 s per save); no "save all", no "next ungraded", no filter for ungraded rows. For a class of 40 this is the heaviest repeated task in the product. The disabled "Import 3 students" button keeps a count that includes the bad row.
- Not exercised: quiz-needing-review items, grade publication from this data, the invited students accepting, phone-width scoring page.

#### Faster grading on the scores page (2026-10-07, Claude; frontend only, ScoresPage.tsx)
- Added: "Show ungraded only" filter with a live "N of M still ungraded" line; Enter in a score box saves that row and moves focus to the next student's score box (a failed save does not advance); a "Saved" mark on each saved row. Rows remount after a save (key includes the score revision), so the saved marks and the pending focus live in the table. No "save all" (it would complicate the per-row revision conflict check).
- Verified on a throwaway database (since dropped) with three real activity submissions, keyboard only: type 18, Enter, focus on student 2; type 15, Enter, focus on student 3; two Saved marks; summary "1 of 3 still ungraded"; with the filter on, only Demo student 3 remains. Screenshot read: marks and focus ring are visible.
- Checks: tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; sweep 0 violations, 0 layout problems. The sweep does NOT visit the scores page (it needs graded data), so the new checkbox and status line have no axe result; no automated test was added for the Enter flow (manual verification only). Backend unchanged since the last full run (245 passed).
- Not verified: online-quiz variant of the table (same component), a score conflict (stale revision) while advancing, phone width, screen-reader announcement of "Saved".

#### Grading change: Codex review (channel #23) and fixes (2026-10-07, Claude)
- Codex required: guard an in-flight row save, advance only after the refreshed rows are committed, keep input and do not advance on a conflict, define a last-row focus fallback, scope the Saved state, no role=status on every badge, no manual score entry while quiz attempts are loading, rename the quiz table "Students with no attempts", ignore Enter during IME composition, leave Enter in feedback as a newline, and add one focused browser test.
- Applied all of those. Notable choices: inputs are `readOnly` (not `disabled`) while saving so focus is not dropped; the fallback focus target is the "Show ungraded only" checkbox; Saved marks reset per assessment and hide when a newer submission arrives; the summary line is plain text and only the page message is a live region; row errors are linked to the score box with `aria-describedby`.
- New test `frontend/e2e/grading.mjs` (`npm run e2e:grading`, disposable database only): 8/8 checks passed on a throwaway database (since dropped). Mutation check: with the in-flight guard removed, check B failed (two saves sent), so it detects that bug. With the refetch ordering reverted, check A still PASSED: A does not distinguish the two orderings (the next row keeps its key, so focus survives either way); the ordering fix rests on Codex's reasoning, not on a failing test.
- Other checks after the change: tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; sweep 0 violations, 0 layout problems; backend untouched (245 passed earlier). axe ran on the populated scores page inside grading.mjs: no violations.
- Not verified: real screen-reader announcements; the online-quiz variant of the table in a browser; phone width; "Saved" announcement wording (Codex suggested one combined message such as "Saved X. Two of three still need grading"; not done, the page message says "Saved X." and the visible count line is not announced).

#### Rollover question closed (2026-10-07, Claude)
- Codex #22 asked whether copying teacher assignments on new-year setup conflicts with an accepted rule. The records show it does not: IMPLEMENTATION_PLAN.md ("Term and rollover lifecycle") creates new sections/offerings per term, and DECISIONS.md (Codex's own M2 review, 2026-10-06) says copying sections is the default while copying offerings with their teachers is opt-in per term (`copy_offerings`, unchecked by default) with a "review the teachers afterwards" notice. No code change. If the user wants offerings never copied, that is a new decision to record.

#### Deferred items and friction fixes (2026-10-07, Claude; the user asked for all of them)
Built:
- Student To-do page `/student/todo` (full lists: Due soon, Another attempt available, Not open yet, Awaiting feedback) with a nav item; backend `GET /api/dashboard/student/todo` shares the dashboard's work buckets, students only (faculty and admin get 403). The dashboard's "and N more" now links to it.
- Unread dot: per-browser (localStorage), NOT stored on the server. A dot beside Dashboard while the newest course update is later than what this browser last showed on the dashboard; "New" tags on updates for that visit. It does not follow the student to another device. Codex advised deferring read-state semantics; this is the minimal per-browser form.
- Accounts: role and status filters, `GET /api/accounts/count` and "Page X of Y - N accounts" (the old Next button depended on exactly 25 rows); the admin "invitations not accepted yet" action opens the list already filtered to invited.
- Admin dashboard: removed the duplicate "User actions" card and "User accounts" button; "Open academic setup" is now "School years and terms" (matches the nav).
- Small friction: phone header fits on one row (theme selector hidden under 640px, still in Account & theme); emailed links have clear subjects (invite, reset, ownership transfer); empty term highlights "Add section", then "Assign a subject", then "Import students"; the blocked import button reads "Fix N rows to import" and the problems are also listed above the table (on a phone the Result column was off-screen); the scores table stacks into cards under 640px (Feedback and Save were off-screen); "Saved X. N of M still need grading." is the one announced status.
- `docs/USABILITY_SCRIPT.md`: task script for real participants.
Checks: pytest 248 passed (3 new: To-do page vs dashboard and role guard, accounts filters and count, email subjects); tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; sweep now 160 pages (added /student/todo) 0 violations 0 layout problems (it first found my new link at 21px, fixed with the existing touch class); grading regression 8/8 on a throwaway database (since dropped). Seen in screenshots: To-do page, admin dashboard, phone header, import preview and scores cards at 375. Dot and "New" tags, filters and counts exercised by script against the dev data.
Not done / not verified: the usability sessions themselves (need real people); screen-reader behaviour of the stacked table (display:block rows may lose table semantics in some readers); the dot across browsers or devices; the unread dot's colour contrast on the navy sidebar was not measured (axe does not check it).
Note: another process (started from Codex's Python runtime) was already serving the dev API on 8001 and Vite on 5173 with OLD code; my verification used my own stack on 8011 and 5176 against the same dev database. Restart those to see these changes on the usual ports.

#### Codex review of the deferred-items batch (channel #24) and fixes (2026-10-07, Claude)
- Codex found no permission or privacy problem (To-do endpoint is the student's own aggregation; the count endpoint is admin-only and exposes nothing the list does not) and accepted keeping the seen timestamp after sign-out (a timestamp, not content). Applied its changes:
  - Seen marker only moves forward, ignores invalid timestamps, listens to the `storage` event; described as "new since you last viewed the dashboard on this browser".
  - To-do page: "Due soon" is now "Available now"; past-deadline work that late submission still allows says "late submission allowed, was due ..." (also on the dashboard, and for extra attempts); upcoming work sorts by opening time and shows "opens ..."; the dashboard's next-step fallback never picks work that is not open yet. All in the shared aggregation, so dashboard and page agree. New test pins the order and the next-step rule.
  - Scores page: the "Saved X. N of M still need grading." count is taken from the refreshed rows (a feedback-only save with a blank score still counts as ungraded); `e2e/grading.mjs` gained check F for this (9/9 passed on a throwaway database since dropped). Stacked table now carries explicit table, rowgroup, row, columnheader and cell roles.
  - Accounts: the requested page is clamped when results shrink; test now also denies `/api/accounts/count` to faculty and students and unauthenticated callers.
- After these: pytest 249 passed; tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; sweep 160 pages 0 violations 0 layout problems.
- Verified for accounts paging on a throwaway database with 33 accounts: "Page 1 of 2 - 33 accounts", page 2 shows 8 rows, a narrowing search returns to page 1. The new clamp effect itself (shrinkage without a filter change) was NOT exercised.
- Still unverified: a real screen reader on the stacked scores table (Codex lists this as UNKNOWN; axe cannot establish it); the unread dot in more than one browser or device; contrast of the dot on the navy sidebar; the usability sessions (script written in docs/USABILITY_SCRIPT.md, not run).

#### Study buddy: floating chat, owl and conversations page (2026-10-07, Claude; no Codex review, at the user's request)
- Built: a floating Study buddy (bottom-right owl button) for students only, mounted in the app shell. It follows the subject being viewed (switcher when there are several), reopens the subject's LAST conversation and starts a new one only on "New chat", keeps the panel, subject and a half-typed question while moving between pages, closes on Escape and returns focus to the button, and is hidden on the Study buddy page, on a quiz attempt, on every faculty/admin page and before sign-in. New page `/student/study-buddy` lists every conversation across subjects (filter by subject, load more, new conversation in a chosen subject, delete, read-only marking for closed or withdrawn subjects). The old per-subject Study help tab is gone: its address redirects to the page and every link was updated. The chat itself is the existing component, extracted as `StudyChat` with the subject passed in, so grounding, retry identity, rate limits, the quiz pause and deletion are unchanged.
- Backend: `GET /api/learn/study/conversations` (student only; own chats across subjects; cursor paging; optional `offering_id`; says whether the student can still ask). Test covers isolation between students, 403 for faculty and admin, 401 anonymous, paging, the subject filter and `can_ask` turning false after the term closes.
- The owl is an inline SVG with four states that only mirror the chat (idle, thinking, pleased on an answer, asleep while the chat is paused for a quiz); motion stops under prefers-reduced-motion; no streaks, levels, rewards or study-time (kept off by the earlier rulings).
- After the user's feedback: the panel keeps its messages area large (composer pinned, lesson helpers folded into one "Lesson helpers" line, delete as a small icon in the composer row), and opening the buddy resumes the last conversation instead of a blank one.
- Checks: pytest 250 passed; tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; sweep 164 pages 0 violations 0 layout problems (it also found a 40px stats link, fixed); full fresh-install rehearsal PASSED 54/54 (adds checks for the redirect, the button on student pages only, and reopening the last conversation) and the live installation was proven untouched. Screenshots read: bubble, hover label, open panel in light, dark and phone widths, the conversations page.
- Not verified: a real screen reader on the panel (it is a non-modal dialog region); the pet's look to the user's taste (owl was my pick); behaviour with several subjects in the switcher (the dev student has one); a long conversation in the narrow panel.

#### Study buddy: the owl dances now and then (2026-10-07, Claude)
- A short dance (about 2.8 s: hop, sway, wings flapping, happy eyes) every 30 to 70 seconds, only while the chat is idle and the panel is closed, never in a hidden tab and never for people who prefer reduced motion (no timer is even started). It stops the moment the chat is busy.
- Verified with a fake clock in a browser: dance class appears within 72 s and is gone 3 s later; no dance with the panel open (200 s); no dance with reduced motion (300 s). The pose was read from a zoomed screenshot. tsc and eslint clean; accessibility sweep 164 pages 0 violations.
- Not verified: how often it feels right to a real student (the 30 to 70 s range is my guess), and the dance on a phone.

#### "Loading your workspace..." that never ends (2026-10-07, Claude)
- Cause of the report: the user's page was on Vite 5173, and I had just stopped the Docker database and the API; the page then waited on /api/auth/session. A failed request already showed "Cannot reach the server", but a request that never answers (API up, database down) left the page on Loading forever.
- Fix: the session request now has a 10-second limit (`AbortSignal.timeout`), so it ends in the "Cannot reach the server" message. Verified in a browser against the dev server: healthy page loads; with the session request deliberately never answered it shows Loading at 2 s and the error message at 12.5 s. tsc and eslint clean. Only the session request has the limit; other requests are unchanged.
- Services restored: Docker Postgres and Mailpit started, API started on 8001 (mine). The Vite on 5173 is not mine and was left running.

#### UX rework Phase 1: guided subject setup, skeleton drafts, copy from a previous subject (2026-10-08, Claude; no Codex review)
- Built (docs/UX_REWORK_PLAN.md, Phase 1): a setup wizard at `/faculty/offerings/:id/setup` (start from copy, file import or scratch; outline with a starter option; grading with a SUGGESTED usual setup that only counts after an explicit confirmation checkbox; assessment plan by count per period; class meeting days; review and publish), a banner on unset subjects that links to it (tabs are hidden during setup), and three backend commands: bulk plan of hidden drafts, per-subject meeting days (migration), and copy-from into an empty subject. Everything created is a draft; students see nothing until publish.
- Tests: 5 new backend tests (plan creates hidden drafts and a repeat creates nothing more; policy, limit and role checks; meeting days per subject and owner only; copy fills an empty subject with drafts only including a duplicated file; copy refused for a non-empty, same or someone else's subject). pytest 255 passed.
- Browser scenario `npm run e2e:setup` on a throwaway database: 14/14 checks, including: an empty subject reaches a complete-looking state after 14 inputs (plan target was 25 or fewer; 14 counts every click, check and choice, and the template, plan counts and class days were left at their defaults), Next is blocked until the weights are confirmed, 8 hidden drafts with category and period, meeting days 21 (Mon, Wed, Fri), students see none of it, the copy path brings over the outline, policy and 8 drafts, and a second copy is refused. axe is clean on the review step.
- Other checks: tsc and eslint clean; keyboard 11/11 and 21/21; states 0 problems; sweep 164 pages 0 violations 0 layout problems.
- Bug found by the scenario and fixed: publishing removed the draft, so the parent swapped the wizard for the start page and the done screen was lost; the finished state now lives in the parent.
- Not done in Phase 1 (by design, later phases): the attendance grid that uses meeting days (Phase 4); hiding Gradebook and Class standing until there is graded work (Phase 5). Not verified: a real teacher timing the wizard; the 14-input figure assumes defaults are accepted; copy of a large subject; the wizard on a phone (layout reviewed only by the sweep).

#### UX rework Phase 2: steppers, pasted questions, duplicate (2026-10-08, Claude; no Codex review)
- Built: the assessment editor is now a three-step stepper for online quizzes (Basics with only the essentials and the rest under "More options", Questions with a "Paste many questions at once" panel, Review and assign) and a single short screen for activities, exams, paper quizzes and teacher-scored items. The final button says Assign, Add to gradebook or Update for students depending on kind and state. Save and exit keeps the autosaved draft. A "Duplicate" action makes a hidden draft copy. Backend: a paste parser with a preview endpoint and a duplicate endpoint (see ARCHITECTURE.md). Not included from the plan: the AI quiz drafting dialog was NOT moved into the stepper; it remains on the assessments list as before.
- Tests: 7 new backend tests (the three question types with points and explanations; Windows line endings, numbering and multi-line prompts; eight kinds of problem reported by exact line while the good question still comes through; empty input and the 100-question limit; parsed questions saving into a draft with the right total; the endpoint is the teacher's own subject only; duplicate makes a hidden dateless draft, other teachers 404, students 403). pytest 262 passed.
- Browser scenario `npm run e2e:stepper` on a throwaway database: 18/18. A planned quiz was finished and assigned in 8 inputs (plan target 10 or fewer for this step), including a paste of 3 good questions and 1 bad block whose problem is shown as "Line 15"; axe is clean on the Questions, Review and activity screens; the student then sees the quiz and not the unfinished activity; the duplicate has no dates and is hidden; the activity is one short screen with no stepper.
- Existing scripts updated for the new buttons and the stepper (`flow.mjs`, `grading.mjs`). All re-run green: fresh-install rehearsal 54/54 and the live installation proven untouched; grading scenario 9/9; setup wizard 14/14; keyboard 11/11 and 21/21; states 0 problems; sweep 164 pages 0 violations 0 layout problems; tsc and eslint clean.
- Not verified: a real teacher entering a quiz (the 8-input figure counts clicks and fills, not typing time); pasting from Word or a PDF (only plain text is parsed); the stepper on a phone beyond the sweep; screen-reader announcement of the preview result.

#### UX rework Phase 3: grades and publication (2026-10-08, Claude; no Codex review)
- Built: the gradebook is read-first with an "Edit scores" mode and ONE Save (all or nothing); a "Ready to publish" strip names the next period and what is ready (other periods under "All periods", Course disabled until Midterm and Finals are each published); publishing is a review dialog (what will be published, unchanged, not ready) followed by the publish and its result; the Scores page says "Return N graded results" and counts what the student does not yet see; the 16 native `confirm()` calls are gone: a shared confirmation (Cancel first and focused) for what cannot be undone or students see at once, and Undo (10 seconds) for removing a question, a chapter or the grading policy. Backend: batch score save with per-cell conflicts, `fail(fields=...)`, and `to_return` on the scores rows.
- Tests: 5 new backend tests (a batch saves every cell in one request; one stale revision rejects the whole batch and names the cell, and the valid cell is NOT saved; invalid, duplicate and unknown cells are named and save nothing; an online quiz with a submitted attempt cannot be overwritten by hand; teacher-only, 500-cell limit, closed term). pytest 267 passed.
- Browser scenario `npm run e2e:grades` (throwaway database): 20/20. Read-first has no inputs; Edit scores makes the 6 scoreable cells inputs and one Save stores all 6; a conflicting edit marks the one cell, keeps the typed values, saves nothing else and leaves the other teacher's value; the strip, the review dialog (publishes nothing until confirmed), the student sees the Midterm grade, Course stays locked until Finals is out; "Return 3 graded results" then "All graded results returned" and the student sees the result; axe clean in read and edit modes. `quiz-stepper` grew to 22 checks (Undo puts a removed question back; the delete confirmation focuses Cancel and declining keeps the assessment).
- Existing scripts updated for the new interactions (`flow.mjs`, `keyboard-flows.mjs` now 24 checks, `keyboard.mjs`) and re-run green: fresh-install rehearsal 54/54 with the live installation proven untouched; grading 9/9; setup wizard 14/14; keyboard 11/11; states 0 problems; sweep 164 pages 0 violations 0 layout problems; tsc and eslint clean.
- Control count (page body, same dev data as the audit): gradebook 67 -> 37 (28 without the 9 subject tabs) and 15 on a typical 3-student, 2-assessment test subject. The plan's target was 25 or fewer; on the busy dev data (6 students, 14 assessment columns) it is NOT met: 14 column-header links and 6 student buttons remain, and the tabs shrink only in Phase 5. Assessments list unchanged at 58 until Phase 5.
- Not verified: a real teacher editing scores; keyboard-only batch editing beyond reaching, typing and cancelling; screen-reader announcement of the per-cell rejection messages and the Undo toast; the undo toast on a phone.

#### UX rework Phase 4: attendance grid (2026-10-08, Claude; no Codex review)
- Built: Attendance opens as a grid on desktop (students down, dates across, week or month) with the class days from the subject as columns, one-click cycling or keyboard marking (focus a cell, type P, L, A or E, Delete clears, arrows move, one cell in the tab order), "Mark rest present" and the grading period in each date's header (locked once recorded), a collapsed "Dates and class days" panel to add a date and set the class days, and per-change saving with Retry. The original single-day register stays as the "One day" view and is the phone default.
- Tests: 3 new backend tests pinning the partial-save contract the grid relies on (only named students change; each date is its own session and its period cannot change once recorded; section, owner and closed-term rules). pytest 270 passed.
- Browser scenario `npm run e2e:attendance` on a throwaway database: 19/19, including: the Mon, Wed, Fri class days are the columns; one click saves with no Save button; the keyboard result matches the server exactly; Mark rest present; a new date takes the period chosen in its header; a forced server failure shows the reason, outlines the cell, keeps the mark and Retry saves it; adding a class day adds its column and is stored; One day and back; a phone opens in One day; axe clean on the grid.
- Fixed on the way: `sweep-states.mjs` tried to click the new "Add date" button inside a collapsed section; it now skips hidden buttons. My first arrow-key check had `|| true` and could not fail; replaced with the real focus position.
- All re-run green: fresh-install rehearsal 54/54 (live installation untouched); keyboard 11/11 and 24/24; sweep 164 pages 0 violations 0 layout problems; states 52 checked 0 problems; quiz stepper 22/22; grades 20/20; grading 9/9; setup wizard 14/14; tsc and eslint clean.
- Known limits: no holiday calendar (a class day that is skipped is simply left unmarked or never added); no per-cell version check (two tabs editing one cell are last-write-wins); attendance weights and the gradebook calculation are unchanged. Not verified: a real teacher taking attendance with the grid; the grid on a tablet width; screen-reader behaviour of the cell buttons and the "saved" status; a 40-student, month-long grid for speed.
