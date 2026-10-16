"""Assign faculty accounts to a college/program."""
from alembic import op
import sqlalchemy as sa


revision = "4e6a81c0b932"
down_revision = "d3b8f91a2c64"
branch_labels = None
depends_on = None

DEFAULT_COLLEGE_ID = "d81b2a06-85a9-44d0-9f50-41d7fbc76f7f"


def upgrade():
    op.add_column("account", sa.Column("college_id", sa.UUID(), nullable=True))
    op.create_index(op.f("ix_account_college_id"), "account", ["college_id"], unique=False)
    op.create_foreign_key(
        "account_college_fkey", "account", "college", ["college_id"], ["id"])
    op.execute(sa.text(
        "UPDATE account "
        f"SET college_id = '{DEFAULT_COLLEGE_ID}'::uuid "
        "WHERE role = 'faculty'"
    ))


def downgrade():
    op.drop_constraint("account_college_fkey", "account", type_="foreignkey")
    op.drop_index(op.f("ix_account_college_id"), table_name="account")
    op.drop_column("account", "college_id")
