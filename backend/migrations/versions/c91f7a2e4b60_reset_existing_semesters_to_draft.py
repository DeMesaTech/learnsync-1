"""Reset existing semester lifecycle states to draft."""
from alembic import op

revision = "c91f7a2e4b60"
down_revision = "d12c8a6f4e30"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE academic_term SET status = 'draft'")


def downgrade():
    pass
