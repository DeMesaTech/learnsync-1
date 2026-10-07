# Usability walkthrough script

For 2–3 real people (a teacher, a student, an administrator or adviser). Not run yet: it needs real participants.

**Setup.** Use a disposable install, not the pilot database: `pwsh scripts/rehearse-fresh.ps1 -Keep`, or a fresh database plus `python -m app.cli seed-demo` (accounts `admin@example.com`, `faculty1@example.com`, `student1@example.com`, password in `backend/app/cli.py`). Put a few published lessons, one quiz and one activity with two PDF submissions in the demo subject first.

**How to run it.** One person at a time, on their own laptop or phone. Say: "We are testing the system, not you." Give each task as a sentence, never as a menu name. Do not help. Note where they hesitate, click the wrong thing, or ask a question. Stop a task after 3 minutes.

For each task record: finished (yes / yes with help / no), seconds, wrong turns, one quote.

## Administrator (start from an empty install)
1. Set up this semester: create a school year with its two semesters.
2. Add the subjects from the prospectus file you were given.
3. Add a section called 1A and put a teacher on the subject for that section.
4. Add the students from `students.csv` to section 1A. (Include one row with a section that does not exist.)
5. Find out which invited people have not accepted yet and resend one invitation.
6. A student writes that their account is locked. Find them and deactivate then reactivate the account.

## Faculty
1. Sign in from the invitation email you received and choose a password.
2. Find out what needs your attention today.
3. Grade the three activity submissions, giving feedback to one of them. (Notice whether you used the keyboard.)
4. Make students able to see the results.
5. Write a short announcement for section 1A only.
6. Publish the Midterm grade for your class and download it as a PDF.

## Student
1. Sign in from the invitation email and choose a password.
2. Find the next thing you should do.
3. Find everything that is due this week, across all your subjects.
4. Open a lesson, mark it complete, then ask study help to explain one idea from it in simpler words.
5. Take the quiz, then find your result and your Midterm grade.
6. Report a problem with the page you are on.

## After each person
- "What was the most confusing moment?"
- "Was there anything you expected to find and could not?"
- "On a scale of 1 to 5, how easy was it to know what to do next?"

Record findings in `docs/ACCEPTANCE.md` under a dated heading, with the fixes made and what was left alone.
