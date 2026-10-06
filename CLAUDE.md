# LearnSync v2

Read docs/IMPLEMENTATION_PLAN.md before implementation. It is the approved product baseline. Latest human decisions take precedence over source documents, prototype, and old code.

Implement milestones in order and run each gate before continuing. Record actual checks and blockers in docs/ACCEPTANCE.md. Continue autonomously; report missing external credentials without pretending integrations passed.

Use feature slices with direct command/query functions and one Postgres database. Keep authenticated role/ownership checks on the server. Preserve published academic history and recoverable drafts.

Old project C:/Dev/others/learnsync is read-only reference. This project uses a fresh database; never mount old SQL or reuse its database.

Before UI work read docs/DESIGN_SYSTEM.md; before API/schema work read docs/ARCHITECTURE.md; for execution and recovery read docs/OPERATIONS.md. Source artifacts remain in docs; channel records remain in docs/comms.
