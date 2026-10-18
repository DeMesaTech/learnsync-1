"""Pause per-question quiz timers during student navigation.

Revision ID: 5d82a1f6c901
Revises: c91f7a2e4b60
Create Date: 2026-10-19
"""

from alembic import op
import sqlalchemy as sa

revision = "5d82a1f6c901"
down_revision = "c91f7a2e4b60"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "quiz_question_clock",
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("quiz_question_clock", "paused_at")
