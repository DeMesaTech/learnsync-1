"""Store prospectus prerequisites in the subject catalog."""
from alembic import op
import sqlalchemy as sa

revision = "b1f4a8d20c3e"
down_revision = "41c9e0ab7d52"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "subject",
        sa.Column("prerequisite", sa.String(length=300), server_default="", nullable=False),
    )


def downgrade():
    op.drop_column("subject", "prerequisite")
