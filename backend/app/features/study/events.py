"""Progress-event writer. Kept free of other feature imports so assessments can call it."""
import uuid

from sqlalchemy.dialects.postgresql import insert

from app.features.accounts.models import now

from .models import LearningEvent


def record_event(db, student_id, offering_id, event_type, resource_id, ref_id):
    """Idempotent insert, in the caller's transaction (it commits or rolls back with the action)."""
    db.execute(insert(LearningEvent).values(
        id=uuid.uuid4(), student_id=student_id, offering_id=offering_id, event_type=event_type,
        resource_id=resource_id, ref_id=ref_id, occurred_at=now())
        .on_conflict_do_nothing(constraint="event_unique"))
