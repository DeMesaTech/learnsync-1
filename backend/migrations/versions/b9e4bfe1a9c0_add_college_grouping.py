"""Add college grouping to subjects."""
from alembic import op
import sqlalchemy as sa

revision = "b9e4bfe1a9c0"
down_revision = "a62b1d7f90ce"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "college",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('active','inactive')", name="college_status"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.add_column("subject", sa.Column("college_id", sa.UUID(), nullable=True))
    op.create_index(op.f("ix_subject_college_id"), "subject", ["college_id"], unique=False)
    op.create_foreign_key(
        "subject_college_fkey",
        "subject",
        "college",
        ["college_id"],
        ["id"],
    )


def downgrade():
    op.drop_constraint("subject_college_fkey", "subject", type_="foreignkey")
    op.drop_index(op.f("ix_subject_college_id"), table_name="subject")
    op.drop_column("subject", "college_id")
    op.drop_table("college")
