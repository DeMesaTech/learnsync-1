# LearnSync: Update Sections Tab UI and Add College Grouping to the Database

Analyze the existing LearnSync repository, uploaded reference images, database schema, backend models, API routes, and migration history before making changes.

## 1. Update the Sections Tab Using the Uploaded Images

Use the uploaded images as your design reference:
- **Original image:** the current LearnSync frontend.
- **Figma image:** the new design to implement.

Update the existing **Sections tab layout** to match the Figma design as closely as possible.

Requirements:
- Replace only the current Sections tab layout with the Figma design.
- Preserve the existing application's overall design system, navigation, sidebar, and unrelated pages.
- Keep existing working functionality, backend integration, and database operations.
- Connect the redesigned interface to the existing backend rather than using hardcoded or mock data.
- Preserve existing section creation, editing, viewing, and other working operations.
- Make the layout responsive and consistent with the current application.
- Inspect the existing implementation before changing components; reuse components and styles where appropriate.
- Do not redesign unrelated pages or features.

## 2. Correct the Database Structure

The current LearnSync database already has a `subject` table that represents the course/program. **Do not create a separate `course` or `program` table.**

The missing entity is `college`, which groups existing subjects (courses/programs).

### Create the `college` table

Follow the existing database conventions and include appropriate fields:
- `id` — primary key using the existing ID strategy.
- `code` — unique college code.
- `name` — college name.
- `description` — optional description.
- `status` — active/inactive status, if consistent with the existing schema.
- `created_at` and `updated_at` — if consistent with existing tables.

### Connect colleges to existing subjects

Add a nullable `college_id` foreign key to the existing `subject` table, referencing `college.id`.

The intended relationship is:

`College → Subject (Course/Program) → Existing LearnSync records`

Requirements:
- Preserve all existing `subject` columns and their meanings.
- Do not rename `subject`.
- Do not create duplicate course/program entities.
- Allow existing subjects to remain unassigned to a college during migration.
- Prevent accidental deletion of colleges that still have associated subjects.
- Do not arbitrarily assign existing subjects to colleges.

## 3. Preserve Existing Database Relationships

Inspect and preserve existing tables, primary keys, foreign keys, and data, particularly:
- `subject`
- `offering`
- `offering_section`
- `section`
- `enrollment`
- `academic_term`
- `school_year`
- Attendance, quizzes, activities, grading, and submission-related tables.

Do not recreate tables or remove existing records. Do not introduce unnecessary schema changes.

## 4. Backend and API Integration

Update the existing backend to support college grouping:
- Add database models and migration for the `college` table.
- Add `college_id` to the existing subject model and relevant schemas.
- Implement college creation, listing, viewing, updating, and other necessary CRUD operations, following existing project patterns.
- Allow subjects to be assigned to a college and filtered by college.
- Return college information in relevant API responses where needed.
- Apply existing authentication, authorization, and validation rules.
- Ensure existing functionality continues to work for subjects without an assigned college.

Connect the redesigned Sections tab to the appropriate existing APIs and updated backend. Do not break current section, offering, enrollment, or term-related functionality.

## 5. Migration and Testing

- Use the project's existing migration system, such as Alembic if applicable.
- Make the migration safe for existing data.
- Test college creation and subject assignment.
- Verify that existing sections, offerings, enrollments, and grading records remain intact.
- Test the redesigned Sections tab against real backend data.
- Check for API errors, broken interactions, and regressions.
- Provide rollback steps where supported.

## 6. Final Deliverables

After implementation, report:
1. The files changed for the Sections tab UI.
2. The files changed for database and backend integration.
3. The migration created and how to apply it.
4. Any API endpoints added or updated.
5. The tests performed and their results.

**Final constraints:**
- Implement the Figma design in the Sections tab using the uploaded images as references.
- Add college grouping to the database.
- Treat the existing `subject` table as the course/program entity.
- Do not create a separate course/program table.
- Preserve existing data, working features, and unrelated UI.
- Inspect the project before making changes, and avoid unnecessary rewrites.