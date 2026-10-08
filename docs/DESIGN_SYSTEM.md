# Design system

Use reference/dashboard-prototype.html Variant A as a visual reference. Preserve its navy/blue palette, but implement actual routes and permissions. Product navigation must omit demo role/variant switches.

Use semantic CSS variables, system/light/dark themes, base mobile layouts, 640px small and 1024px desktop navigation breakpoints. Verify keyboard focus, contrast, 44px targets and no whole-page horizontal overflow.

Short independent forms use native dialog with accessible labels, focus restoration and unsaved-change protection. Imports, syllabus, content editor, quizzes and gradebooks use pages. Server errors and saving/recovery/conflict states must be visible.

Detailed colors, route inventory and theme rules: IMPLEMENTATION_PLAN.md section 5.

## Route map as built (supersedes the inventory in IMPLEMENTATION_PLAN.md section 5)

Several plan routes became tabs of one offering page; this is the actual map (source: `frontend/src/app/router.tsx`).

Public: `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation`. Signed in: `/account`; each role's home `/admin`, `/faculty`, `/student`.

Admin (`/admin/...`): `academics` (school years and terms), `terms/:termId`, `terms/:termId/import-students`, `subjects`, `subjects/import`, `subjects/import/:importId`, `offerings/:offeringId` (roster), `accounts`, `issues` (reports), `audit`.

Faculty (`/faculty/...`): `subjects`, `issues` (report a problem), and per offering `offerings/:offeringId` with tabs `` (students), `syllabus`, `content`, `content/:itemId/edit`, `assessments`, `assessments/:assessmentId/edit`, `assessments/:assessmentId/scores`, `attendance`, `gradebook` (publish grades and export), `progress`, `announcements`.

Student (`/student/...`): `subjects`, `issues`, and per offering `offerings/:offeringId` with tabs `syllabus`, `lessons`, `lessons/:itemId`, `study`, `work`, `work/:assessmentId`, `work/:assessmentId/attempts/:attemptId`, `progress`, `results`, `announcements`. A withdrawn student sees only `results`.

Not built (plan items without a page): `/student/progress` across subjects, `/admin/students`, `/admin/sections` pages (sections and students are managed inside the term workspace), and per-kind faculty routes (`quizzes`, `activities`, `examinations` are one `assessments` page).

Added later: student `/student/todo` (all open work) and `/student/study-buddy` (all Study buddy conversations; the per-subject `study` tab now redirects there). Students also get a floating Study buddy button on every page except the Study buddy page and quiz attempts.

Confirmations and undo (Phase 3): confirm only what cannot be undone or what students will see at once (return results, publish grades or an announcement, submit answers, delete or discard a draft, close a term, sign out with unsaved work), always through `useConfirm()` with the safe choice first. Reversible edits (remove a question, a chapter or the grading policy) use `useUndo()`. Never use the browser's `confirm()`.

## Classwork pattern (Phase 5)
- Three levels, each looking different: the subject tabs (underline), the Classwork type pills (rounded, the selected one filled), then a segmented status filter (soft grey track, white selected segment). Chapters are bold headings with an accent underline; topics are indented under a vertical line.
- The type pills are links (`?type=lesson|quiz|activity|exam`), shared through `components/ClassworkTypes.tsx`, so lesson, work and syllabus pages keep them and Back returns to the same pill.
- Route map: `/…/offerings/:id/stream | classwork | syllabus | people | grades`; old list addresses redirect into Classwork.

## Feedback toasts and celebration
Use `useToast()` for a one-line result of an action that is not already obvious from the page (plain, 5 seconds) and `useUndo()` for something that can be put back (Undo, 10 seconds). One toast at a time, bottom left. `celebrate()` is only for a finished lesson or quiz.

## File and link pages
A file page shows the PDF in a frame or the picture inline (never anything else), then a Download button with the size; a link page is a card with the site name, the teacher's note, one "Open the link" button that opens a new tab with `rel="noopener noreferrer"`, and the address in small text. All three kinds end with the same "Mark lesson / file / link as complete" button and the same Next item.
