# Admin Side Revisions

## User Account Tab

- Table list
- Email error (`503`)

```json
{
  "error": {
    "code": "email_unavailable",
    "message": "Email could not be sent. Please try again.",
    "field_errors": {},
    "request_id": "6c6f7c10-d256-4fda-8023-831b4721e0bb"
  }
}
```

### Console/Error Notes

```text
client:733 [vite] connecting...
client:827 [vite] connected.
api.ts:8  POST http://127.0.0.1:5173/api/accounts/5ca1c991-9961-46ee-a7c4-8f87b033a097/send-link 503 (Service Unavailable)
api @ api.ts:8
(anonymous) @ AccountPage.tsx:13
(anonymous) @ mutation.ts:301
```

- Send bulk email

## Sections

- Manage section
- Table form
  - Manage students
    - Delete: rename "withdraw" to "delete"
    - Add reason for deletion

## Add Teacher Page

- Modal for individual addition
- Import from file for bulk list

## Assignment of Subjects to Teachers

- Modal
  - Add `+` button for multiple subject assignments per teacher
  - Each subject may have assigned sections

### Table List

 |   Teacher    |  Subject  |  Section  | Number of enrolled |
 |--------------|-----------|-----------|---:----------------|
 | Teacher name | Subject 1 | Section 1 |          0         |
 |              | Subject 2 | Section 2 |          0         |
 |--------------|-----------|-----------|---:----------------|
 | Teacher name | Subject 1 | Section 1 |          0         |
 |              | Subject 2 | Section 2 |          0         |
 |--------------|-----------|-----------|---:----------------|

### Requirements

- Use one row per subject-section assignment so a teacher can have multiple subjects, each with its own assigned section and enrollment count.
- Allow editing: update and delete

## Summary


- Manage student
  - Import student
- Manage section
  - Add teacher
  - Import
- Manage subject
  - Assignment