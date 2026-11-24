# LearnSync v2 database schema

Extracted from `learnsync_v2_full.dump` using PostgreSQL 18.4 `pg_restore --schema-only`; table data is excluded.

This reference lists all 50 tables in the `public` schema and their columns. The `key` column marks primary keys (`PK`) and foreign keys (`FK -> table.column`); `-` means the column has neither. Other constraints (such as `UNIQUE` and `CHECK`) are not included.

## `academic_term`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `school_year`.`id` | `school_year_id` |
| - | `name` |
| - | `sequence` |
| - | `start_date` |
| - | `end_date` |
| - | `status` |
| - | `closed_at` |
| FK -> `account`.`id` | `closed_by` |
| - | `reopened_reason` |

## `account`

| key | column name |
| --- | --- |
| PK | `id` |
| - | `email` |
| - | `display_name` |
| - | `role` |
| - | `student_number` |
| - | `password_hash` |
| - | `status` |
| - | `email_verified_at` |
| - | `ownership_generation` |
| - | `preferences` |
| - | `created_at` |
| FK -> `college`.`id` | `college_id` |
| - | `first_name` |
| - | `middle_name` |
| - | `last_name` |
| - | `suffix` |

## `account_token`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `account`.`id` | `account_id` |
| - | `purpose` |
| - | `token_hash` |
| - | `expires_at` |
| - | `consumed_at` |
| FK -> `account`.`id` | `initiated_by` |
| - | `payload` |

## `activity_submission`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `assessment`.`id` | `assessment_id` |
| FK -> `assessment_revision`.`id` | `revision_id` |
| FK -> `account`.`id` | `student_id` |
| - | `version` |
| FK -> `stored_file`.`id` | `file_id` |
| - | `note` |
| - | `is_late` |
| - | `submitted_at` |

## `ai_generation`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `account`.`id` | `faculty_id` |
| FK -> `assessment`.`id` | `assessment_id` |
| - | `source_item_ids` |
| - | `settings` |
| - | `model` |
| - | `status` |
| - | `error_code` |
| - | `created_at` |

## `alembic_version`

| key | column name |
| --- | --- |
| PK | `version_num` |

## `announcement`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| - | `title` |
| - | `body` |
| - | `state` |
| FK -> `account`.`id` | `author_id` |
| - | `created_at` |
| - | `published_at` |

## `announcement_section`

| key | column name |
| --- | --- |
| PK<br>FK -> `announcement`.`id` | `announcement_id` |
| PK<br>FK -> `section`.`id` | `section_id` |

## `assessment`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| - | `kind` |
| - | `archived` |
| FK -> `account`.`id` | `created_by` |
| - | `created_at` |

## `assessment_revision`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `assessment`.`id` | `assessment_id` |
| - | `version` |
| - | `state` |
| - | `draft_counter` |
| - | `title` |
| - | `instructions` |
| - | `category_key` |
| - | `period` |
| - | `max_points` |
| - | `available_from` |
| - | `deadline` |
| - | `allow_late` |
| - | `max_attempts` |
| - | `score_rule` |
| - | `include_in_grade` |
| - | `anchor_node_id` |
| FK -> `account`.`id` | `created_by` |
| FK -> `account`.`id` | `published_by` |
| - | `created_at` |
| - | `updated_at` |
| - | `published_at` |
| - | `ai_generated` |
| - | `reviewed_counter` |
| FK -> `account`.`id` | `reviewed_by` |
| - | `ai_language` |

## `assessment_score`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `assessment`.`id` | `assessment_id` |
| FK -> `account`.`id` | `student_id` |
| - | `score` |
| - | `feedback` |
| FK -> `quiz_attempt`.`id` | `selected_attempt_id` |
| FK -> `activity_submission`.`id` | `selected_submission_id` |
| - | `revision` |
| FK -> `account`.`id` | `graded_by` |
| - | `updated_at` |

## `assessment_section`

| key | column name |
| --- | --- |
| PK<br>FK -> `assessment`.`id` | `assessment_id` |
| PK<br>FK -> `section`.`id` | `section_id` |

## `attendance_mark`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `attendance_session`.`id` | `session_id` |
| FK -> `account`.`id` | `student_id` |
| - | `status` |

## `attendance_session`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `section`.`id` | `section_id` |
| - | `session_date` |
| - | `period` |
| FK -> `account`.`id` | `created_by` |
| - | `created_at` |

## `audit_event`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `account`.`id` | `actor_id` |
| - | `actor_label` |
| - | `ownership_generation` |
| - | `action` |
| - | `entity_type` |
| - | `entity_id` |
| - | `details` |
| - | `created_at` |

## `auth_session`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `account`.`id` | `account_id` |
| - | `token_hash` |
| - | `csrf` |
| - | `created_at` |
| - | `last_seen_at` |
| - | `expires_at` |
| - | `revoked_at` |

## `college`

| key | column name |
| --- | --- |
| PK | `id` |
| - | `code` |
| - | `name` |
| - | `description` |
| - | `status` |
| - | `created_at` |
| - | `updated_at` |

## `content_chunk`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `learning_item`.`id` | `item_id` |
| FK -> `learning_item_revision`.`id` | `revision_id` |
| - | `ordinal` |
| - | `title` |
| - | `locator` |
| - | `anchor_node_id` |
| - | `text` |
| - | `tsv` |

## `enrollment`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `account`.`id` | `student_id` |
| FK -> `section`.`id` | `section_id` |
| - | `source` |
| - | `status` |
| - | `created_at` |
| - | `updated_at` |

## `enrollment_exception`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `account`.`id` | `student_id` |
| - | `action` |
| FK -> `section`.`id` | `section_id` |
| - | `reason` |
| FK -> `account`.`id` | `actor_id` |
| - | `created_at` |

## `faculty_import`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `stored_file`.`id` | `file_id` |
| - | `rows` |
| - | `status` |
| FK -> `account`.`id` | `created_by` |
| - | `created_at` |
| - | `committed_at` |

## `grade_publication`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `account`.`id` | `student_id` |
| - | `period` |
| - | `release_number` |
| - | `grade` |
| - | `remark` |
| - | `policy_version` |
| - | `snapshot` |
| FK -> `account`.`id` | `published_by` |
| - | `published_at` |

## `grade_review_state`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `account`.`id` | `student_id` |
| - | `period` |
| - | `needs_review` |
| - | `reason` |
| - | `changed_at` |

## `issue_report`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `account`.`id` | `reporter_id` |
| - | `type` |
| - | `title` |
| - | `description` |
| - | `page` |
| - | `status` |
| - | `admin_note` |
| FK -> `account`.`id` | `reviewed_by` |
| - | `reviewed_at` |
| - | `created_at` |
| - | `updated_at` |

## `learning_event`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `account`.`id` | `student_id` |
| FK -> `offering`.`id` | `offering_id` |
| - | `event_type` |
| - | `resource_id` |
| - | `ref_id` |
| - | `occurred_at` |

## `learning_item`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| - | `kind` |
| - | `archived` |
| FK -> `account`.`id` | `created_by` |
| - | `created_at` |
| - | `position` |

## `learning_item_revision`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `learning_item`.`id` | `item_id` |
| - | `version` |
| - | `state` |
| - | `draft_counter` |
| - | `title` |
| - | `body_html` |
| FK -> `stored_file`.`id` | `file_id` |
| - | `reference_url` |
| - | `reference_note` |
| - | `anchor_node_id` |
| FK -> `account`.`id` | `created_by` |
| FK -> `account`.`id` | `published_by` |
| - | `created_at` |
| - | `updated_at` |
| - | `published_at` |
| - | `index_state` |

## `learning_item_section`

| key | column name |
| --- | --- |
| PK<br>FK -> `learning_item`.`id` | `item_id` |
| PK<br>FK -> `section`.`id` | `section_id` |

## `lesson_completion`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `account`.`id` | `student_id` |
| FK -> `learning_item`.`id` | `item_id` |
| - | `revision_version` |
| - | `completed_at` |

## `offering`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `subject`.`id` | `subject_id` |
| FK -> `academic_term`.`id` | `term_id` |
| FK -> `account`.`id` | `faculty_id` |
| - | `status` |
| - | `created_at` |
| - | `meeting_days` |

## `offering_section`

| key | column name |
| --- | --- |
| PK<br>FK -> `offering`.`id` | `offering_id` |
| PK<br>FK -> `section`.`id` | `section_id` |
| FK -> `offering`.`subject_id` | `subject_id` |

## `prospectus_import`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `stored_file`.`id` | `file_id` |
| - | `draft` |
| - | `warnings` |
| - | `revision` |
| - | `status` |
| FK -> `account`.`id` | `created_by` |
| - | `created_at` |
| - | `committed_at` |

## `quiz_answer`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `quiz_attempt`.`id` | `attempt_id` |
| - | `question_key` |
| - | `response` |
| - | `auto_awarded` |
| - | `awarded` |
| FK -> `account`.`id` | `corrected_by` |
| - | `correction_reason` |

## `quiz_attempt`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `assessment`.`id` | `assessment_id` |
| FK -> `assessment_revision`.`id` | `revision_id` |
| FK -> `account`.`id` | `student_id` |
| - | `attempt_number` |
| - | `state` |
| - | `started_at` |
| - | `submitted_at` |
| - | `score` |
| - | `max_score` |
| - | `idempotency_key` |

## `quiz_question`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `assessment_revision`.`id` | `revision_id` |
| - | `key` |
| - | `position` |
| - | `type` |
| - | `prompt` |
| - | `choices` |
| - | `correct` |
| - | `explanation` |
| - | `points` |
| - | `source` |
| - | `duration_minutes` |
| - | `duration_seconds` |

## `quiz_question_clock`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `quiz_attempt`.`id` | `attempt_id` |
| - | `question_key` |
| - | `started_at` |
| - | `expires_at` |
| - | `locked_at` |
| - | `paused_at` |
| - | `status` |

## `reference_snapshot`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `learning_item_revision`.`id` | `revision_id` |
| - | `source_url` |
| - | `text` |
| - | `status` |
| - | `method` |
| FK -> `account`.`id` | `created_by` |
| FK -> `account`.`id` | `approved_by` |
| - | `created_at` |
| - | `approved_at` |

## `result_publication`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `assessment`.`id` | `assessment_id` |
| FK -> `account`.`id` | `student_id` |
| - | `release_number` |
| - | `score` |
| - | `max_points` |
| - | `feedback` |
| - | `source` |
| FK -> `account`.`id` | `published_by` |
| - | `published_at` |

## `school_year`

| key | column name |
| --- | --- |
| PK | `id` |
| - | `label` |
| - | `start_date` |
| - | `end_date` |
| - | `created_at` |

## `section`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `academic_term`.`id` | `term_id` |
| - | `name` |
| - | `year_level` |
| FK -> `college`.`id` | `college_id` |

## `section_member`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `section`.`id` | `section_id` |
| FK -> `academic_term`.`id` | `term_id` |
| FK -> `account`.`id` | `student_id` |
| - | `status` |
| - | `created_at` |

## `stored_file`

| key | column name |
| --- | --- |
| PK | `id` |
| - | `original_name` |
| - | `content_type` |
| - | `size` |
| - | `sha256` |
| - | `storage_key` |
| - | `purpose` |
| FK -> `account`.`id` | `uploader_id` |
| - | `created_at` |

## `student_import`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `stored_file`.`id` | `file_id` |
| FK -> `academic_term`.`id` | `term_id` |
| - | `rows` |
| - | `status` |
| FK -> `account`.`id` | `created_by` |
| - | `created_at` |
| - | `committed_at` |

## `study_conversation`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `account`.`id` | `student_id` |
| FK -> `offering`.`id` | `offering_id` |
| - | `title` |
| - | `created_at` |
| - | `updated_at` |

## `study_message`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `study_conversation`.`id` | `conversation_id` |
| - | `role` |
| - | `content` |
| - | `sources` |
| - | `model` |
| - | `client_message_id` |
| FK -> `study_message`.`id` | `reply_to_id` |
| - | `created_at` |
| - | `suggestions` |
| - | `analogy` |

## `subject`

| key | column name |
| --- | --- |
| PK | `id` |
| - | `code` |
| - | `title` |
| - | `units` |
| - | `year_level` |
| - | `semester` |
| - | `description` |
| - | `status` |
| FK -> `college`.`id` | `college_id` |
| - | `prerequisite` |

## `submission_permission`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `assessment`.`id` | `assessment_id` |
| FK -> `account`.`id` | `student_id` |
| - | `reason` |
| - | `expires_at` |
| - | `consumed_at` |
| FK -> `account`.`id` | `granted_by` |
| - | `created_at` |

## `syllabus`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| - | `created_at` |

## `syllabus_revision`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `syllabus`.`id` | `syllabus_id` |
| - | `version` |
| - | `state` |
| - | `draft_counter` |
| - | `outline` |
| - | `grading_policy` |
| FK -> `stored_file`.`id` | `source_file_id` |
| FK -> `account`.`id` | `created_by` |
| FK -> `account`.`id` | `published_by` |
| - | `created_at` |
| - | `updated_at` |
| - | `published_at` |

## `teaching_coverage`

| key | column name |
| --- | --- |
| PK | `id` |
| FK -> `offering`.`id` | `offering_id` |
| FK -> `section`.`id` | `section_id` |
| - | `node_id` |
| - | `covered_on` |
| FK -> `account`.`id` | `recorded_by` |
| - | `created_at` |


## Role-based crow-foot relationship lists

The parent-to-child connections below are checked against the foreign keys in this schema. The existing `||────────o{` cardinality notation is retained. These are role-focused lists, not exhaustive lists of every foreign key.

### 1. Admin ERD

#### Account / system

```text
COLLEGE       ||────────o{ ACCOUNT
ACCOUNT       ||────────o{ ACCOUNT_TOKEN
ACCOUNT       ||────────o{ AUTH_SESSION
ACCOUNT       ||────────o{ AUDIT_EVENT
ACCOUNT       ||────────o{ ANNOUNCEMENT
ACCOUNT       ||────────o{ FACULTY_IMPORT
ACCOUNT       ||────────o{ STUDENT_IMPORT
ACCOUNT       ||────────o{ PROSPECTUS_IMPORT
```

#### Academic structure

```text
COLLEGE       ||────────o{ SUBJECT
COLLEGE       ||────────o{ SECTION
SCHOOL_YEAR   ||────────o{ ACADEMIC_TERM
ACADEMIC_TERM ||────────o{ SECTION
SUBJECT       ||────────o{ OFFERING
ACADEMIC_TERM ||────────o{ OFFERING
OFFERING      ||────────o{ OFFERING_SECTION
SECTION       ||────────o{ OFFERING_SECTION
SECTION       ||────────o{ SECTION_MEMBER
ACCOUNT       ||────────o{ SECTION_MEMBER
ACCOUNT       ||────────o{ ENROLLMENT
SECTION       ||────────o{ ENROLLMENT
OFFERING      ||────────o{ ENROLLMENT
ACCOUNT       ||────────o{ ENROLLMENT_EXCEPTION
SECTION       ||────────o{ ENROLLMENT_EXCEPTION
OFFERING      ||────────o{ ENROLLMENT_EXCEPTION
```

### 2. Teacher ERD

#### Teacher / teaching assignments

```text
ACCOUNT       ||────────o{ TEACHING_COVERAGE
SECTION       ||────────o{ TEACHING_COVERAGE
OFFERING      ||────────o{ TEACHING_COVERAGE
SUBJECT       ||────────o{ OFFERING
ACADEMIC_TERM ||────────o{ OFFERING
OFFERING      ||────────o{ OFFERING_SECTION
SECTION       ||────────o{ OFFERING_SECTION
```

#### Learning materials

```text
ACCOUNT               ||────────o{ LEARNING_ITEM
LEARNING_ITEM          ||────────o{ LEARNING_ITEM_REVISION
LEARNING_ITEM          ||────────o{ LEARNING_ITEM_SECTION
SECTION                ||────────o{ LEARNING_ITEM_SECTION
LEARNING_ITEM_REVISION ||────────o{ CONTENT_CHUNK
ACCOUNT                ||────────o{ LESSON_COMPLETION
LEARNING_ITEM          ||────────o{ LESSON_COMPLETION
ACCOUNT                ||────────o{ LEARNING_EVENT
```

#### Assessment / quiz management

```text
ACCOUNT             ||────────o{ ASSESSMENT
ASSESSMENT          ||────────o{ ASSESSMENT_REVISION
ASSESSMENT          ||────────o{ ASSESSMENT_SECTION
SECTION             ||────────o{ ASSESSMENT_SECTION
ASSESSMENT_REVISION ||────────o{ QUIZ_QUESTION
ASSESSMENT          ||────────o{ QUIZ_ATTEMPT
ACCOUNT             ||────────o{ QUIZ_ATTEMPT
QUIZ_ATTEMPT        ||────────o{ QUIZ_ANSWER
QUIZ_ATTEMPT        ||────────o{ QUIZ_QUESTION_CLOCK
```

#### Submissions / attendance / grades

```text
ACCOUNT             ||────────o{ ACTIVITY_SUBMISSION
ASSESSMENT          ||────────o{ ACTIVITY_SUBMISSION
ASSESSMENT_REVISION ||────────o{ ACTIVITY_SUBMISSION
ACCOUNT             ||────────o{ SUBMISSION_PERMISSION
ASSESSMENT          ||────────o{ SUBMISSION_PERMISSION
SECTION             ||────────o{ ATTENDANCE_SESSION
ATTENDANCE_SESSION  ||────────o{ ATTENDANCE_MARK
ACCOUNT             ||────────o{ ATTENDANCE_MARK
ASSESSMENT          ||────────o{ ASSESSMENT_SCORE
ACCOUNT             ||────────o{ ASSESSMENT_SCORE
ACCOUNT             ||────────o{ GRADE_PUBLICATION
ACCOUNT             ||────────o{ GRADE_REVIEW_STATE
ACCOUNT             ||────────o{ RESULT_PUBLICATION
```

#### Teacher announcements / supporting

```text
ACCOUNT       ||────────o{ ANNOUNCEMENT
ANNOUNCEMENT  ||────────o{ ANNOUNCEMENT_SECTION
SECTION       ||────────o{ ANNOUNCEMENT_SECTION
ACCOUNT       ||────────o{ AI_GENERATION
ACCOUNT       ||────────o{ ISSUE_REPORT
OFFERING      ||────────o{ SYLLABUS
SYLLABUS      ||────────o{ SYLLABUS_REVISION
```

### 3. Student ERD

#### Student / enrollment / class

```text
ACCOUNT       ||────────o{ ENROLLMENT
SECTION       ||────────o{ ENROLLMENT
OFFERING      ||────────o{ ENROLLMENT
SECTION       ||────────o{ SECTION_MEMBER
ACCOUNT       ||────────o{ SECTION_MEMBER
SUBJECT       ||────────o{ OFFERING
ACADEMIC_TERM ||────────o{ OFFERING
OFFERING      ||────────o{ OFFERING_SECTION
SECTION       ||────────o{ OFFERING_SECTION
```

#### Learning materials / lesson progress

```text
LEARNING_ITEM          ||────────o{ LEARNING_ITEM_REVISION
LEARNING_ITEM          ||────────o{ LEARNING_ITEM_SECTION
SECTION                ||────────o{ LEARNING_ITEM_SECTION
LEARNING_ITEM_REVISION ||────────o{ CONTENT_CHUNK
ACCOUNT                ||────────o{ LESSON_COMPLETION
LEARNING_ITEM          ||────────o{ LESSON_COMPLETION
ACCOUNT                ||────────o{ LEARNING_EVENT
```

#### Quizzes / attempts / answers

```text
ASSESSMENT          ||────────o{ ASSESSMENT_REVISION
ASSESSMENT          ||────────o{ ASSESSMENT_SECTION
SECTION             ||────────o{ ASSESSMENT_SECTION
ASSESSMENT_REVISION ||────────o{ QUIZ_QUESTION
ACCOUNT             ||────────o{ QUIZ_ATTEMPT
ASSESSMENT          ||────────o{ QUIZ_ATTEMPT
QUIZ_ATTEMPT        ||────────o{ QUIZ_ANSWER
QUIZ_ATTEMPT        ||────────o{ QUIZ_QUESTION_CLOCK
```

#### Activity submission / attendance / grades

```text
ACCOUNT             ||────────o{ ACTIVITY_SUBMISSION
ASSESSMENT          ||────────o{ ACTIVITY_SUBMISSION
ASSESSMENT_REVISION ||────────o{ ACTIVITY_SUBMISSION
ACCOUNT             ||────────o{ SUBMISSION_PERMISSION
ASSESSMENT          ||────────o{ SUBMISSION_PERMISSION
SECTION             ||────────o{ ATTENDANCE_SESSION
ATTENDANCE_SESSION  ||────────o{ ATTENDANCE_MARK
ACCOUNT             ||────────o{ ATTENDANCE_MARK
ASSESSMENT          ||────────o{ ASSESSMENT_SCORE
ACCOUNT             ||────────o{ ASSESSMENT_SCORE
ACCOUNT             ||────────o{ GRADE_REVIEW_STATE
ACCOUNT             ||────────o{ RESULT_PUBLICATION
```

#### Student study tools

```text
ACCOUNT             ||────────o{ STUDY_CONVERSATION
STUDY_CONVERSATION  ||────────o{ STUDY_MESSAGE
ACCOUNT             ||────────o{ AI_GENERATION
ACCOUNT             ||────────o{ ISSUE_REPORT
```

### 4. Shared tables

Reuse these entity names when they appear in more than one role-focused list:

- `ACCOUNT`
- `COLLEGE`
- `SCHOOL_YEAR`
- `ACADEMIC_TERM`
- `SUBJECT`
- `SECTION`
- `SECTION_MEMBER`
- `ENROLLMENT`
- `OFFERING`
- `OFFERING_SECTION`
- `STORED_FILE`
- `AUDIT_EVENT`
- `AUTH_SESSION`
- `ACCOUNT_TOKEN`