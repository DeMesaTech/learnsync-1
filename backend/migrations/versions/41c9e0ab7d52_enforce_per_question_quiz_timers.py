"""enforce per-question quiz timers"""
from alembic import op
import sqlalchemy as sa


revision = "41c9e0ab7d52"
down_revision = "5d82a1f6c901"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "quiz_question",
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
    )
    op.execute(sa.text(
        "UPDATE quiz_question SET duration_seconds = duration_minutes * 60"
    ))
    op.alter_column(
        "quiz_question", "duration_seconds",
        existing_type=sa.Integer(), nullable=False, server_default="300",
    )
    op.create_check_constraint(
        "question_duration_seconds", "quiz_question",
        "duration_seconds BETWEEN 1 AND 10800",
    )

    op.add_column(
        "quiz_question_clock",
        sa.Column("status", sa.String(length=12), nullable=True, server_default="active"),
    )
    op.execute(sa.text(
        "UPDATE quiz_question_clock SET status = "
        "CASE WHEN locked_at IS NOT NULL THEN 'answered' ELSE 'active' END"
    ))
    op.alter_column(
        "quiz_question_clock", "status",
        existing_type=sa.String(length=12), nullable=False, server_default="active",
    )
    op.create_check_constraint(
        "question_clock_status", "quiz_question_clock",
        "status IN ('active', 'answered', 'skipped', 'timed_out')",
    )


def downgrade():
    op.drop_constraint("question_clock_status", "quiz_question_clock", type_="check")
    op.drop_column("quiz_question_clock", "status")
    op.drop_constraint("question_duration_seconds", "quiz_question", type_="check")
    op.drop_column("quiz_question", "duration_seconds")
