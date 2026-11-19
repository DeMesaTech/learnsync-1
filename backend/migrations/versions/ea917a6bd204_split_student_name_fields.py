"""Store student name components separately."""
from alembic import op
import sqlalchemy as sa

revision = "ea917a6bd204"
down_revision = "c82e6a14d970"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("account", sa.Column("first_name", sa.String(length=100), nullable=True))
    op.add_column("account", sa.Column("middle_name", sa.String(length=100), nullable=True))
    op.add_column("account", sa.Column("last_name", sa.String(length=100), nullable=True))
    op.add_column("account", sa.Column("suffix", sa.String(length=20), nullable=True))


def downgrade():
    op.drop_column("account", "suffix")
    op.drop_column("account", "last_name")
    op.drop_column("account", "middle_name")
    op.drop_column("account", "first_name")
