"""per-question quiz timers"""
from alembic import op
import sqlalchemy as sa


revision = "9f6d2a4c18b1"
down_revision = ("dd341f0c7da5", "6e2b5ab0973a")
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "quiz_question",
        sa.Column("duration_minutes", sa.Integer(), server_default="5", nullable=False),
    )
    op.create_check_constraint(
        "question_duration", "quiz_question", "duration_minutes BETWEEN 1 AND 180"
    )
    op.create_table(
        "quiz_question_clock",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("attempt_id", sa.UUID(), nullable=False),
        sa.Column("question_key", sa.String(length=36), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["attempt_id"], ["quiz_attempt.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attempt_id", "question_key", name="question_clock_unique"),
    )
    op.create_index(
        "ix_quiz_question_clock_attempt_id", "quiz_question_clock", ["attempt_id"]
    )


def downgrade():
    op.drop_index("ix_quiz_question_clock_attempt_id", table_name="quiz_question_clock")
    op.drop_table("quiz_question_clock")
    op.drop_constraint("question_duration", "quiz_question", type_="check")
    op.drop_column("quiz_question", "duration_minutes")
