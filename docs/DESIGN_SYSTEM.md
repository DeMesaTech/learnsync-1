# Design system

Use reference/dashboard-prototype.html Variant A as a visual reference. Preserve its navy/blue palette, but implement actual routes and permissions. Product navigation must omit demo role/variant switches.

Use semantic CSS variables, system/light/dark themes, base mobile layouts, 640px small and 1024px desktop navigation breakpoints. Verify keyboard focus, contrast, 44px targets and no whole-page horizontal overflow.

Short independent forms use native dialog with accessible labels, focus restoration and unsaved-change protection. Imports, syllabus, content editor, quizzes and gradebooks use pages. Server errors and saving/recovery/conflict states must be visible.

In online-quiz authoring, every question has a teacher-editable 1–180 minute limit (5-minute default); lock this setting once attempts exist. During an attempt, show only the current question, its saved-answer status, and an accessible server-expiry countdown. On expiry, keep its saved answer read-only and move to the next question; reload resumes the server clock.

Detailed colors, route inventory and theme rules: IMPLEMENTATION_PLAN.md section 5.

## Route map as built (supersedes the inventory in IMPLEMENTATION_PLAN.md section 5)

Several plan routes became tabs of one offering page; this is the actual map (source: `frontend/src/app/router.tsx`).

Public: `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation`. Signed in: `/account`; each role's home `/admin`, `/faculty`, `/student`.

Admin (`/admin/...`): `settings` is the Settings hub, with the Academic calendar section for school-year/semester creation, optional section/offering copy, closing and reasoned reopening; its settings navigation links to Prospectus, Student management, Faculty Management, and Account/theme. `students` and `offerings` are independent management pages. Student import opens as a dialog from Student management (the legacy term import URL remains available); faculty import opens as a dialog from Faculty Management, where preview names and emails can be edited and revalidated before commit. The legacy `/admin/teachers/import` URL redirects to Faculty Management. Other established routes include `subjects`, `subjects/import`, `subjects/import/:importId`, `offerings/:offeringId` (roster), `issues` (reports), and `audit`.

Student management retains the **Course** filter label for college/program selection. Sections are owned by one college/program and use its code in generated names (for example, `BSE 1A`); subject offerings are assigned later in the separate Offerings tab.

Faculty (`/faculty/...`): `subjects`, `issues` (report a problem), and per offering `offerings/:offeringId` with tabs `` (students), `syllabus`, `content`, `content/:itemId/edit`, `assessments`, `assessments/:assessmentId/edit`, `assessments/:assessmentId/scores`, `attendance`, `gradebook` (publish grades and export), `progress`, `announcements`.

Student (`/student/...`): `subjects`, `issues`, and per offering `offerings/:offeringId` with tabs `syllabus`, `lessons`, `lessons/:itemId`, `study`, `work`, `work/:assessmentId`, `work/:assessmentId/attempts/:attemptId`, `progress`, `results`, `announcements`. A withdrawn student sees only `results`.

Not built (plan items without a page): `/student/progress` across subjects, `/admin/students`, `/admin/sections` pages (sections and students are managed inside the term workspace), and per-kind faculty routes (`quizzes`, `activities`, `examinations` are one `assessments` page).

Added later: student `/student/todo` (all open work) and `/student/study-buddy` (all Study buddy conversations; the per-subject `study` tab now redirects there). Students also get a floating Study buddy button on every page except the Study buddy page and quiz attempts.

Confirmations and undo (Phase 3): confirm only what cannot be undone or what students will see at once (return results, publish grades or an announcement, submit answers, delete or discard a draft, close a term, sign out with unsaved work), always through `useConfirm()` with the safe choice first. Reversible edits (remove a question, a chapter or the grading policy) use `useUndo()`. Never use the browser's `confirm()`.

## Classwork pattern (Phase 5)
- Three levels, each looking different: the subject tabs (underline), the Classwork type pills (rounded, the selected one filled), then a segmented status filter (soft grey track, white selected segment). Chapters are bold headings with an accent underline; topics are indented under a vertical line.
- The type pills are links (`?type=lesson|quiz|activity|exam`), shared through `components/ClassworkTypes.tsx`, so lesson, work and syllabus pages keep them and Back returns to the same pill.
- Route map: `/…/offerings/:id/stream | classwork | syllabus | people | grades`; old list addresses redirect into Classwork.
- Faculty Grades stays visible while an offering has no published assessments. From Classwork, creating an assessment uses two dialog steps: set its title and audience, then edit/assign it in the assessment editor. Direct assessment edit links remain pages.

## Term offering administration
- The term's Offerings table can be filtered to one teacher when multiple teachers have assignments. Bulk Assign subjects defaults to active subjects placed in that term's semester; an explicit All semesters option remains available for approved exceptions. For a prospectus subject with a year-level placement, the assignment dialog lists only sections in that year.
- Bulk subject assignment identifies the academic term, narrows the workflow to a college/program, then selects one faculty member and one or more subject-section pairs. Selected pairs remain visible as subject cards with section chips and a live assignment total. Keep duplicate checks, year-level filtering, off-semester reasons, and all-or-nothing saving intact.
- In bulk assignment, a subject is unavailable when every eligible section in the selected college/program is already assigned. Sections already assigned to another teacher (including archived assignments, whose section links remain protected by history) are disabled in the subject card; automatically preselected sections include only unassigned sections. The API independently rejects conflicting section assignments with a clear error.
- Admin data tables use compact typography and cell spacing and preserve readable column widths with horizontal scrolling inside their table region rather than compressing columns or causing page-wide overflow. The bulk assignment subject chooser can filter by prospectus year level, including unplaced subjects.
- Admin table rows use reduced vertical padding; inline row actions and their icons are sized to match the compact table typography while retaining clear labels and focus states.
- Faculty Management separates **Teachers** and **Subject assignments** into tabs. The Teachers table displays college/program as text and uses an edit/save/cancel row mode to edit teacher name, email, and college/program without an inline dropdown. Email changes revoke sessions and require a new invitation verification. It provides server-searched teacher accounts and filtering based on `account.college_id`, individual invitations, account activation/deactivation, and confirmation-backed invitation/reset-link sending. Account deactivation preserves teaching and audit history. Teacher invites and editable import previews require a college/program for new accounts. In Subject assignments, the college filter narrows the teacher selector and assignments using the same account `college_id`; it does not infer college from sections currently assigned.
- Faculty Management uses icon-only, accessibly labeled row actions: edit opens a subject-fixed assignment dialog, roster opens in a modal without leaving the page, and Take over transfers an existing assignment to another active teacher. Takeover preserves the offering and its academic records in place and audits the prior and new faculty; duplicate subject assignments are rejected. Archiving an assignment preserves history and allows restoration; active enrollments must be withdrawn before archival. Mouse-wheel vertical scrolling over an overflowing offerings table advances its horizontal scroll position.
- Offerings display one row per subject assignment. Its section and enrollment cells list matching sections/counts together horizontally as individually bordered chips, with a hover- or keyboard-revealed add-section action contained within the section cell. Assignment editing cannot change the faculty member; use Take over to hand the existing assignment and history to another teacher.
- Let the Faculty Management offerings table fit its content using automatic column sizing; keep horizontal scrolling contained within the table region when it exceeds the viewport.

## Replacing a syllabus
- On a published syllabus, make “Replace syllabus from a file” available as a DOCX/PDF import. Import creates a reviewable draft; keep the published revision and its grading policy live until faculty publishes the replacement. Preserve the existing grading policy in the imported draft.

## Feedback toasts and celebration
Use `useToast()` for a one-line result of an action that is not already obvious from the page (plain, 5 seconds) and `useUndo()` for something that can be put back (Undo, 10 seconds). One toast at a time, bottom left. `celebrate()` is only for a finished lesson or quiz.

## File and link pages
A file page shows the PDF in a frame or the picture inline (never anything else), then a Download button with the size; a link page is a card with the site name, the teacher's note, one "Open the link" button that opens a new tab with `rel="noopener noreferrer"`, and the address in small text. All three kinds end with the same "Mark lesson / file / link as complete" button and the same Next item.
