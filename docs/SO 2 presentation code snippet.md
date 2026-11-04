Here are presentation-ready snippets for **items 3–6** from the first image. They’re excerpts from the existing project code.

## 3. Show how the feature is integrated into the existing system

The student page requests course items through the shared API client; the backend route checks enrollment and returns the student’s items.

```tsx
// Student course page
const query = useQuery({
  queryKey: ['learn-items', offering.id],
  queryFn: () => api<LearnItem[]>(
    `/learn/offerings/${offering.id}/items`
  ),
});
```
**File and lines:** [Learn.tsx](../frontend/src/features/teaching/Learn.tsx), line 39.

```python
# FastAPI route
@router.get("/learn/offerings/{offering_id}/items")
def learn_items(offering_id: UUID, actor=Depends(student),
                db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return items.student_items(db, offering, enrollment, actor.id)
```
**File and lines:** [router.py](../backend/app/features/teaching/router.py), lines 246–249.

**Explain:** “The course page uses our existing API client to request materials for a course. The backend verifies the student’s access before returning the content.”  
Sources: `Learn.tsx`, `teaching/router.py`


## 4. How the different modules communicate

**End-to-end flow:** Faculty Classwork → Teaching and Assessments APIs → PostgreSQL and private file storage → Student Classwork and Work.

The frontend calls the backend API. The backend checks the signed-in role and course enrollment or ownership, calls the relevant feature service, and reads or writes data in the shared PostgreSQL database.

### A. Faculty opens assigned subjects and their rosters

The faculty dashboard requests only the teacher's assigned offerings. The roster view requests enrolled students for the selected offering.

```tsx
const query = useQuery({
  queryKey: ['my-offerings'],
  queryFn: () => api<OfferingSummary[]>('/me/offerings'),
});

const roster = useQuery({
  queryKey: ['roster', offeringId, history],
  queryFn: () => api<RosterRow[]>(
    `/offerings/${offeringId}/students${history ? '?history=true' : ''}`
  ),
});
```
**Frontend files and lines:** [Rosters.tsx](../frontend/src/features/academics/Rosters.tsx), lines 20–22 and 93–94.

```python
@router.get("/me/offerings")
def my_offerings(actor=Depends(faculty), db: Session = Depends(get_db)):
    return queries.my_offerings(db, actor)

@router.get("/offerings/{offering_id}/students")
def offering_students(offering_id: UUID, history: bool = False,
                      actor=Depends(roster_actor), db: Session = Depends(get_db)):
    return queries.offering_roster(db, offering_id, actor, history)
```
**Backend file and lines:** [academics/router.py](../backend/app/features/academics/router.py), lines 261–264 and 283–285. The query scopes offerings to the faculty account in [academics/queries.py](../backend/app/features/academics/queries.py), lines 229–233, and checks offering access before returning its roster at lines 264–275.

### B. Faculty publishes the syllabus and learning materials

The syllabus editor autosaves chapters/topics as an outline, then sends a publish request.

```tsx
save: (v, counter) => send('PUT', `${url}/draft`, {
  expected_counter: counter,
  outline: v.outline,
  grading_policy: v.grading_policy,
})
```

```tsx
if (await auto.flush()) {
  await post(`${url}/draft/publish`, {
    expected_counter: auto.counter(),
  });
}
```

**Frontend file and lines:** [SyllabusPage.tsx](../frontend/src/features/teaching/SyllabusPage.tsx), lines 93–103.

The backend scopes both operations to the faculty member's offering and delegates to the syllabus service.

```python
@router.put("/teach/offerings/{offering_id}/syllabus/draft")
def save_syllabus_draft(offering_id: UUID, data: SyllabusSave,
                        actor=Depends(faculty), db: Session = Depends(get_db)):
    return syllabus.save_draft(db, actor, own(db, offering_id, actor), data)

@router.post("/teach/offerings/{offering_id}/syllabus/draft/publish")
def publish_syllabus(offering_id: UUID, data: Counter,
                     actor=Depends(faculty), db: Session = Depends(get_db)):
    rev = syllabus.publish(db, actor, own(db, offering_id, actor),
                           data.expected_counter)
    return syllabus.view(db, rev)
```
**Backend file and lines:** [teaching/router.py](../backend/app/features/teaching/router.py), lines 47–64.

Faculty uploads modules through the same teaching feature. The complete file-selection, upload, authorization, and storage snippets are in [Faculty uploading a module](#faculty-uploading-a-module) below.

### C.Faculty uploading a module

The faculty member chooses a module file in the item editor. Supported formats are PDF, Word, PowerPoint, Excel, PNG, and JPEG.

```tsx
<input
  name="file"
  type="file"
  accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg"
  onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
/>
```
**File and line:** [Content.tsx](../frontend/src/features/teaching/Content.tsx), line 202.

The frontend sends the file and current draft revision counter as multipart form data.

```tsx
const form = new FormData();
form.set('file', selectedFile);
form.set('expected_counter', String(auto.counter()));
const result = await upload(`${base}/draft/file`, form);
```
**File and lines:** [Content.tsx](../frontend/src/features/teaching/Content.tsx), lines 169–177.

The backend route restricts the operation to the faculty member who owns the offering, then passes the upload to the teaching feature.

```python
@router.post("/teach/offerings/{offering_id}/items/{item_id}/draft/file")
def upload_item_file(offering_id: UUID, item_id: UUID, file: UploadFile = File(...),
                     expected_counter: int = Form(...), actor=Depends(faculty),
                     db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return items.attach_file(
        db, actor, items.get_item(db, offering, item_id), file, expected_counter
    )
```
**File and lines:** [router.py](../backend/app/features/teaching/router.py), lines 139–145.

The teaching service checks the item type and draft version, stores the file, links it to the draft, and commits the update.

```python
if item.kind != "file":
    fail(422, "kind_mismatch", "Only file items take an uploaded file.")
draft = locked_draft(db, item, expected_counter)
file = save_upload(db, upload, "material", actor, MATERIAL_TYPES)
draft.file_id = file.id
draft.draft_counter += 1
db.commit()
```
**File and lines:** [items.py](../backend/app/features/teaching/items.py), lines 183–190.

**Explain:** “The selected file is sent to the backend with the draft’s revision number. The API checks that the faculty member owns the course, and the teaching service verifies the item and draft before saving. The shared file-storage function checks allowed extensions, size, and file structure.”
### D. Faculty creates quizzes and activities

The Classwork menu distinguishes online quizzes from activities; the assessment dialog sends the selected kind and title to the backend.

```tsx
{label: 'Quizzes', options: [
  ['Online quiz', {type: 'assessment', kind: 'online_quiz'}],
]},
{label: 'Activities', options: [
  ['Activity', {type: 'assessment', kind: 'activity'}],
]},
```

```tsx
onCreated(await post<Assessment>(
  `/teach/offerings/${offering.id}/assessments`,
  {
    kind: kind ?? f.get('kind'),
    title: f.get('title'),
    section_ids: chosen,
    anchor_node_id: anchorNodeId ?? null,
  }
));
```
**Frontend files and lines:** [Classwork.tsx](../frontend/src/features/teaching/Classwork.tsx), lines 29–30; [Assessments.tsx](../frontend/src/features/assessments/Assessments.tsx), lines 18–23.

The backend checks faculty access to the offering and calls the assessment definition service to create a draft.

```python
@router.post(T + "/assessments", status_code=201)
def create_assessment(offering_id: UUID, data: AssessmentCreate,
                      actor=Depends(faculty), db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return definitions.assessment_view(
        db, definitions.create(db, actor, offering, data)
    )
```
**Backend file and lines:** [assessments/router.py](../backend/app/features/assessments/router.py), lines 99–103. The quiz draft and its questions are saved by [assessments/definitions.py](../backend/app/features/assessments/definitions.py), lines 153–178. The detailed quiz creation flow appears in [Faculty creating an online quiz](#faculty-creating-an-online-quiz) below.

### E. Student opens an enrolled subject and views published content

The student dashboard first requests the subjects linked to the student's enrollments.

```tsx
const query = useQuery({
  queryKey: ['my-subjects'],
  queryFn: () => api<MySubject[]>('/me/subjects'),
});
```
**Frontend file and line:** [Rosters.tsx](../frontend/src/features/academics/Rosters.tsx), line 106.

```python
@router.get("/me/subjects")
def my_subjects(actor=Depends(student), db: Session = Depends(get_db)):
    return queries.my_subjects(db, actor)
```
**Backend file and lines:** [academics/router.py](../backend/app/features/academics/router.py), lines 288–290. The query filters enrollments by the authenticated student's account in [academics/queries.py](../backend/app/features/academics/queries.py), lines 236–245.

After the student opens a subject, the page fetches its learning items.

```tsx
const items = useQuery({
  queryKey: ['learn-items', offering.id],
  queryFn: () => api<LearnItem[]>(
    `/learn/offerings/${offering.id}/items`
  ),
});
```
**Frontend file and line:** [Learn.tsx](../frontend/src/features/teaching/Learn.tsx), line 39.

The backend verifies student enrollment and asks the teaching feature for its learner-safe projection.

```python
@router.get("/learn/offerings/{offering_id}/items")
def learn_items(offering_id: UUID, actor=Depends(student),
                db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return items.student_items(db, offering, enrollment, actor.id)
```
**Backend file and lines:** [teaching/router.py](../backend/app/features/teaching/router.py), lines 246–249. The projection selects published, non-archived items targeted to the student's section in [teaching/items.py](../backend/app/features/teaching/items.py), lines 279–313.

### F. Student answers a quiz or submits an activity

For a quiz, the frontend saves the active answer and sends the submit request. For an activity, it sends the selected PDF as multipart form data.

```tsx
await send('PUT', `${url}/answers`, {
  answers: {[active.key]: sent[active.key]},
});

const result = await post(`${url}/submit`, {
  idempotency_key: submitKey.current,
  answers: active ? {[active.key]: latest.current[active.key]} : {},
});
```
**Frontend file and lines:** [Work.tsx](../frontend/src/features/assessments/Work.tsx), lines 180 and 209–212.

```tsx
const form = new FormData(e.currentTarget);
await upload(
  `/learn/offerings/${offering.id}/assessments/${item!.id}/submissions`,
  form
);
```
**Frontend file and lines:** [Work.tsx](../frontend/src/features/assessments/Work.tsx), lines 70–74.

The backend checks enrollment before delegating quiz answers, quiz submission, and activity uploads to the assessment services.

```python
@router.put(L + "/attempts/{attempt_id}/answers")
def save_answers(offering_id: UUID, attempt_id: UUID, data: AnswersSave,
                 actor=Depends(student), db: Session = Depends(get_db)):
    learner_offering(db, offering_id, actor, write=True)
    return attempts.save_answers(db, actor, offering_id, attempt_id, data.answers)

@router.post(L + "/assessments/{assessment_id}/submissions", status_code=201)
def submit_activity(offering_id: UUID, assessment_id: UUID,
                    file: UploadFile = File(...), note: str = Form(""),
                    actor=Depends(student), db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor, write=True)
    assessment, _ = learner.student_assessment(
        db, offering, enrollment, assessment_id, "activity"
    )
    return submissions.submission_view(
        db, submissions.submit(db, actor, assessment, file, note)
    )
```
**Backend file and lines:** [assessments/router.py](../backend/app/features/assessments/router.py), lines 309–313 and 330–335. The quiz submit route is at lines 323–327.

### G. System records the answers, scores, and activity submissions

Validated quiz answers are written against the student's attempt and question. On submission, the system scores the attempt and synchronizes the working assessment score.

```python
db.add(QuizAnswer(
    attempt_id=attempt.id,
    question_key=question.key,
    response=response,
))

attempt.score, attempt.max_score = total, sum((q.points for q in questions), Decimal(0))
row = sync_quiz_score(db, assessment, assessment_rev, attempt.student_id)
release_one(db, assessment, assessment_rev, row)
```
**Backend file and lines:** [attempts.py](../backend/app/features/assessments/attempts.py), lines 90–98 and 127–131. The total score and maximum points are calculated from the quiz questions and saved answers in `finalize`, lines 100–131.

Activity uploads are stored as private files; a database row connects each file to the assessment, assessment revision, student, and submission version.

```python
file = save_upload(db, upload, "submission", student, SUBMISSION_TYPES)
row = ActivitySubmission(
    assessment_id=assessment.id,
    revision_id=rev.id,
    student_id=student.id,
    version=number,
    file_id=file.id,
)
db.add(row)
db.commit()
```
**Backend file and lines:** [submissions.py](../backend/app/features/assessments/submissions.py), lines 67–88.

**Explain:** “The frontend sends each action to the API for the relevant feature. The backend checks the user's course access and delegates to teaching or assessments. PostgreSQL stores content revisions, quiz attempts and answers, submission records, and scores. Uploaded file bytes live in private file storage; PostgreSQL stores their file records and links. This preserves which assessment version a student used and which file they submitted.”

## 5. Database integration and data flow

LearnSync uses one PostgreSQL database. The main records are connected by foreign keys:

```text
Offering
 ├─ Syllabus → SyllabusRevision (outline: chapters and topics; draft/published state)
 ├─ LearningItem → LearningItemRevision → StoredFile (uploaded module metadata)
 └─ Assessment → AssessmentRevision → QuizQuestion
       ├─ QuizAttempt → QuizAnswer
       ├─ ActivitySubmission → StoredFile
       ├─ AssessmentScore
       └─ ResultPublication
```

The model fields below show how student attempts and answers are tied to the assessment revision and account.

```python
# Excerpt: fields map the attempt and answer to their parent database records.
class QuizAttempt(Base):
    __tablename__ = "quiz_attempt"
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessment.id"), index=True
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessment_revision.id")
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("account.id"), index=True
    )
    score: Mapped[Decimal | None] = mapped_column(POINTS)

class QuizAnswer(Base):
    __tablename__ = "quiz_answer"
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("quiz_attempt.id"), index=True
    )
    question_key: Mapped[str] = mapped_column(String(36))
    response: Mapped[object] = mapped_column(JSONB, nullable=True)
```
**Backend file and lines:** [assessments/models.py](../backend/app/features/assessments/models.py), lines 144–172.

An activity submission similarly links the student and assessment revision to a stored file. The working score can point back to the attempt or submission used for grading.

```python
# Excerpt: submissions and working scores keep links to their source records.
class ActivitySubmission(Base):
    __tablename__ = "activity_submission"
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessment.id"), index=True
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessment_revision.id")
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("account.id"), index=True
    )
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stored_file.id"))

class AssessmentScore(Base):
    __tablename__ = "assessment_score"
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessment.id"), index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("account.id"), index=True
    )
    score: Mapped[Decimal | None] = mapped_column(POINTS)
    selected_attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("quiz_attempt.id")
    )
    selected_submission_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("activity_submission.id")
    )
```
**Backend file and lines:** [assessments/models.py](../backend/app/features/assessments/models.py), lines 179–220.

**Data flow to explain:** Faculty saves a draft; the API writes it to PostgreSQL. Publishing switches the student-facing projection to the published revision. A student's quiz attempt references that exact revision; answers reference the attempt. A student's activity submission references its assessment revision and a privately stored file. Scoring updates the working score, and result publication controls when a student can see the result.



## 6. Demonstrate actual functionality with sample data

The student interface starts a quiz attempt using the course and assessment IDs from the loaded page.

```tsx
const attempt = await post<AttemptView>(
  `/learn/offerings/${offering.id}/assessments/${item.id}/attempts`,
  {}
);

navigate(
  `${base}/${item.id}/attempts/${attempt.id}`
);
```
**File and line:** [Work.tsx](../frontend/src/features/assessments/Work.tsx), line 67.

The backend creates and saves an attempt, then returns its student-safe view.

```python
attempt = QuizAttempt(assessment_id=assessment.id, revision_id=rev.id, student_id=student.id,
                      attempt_number=used + 1)
db.add(attempt)
db.flush()
questions = attempt_questions(db, attempt)
if questions:
    activate_question(db, attempt, questions[0], at)
db.commit()
return attempt
```
**File and lines:** [attempts.py](../backend/app/features/assessments/attempts.py), lines 237–260.

**Demo:** Sign in as a student enrolled in a sample course, open a published quiz, start it, answer a question, and submit. Show the resulting status or released score. Use an existing test/demo quiz and account; don’t present made-up results as live system output.  
Sources: `Work.tsx`, `attempts.py`