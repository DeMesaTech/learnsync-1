"""Scope subject codes to their college/program."""
from alembic import op
import sqlalchemy as sa

revision = "c82e6a14d970"
down_revision = "b1f4a8d20c3e"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("subject_code_key", "subject", type_="unique")
    op.create_unique_constraint(
        "subject_college_code_unique", "subject", ["college_id", "code"])
    op.create_index(
        "subject_unassigned_code_unique", "subject", ["code"], unique=True,
        postgresql_where=sa.text("college_id IS NULL"))


def downgrade():
    op.drop_index("subject_unassigned_code_unique", table_name="subject")
    op.drop_constraint("subject_college_code_unique", "subject", type_="unique")
    op.create_unique_constraint("subject_code_key", "subject", ["code"])
