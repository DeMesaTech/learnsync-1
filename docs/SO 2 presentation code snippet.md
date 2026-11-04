Here are presentation-ready snippets for **items 3–6** from the first image. They’re excerpts from the existing project code.

### 3. Show how the feature is integrated into the existing system

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

### 4. Demonstrate how modules communicate

The assessment route checks the student’s course access and assessment eligibility, then delegates attempt creation to the quiz-attempt module.

```python
@router.post(L + "/assessments/{assessment_id}/attempts",
             status_code=201)
def start_attempt(offering_id: UUID, assessment_id: UUID,
                  actor=Depends(student), db: Session = Depends(get_db)):
    offering, enrollment = learner_offering(
        db, offering_id, actor, write=True
    )
    assessment, _ = learner.student_assessment(
        db, offering, enrollment, assessment_id, "online_quiz"
    )
    return attempts.student_view(
        db, attempts.start(db, actor, assessment)
    )
```
**File and lines:** [router.py](../backend/app/features/assessments/router.py), lines 294–299.

**Explain:** “The route coordinates the work: access checks happen first, then the learner module validates the quiz, and the attempts module starts or resumes the student’s attempt.”  
Source: `assessments/router.py`

### 5. Show database integration and explain the data flow

A learning-item revision is stored in PostgreSQL and linked to its parent item; uploaded files are referenced by a foreign key.

```python
class LearningItemRevision(Base):
    __tablename__ = "learning_item_revision"

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learning_item.id"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(12), default="draft")
    title: Mapped[str] = mapped_column(String(200), default="")
    body_html: Mapped[str] = mapped_column(Text, default="")
    file_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stored_file.id")
    )
```
**File and lines:** [models.py](../backend/app/features/teaching/models.py), lines 77–95.

**Explain:** “The teacher’s content is saved as a revision connected to its course item. Publishing changes its state, while earlier revisions can be retained as history.”  
Source: `teaching/models.py`

### 6. Demonstrate actual functionality with sample data

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