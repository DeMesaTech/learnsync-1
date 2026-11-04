# Specific Objective 2: Code Snippets Explained for Beginners

## A few helpful terms

- **Frontend:** The part of LearnSync that people see and click, such as a course page or quiz form.
- **Backend:** The server-side part that receives requests, checks permissions, and performs the requested work.
- **API:** The set of URLs the frontend uses to ask the backend for information or to save changes.
- **Route:** One backend API endpoint. For example, a route can return a student's course materials.
- **Database:** The organized place where LearnSync saves information such as courses, quiz answers, and scores.
- **ID:** A unique value used to identify one particular course, quiz, student, or other record.
- **Draft and published version:** A draft can still be edited. A published version is the version made available to students.

The code shown here is selected from the project. It is not a complete file, and some names are supplied by nearby code.

## 3. How a feature is connected to the existing system

When a student opens a course, the frontend asks the backend for the course items. The backend checks that the signed-in student is enrolled before returning them.

### Frontend: ask for course materials

```tsx
// Student course page
const query = useQuery({
  queryKey: ['learn-items', offering.id],
  queryFn: () => api<LearnItem[]>(
    `/learn/offerings/${offering.id}/items`
  ),
});
```

**In plain language:** `useQuery` loads information for the page. `offering.id` identifies the course. The URL inside `api(...)` tells LearnSync which course items to request. The result is expected to be a list of learning items.

**Source:** [Learn.tsx](../frontend/src/features/teaching/Learn.tsx), line 39.

### Backend: check the student and return the materials

```python
# FastAPI route
@router.get("/learn/offerings/{offering_id}/items")
def learn_items(offering_id: UUID, actor=Depends(student),
                db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return items.student_items(db, offering, enrollment, actor.id)
```

**In plain language:** `@router.get(...)` makes this function respond to a request for that URL. The server identifies the signed-in student as `actor`, checks their enrollment, and then asks the teaching feature for the items that student is allowed to see.

**Source:** [router.py](../backend/app/features/teaching/router.py), lines 246–249.

**Whole trip:** The page asks; the backend checks access; then the backend sends the allowed course items back to the page.

## 4. How the different parts of the system communicate

**Overall path:** Faculty pages → backend APIs → PostgreSQL and private file storage → student pages.

For example, the frontend sends a request to an API. The backend checks who made the request and whether they can access that course. If allowed, it reads or saves information using the appropriate feature.

### A. Faculty opens assigned subjects and student rosters

The first request loads the subjects assigned to the faculty member. The second loads the students enrolled in one selected subject.

#### Frontend

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

**In plain language:** The first `api(...)` call asks for the faculty member's assigned subjects. The second asks for the selected subject's roster. `offeringId` tells the server which subject to look up. The optional `history=true` asks to include historical roster information.

**Frontend source:** [Rosters.tsx](../frontend/src/features/academics/Rosters.tsx), lines 20–22 and 93–94.

#### Backend

```python
@router.get("/me/offerings")
def my_offerings(actor=Depends(faculty), db: Session = Depends(get_db)):
    return queries.my_offerings(db, actor)

@router.get("/offerings/{offering_id}/students")
def offering_students(offering_id: UUID, history: bool = False,
                      actor=Depends(roster_actor), db: Session = Depends(get_db)):
    return queries.offering_roster(db, offering_id, actor, history)
```

**In plain language:** These functions receive the frontend's requests. The first gets the signed-in faculty member's subjects. The second gets the roster for one subject. The server-side query limits the results to subjects the faculty member is allowed to access.

**Backend source:** [academics/router.py](../backend/app/features/academics/router.py), lines 261–264 and 283–285. The faculty subject filter is in [academics/queries.py](../backend/app/features/academics/queries.py), lines 229–233; the roster access check is at lines 264–275.

### B. Faculty saves and publishes the syllabus

The editor saves syllabus changes as a draft. When the faculty member chooses to publish, the frontend sends a separate publish request.

#### Frontend

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

**In plain language:** The first part sends the current syllabus outline and grading policy to the server as a draft. The second waits for any unsaved changes to finish saving (`flush`) and then asks the server to publish the latest draft. The counter helps ensure the publish request uses the expected version.

**Frontend source:** [SyllabusPage.tsx](../frontend/src/features/teaching/SyllabusPage.tsx), lines 93–103.

#### Backend

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

**In plain language:** The backend checks that the faculty member owns the subject before saving or publishing its syllabus. It passes the work to the syllabus feature and returns a view of the published version.

**Backend source:** [teaching/router.py](../backend/app/features/teaching/router.py), lines 47–64.

### C. Faculty uploads a module file

The faculty member chooses a file, the frontend uploads it, and the backend checks access and saves it.

#### 1. Choose a file in the page

```tsx
<input
  name="file"
  type="file"
  accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg"
  onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
/>
```

**In plain language:** This creates a file-picker button. The `accept` list tells the browser which file types the picker should offer. When the user chooses a file, `onChange` saves it in the page's state so it can be uploaded.

**Source:** [Content.tsx](../frontend/src/features/teaching/Content.tsx), line 202.

#### 2. Send the file to the backend

```tsx
const form = new FormData();
form.set('file', selectedFile);
form.set('expected_counter', String(auto.counter()));
const result = await upload(`${base}/draft/file`, form);
```

**In plain language:** `FormData` packages the file and the draft version number for upload. `upload(...)` sends that package to the server. The version number helps the server avoid saving a file onto an unexpected draft version.

**Source:** [Content.tsx](../frontend/src/features/teaching/Content.tsx), lines 169–177.

#### 3. Check faculty access and pass the file to the teaching feature

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

**In plain language:** This backend route only accepts a faculty user. It checks that the user owns the subject, finds the learning item, and hands the file to the teaching feature.

**Source:** [router.py](../backend/app/features/teaching/router.py), lines 139–145.

#### 4. Save the file and link it to the draft item

```python
if item.kind != "file":
    fail(422, "kind_mismatch", "Only file items take an uploaded file.")
draft = locked_draft(db, item, expected_counter)
file = save_upload(db, upload, "material", actor, MATERIAL_TYPES)
draft.file_id = file.id
draft.draft_counter += 1
db.commit()
```

**In plain language:** The service first checks that the item is meant to contain a file. It checks the draft version, saves the uploaded file using the shared file-saving function, links the saved file to the draft, and commits the database update.

**Source:** [items.py](../backend/app/features/teaching/items.py), lines 183–190.

**In short:** The file's contents are stored privately. The database keeps the file's record and its connection to the course item. The shared upload function also checks file rules such as allowed types and size.

### D. Faculty creates a quiz or activity

The faculty member picks a type of classwork and provides basic details. The server checks access and creates a draft assessment.

#### Frontend: choose the kind

```tsx
{label: 'Quizzes', options: [
  ['Online quiz', {type: 'assessment', kind: 'online_quiz'}],
]},
{label: 'Activities', options: [
  ['Activity', {type: 'assessment', kind: 'activity'}],
]},
```

**In plain language:** This menu offers an online quiz under Quizzes and an activity under Activities. The `kind` value tells the rest of the application what the faculty member selected.

#### Frontend: send the new assessment information

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

**In plain language:** `post(...)` sends information to the backend to create an assessment. It includes the assessment type, its title, the sections that should receive it, and an optional link to a syllabus topic. The page then handles the created assessment.

**Frontend sources:** [Classwork.tsx](../frontend/src/features/teaching/Classwork.tsx), lines 29–30; [Assessments.tsx](../frontend/src/features/assessments/Assessments.tsx), lines 18–23.

#### Backend: check the faculty member and create a draft

```python
@router.post(T + "/assessments", status_code=201)
def create_assessment(offering_id: UUID, data: AssessmentCreate,
                      actor=Depends(faculty), db: Session = Depends(get_db)):
    offering = own(db, offering_id, actor)
    return definitions.assessment_view(
        db, definitions.create(db, actor, offering, data)
    )
```

**In plain language:** The route requires a faculty account, checks that the faculty member owns the subject, and asks the assessment feature to create the assessment. `status_code=201` means the request successfully created a new record.

**Backend source:** [assessments/router.py](../backend/app/features/assessments/router.py), lines 99–103. The draft and questions are handled in [assessments/definitions.py](../backend/app/features/assessments/definitions.py), lines 153–178.

### E. Student opens an enrolled subject and views its materials

First, the student page loads the subjects connected to that student's enrollments.

#### Frontend

```tsx
const query = useQuery({
  queryKey: ['my-subjects'],
  queryFn: () => api<MySubject[]>('/me/subjects'),
});
```

**In plain language:** The page asks the backend for the signed-in student's subjects and expects a list in return.

**Source:** [Rosters.tsx](../frontend/src/features/academics/Rosters.tsx), line 106.

#### Backend

```python
@router.get("/me/subjects")
def my_subjects(actor=Depends(student), db: Session = Depends(get_db)):
    return queries.my_subjects(db, actor)
```

**In plain language:** The backend requires a student account and returns the subjects associated with that student. The database query filters using the signed-in student's account.

**Source:** [academics/router.py](../backend/app/features/academics/router.py), lines 288–290; the enrollment filtering is in [academics/queries.py](../backend/app/features/academics/queries.py), lines 236–245.

After the student selects a subject, its learning materials are requested:

```tsx
const items = useQuery({
  queryKey: ['learn-items', offering.id],
  queryFn: () => api<LearnItem[]>(
    `/learn/offerings/${offering.id}/items`
  ),
});
```

**In plain language:** The URL includes the selected subject's ID, so the server knows which subject's materials to load.

**Source:** [Learn.tsx](../frontend/src/features/teaching/Learn.tsx), line 39.

```python
@router.get("/learn/offerings/{offering_id}/items")
def learn_items(offering_id: UUID, actor=Depends(student),
                db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(db, offering_id, actor)
    return items.student_items(db, offering, enrollment, actor.id)
```

**In plain language:** Before returning materials, the backend confirms the student is enrolled in that subject. It returns published items that are available to the student's section.

**Backend source:** [teaching/router.py](../backend/app/features/teaching/router.py), lines 246–249; the item filtering is in [teaching/items.py](../backend/app/features/teaching/items.py), lines 279–313.

### F. Student answers a quiz or submits an activity

For a quiz, the page saves answers and then sends a submit request. For an activity, the page uploads a file.

#### Frontend: save and submit quiz answers

```tsx
await send('PUT', `${url}/answers`, {
  answers: {[active.key]: sent[active.key]},
});

const result = await post(`${url}/submit`, {
  idempotency_key: submitKey.current,
  answers: active ? {[active.key]: latest.current[active.key]} : {},
});
```

**In plain language:** The first request saves the answer to the current question. The second tells the server that the student is submitting the quiz. The submission key helps the server recognize a repeated submit request as the same action.

**Source:** [Work.tsx](../frontend/src/features/assessments/Work.tsx), lines 180 and 209–212.

#### Frontend: upload an activity file

```tsx
const form = new FormData(e.currentTarget);
await upload(
  `/learn/offerings/${offering.id}/assessments/${item!.id}/submissions`,
  form
);
```

**In plain language:** The form's fields, including the selected file, are packaged and uploaded to the activity submission URL. The subject ID and activity ID tell the backend where this submission belongs.

**Source:** [Work.tsx](../frontend/src/features/assessments/Work.tsx), lines 70–74.

#### Backend: check enrollment and pass the work to the assessment feature

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

**In plain language:** Both routes require a student who can make changes in the subject. One passes quiz answers to the quiz service. The other confirms the assessment is an activity, passes the uploaded file to the submission service, and returns a view of the saved submission.

**Backend source:** [assessments/router.py](../backend/app/features/assessments/router.py), lines 309–313 and 330–335. The quiz submit route is at lines 323–327.

### G. System records answers, scores, and activity submissions

#### Record and score a quiz

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

**In plain language:** The answer is connected to the student's quiz attempt and the question. When the quiz is submitted, the system saves the calculated score and maximum possible score, updates the assessment score record, and releases the result according to the assessment's release process.

**Source:** [attempts.py](../backend/app/features/assessments/attempts.py), lines 90–98 and 127–131. Score calculation is in `finalize`, lines 100–131.

#### Record an activity file submission

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

**In plain language:** The uploaded file is stored privately. Then the database saves a submission record containing links to the activity, its version, the student, and the stored file. `commit()` saves the database changes.

**Source:** [submissions.py](../backend/app/features/assessments/submissions.py), lines 67–88.

**End-to-end in simple terms:** The pages send requests; the backend checks access and handles the request; PostgreSQL keeps records for course content, attempts, answers, submissions, and scores. The actual uploaded file contents are in private file storage, while the database keeps the file record and links.

## 5. Database integration and data flow

LearnSync uses one PostgreSQL database. The arrows below mean that one record is connected to another:

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

**In plain language:** An offering is a subject taught in a particular class. Its syllabus, materials, and assessments are connected to it. A quiz attempt belongs to a student and a particular assessment version. Answers belong to that attempt. An activity submission points to the assessment version and the uploaded file.

### Quiz attempt and answer records

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

**In plain language:** `QuizAttempt` stores who took which assessment version and the resulting score. `QuizAnswer` stores a response for a question and connects it to that attempt. `ForeignKey(...)` is the database's way of linking one record to another.

**Source:** [models.py](../backend/app/features/assessments/models.py), lines 144–172.

### Activity submission and assessment score records

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

**In plain language:** An activity submission record points to its student, activity, assessment version, and private file. The score record can point to the quiz attempt or activity submission used for that score.

**Source:** [models.py](../backend/app/features/assessments/models.py), lines 179–220.

### Data flow from teacher to student

1. The faculty member saves a draft. The backend stores it in PostgreSQL.
2. The faculty member publishes the draft. The published version is what students can see.
3. A quiz attempt records which assessment version the student took.
4. Answers are saved under that attempt, and the system records a score.
5. An activity submission links the student and assessment version to a private uploaded file.
6. When a result is released, the student can see it.

This linking preserves the history of what was published and what each student answered or submitted.

## 6. Demonstrate a quiz with sample data

When the student starts a quiz, the frontend asks the backend to create an attempt and then opens the attempt page.

### Frontend: start the attempt and navigate to it

```tsx
const attempt = await post<AttemptView>(
  `/learn/offerings/${offering.id}/assessments/${item.id}/attempts`,
  {}
);

navigate(
  `${base}/${item.id}/attempts/${attempt.id}`
);
```

**In plain language:** The first call asks the backend to start a quiz for this subject and assessment. The server returns the new attempt's ID. `navigate(...)` then opens the page for that particular attempt.

**Source:** [Work.tsx](../frontend/src/features/assessments/Work.tsx), line 67.

### Backend: create and save the attempt

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

**In plain language:** The backend creates an attempt connected to the student and the published quiz version. It adds the attempt to the database session, prepares the quiz questions, sets up the first question when available, saves everything with `commit()`, and returns the attempt.

**Source:** [attempts.py](../backend/app/features/assessments/attempts.py), lines 237–260.

### Suggested demonstration

Sign in using an existing student account enrolled in a sample subject. Open a published quiz, start it, answer a question, and submit. Show the status or score only if it is actually returned by the running system. Use an existing test/demo quiz and account; do not describe made-up results as live output.
