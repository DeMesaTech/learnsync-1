"""learning item position: teaching order inside a chapter/topic"""
from alembic import op
import sqlalchemy as sa

revision = 'cb4f92b46a0b'
down_revision = 'e67a8c8e4e4a'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('learning_item', sa.Column('position', sa.Integer(), nullable=False, server_default='0'))
    # Existing items keep the order they were created in, numbered per subject offering.
    op.execute("""
        UPDATE learning_item SET position = ranked.n
        FROM (SELECT id, row_number() OVER (PARTITION BY offering_id ORDER BY created_at, id) AS n
              FROM learning_item) AS ranked
        WHERE learning_item.id = ranked.id""")
    op.alter_column('learning_item', 'position', server_default=None)


def downgrade():
    op.drop_column('learning_item', 'position')
