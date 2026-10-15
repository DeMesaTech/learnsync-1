"""Associate sections with their college/program."""
from alembic import op
import sqlalchemy as sa


revision = "d3b8f91a2c64"
down_revision = "b9e4bfe1a9c0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("section", sa.Column("college_id", sa.UUID(), nullable=True))
    op.create_index(op.f("ix_section_college_id"), "section", ["college_id"], unique=False)
    op.create_foreign_key(
        "section_college_fkey", "section", "college", ["college_id"], ["id"])
    op.execute(sa.text(
        "UPDATE section AS s "
        "SET college_id = linked.college_id "
        "FROM ("
        "  SELECT os.section_id, min(sub.college_id::text)::uuid AS college_id "
        "  FROM offering_section AS os "
        "  JOIN offering AS o ON o.id = os.offering_id "
        "  JOIN subject AS sub ON sub.id = o.subject_id "
        "  WHERE sub.college_id IS NOT NULL "
        "  GROUP BY os.section_id "
        "  HAVING count(DISTINCT sub.college_id) = 1"
        ") AS linked "
        "WHERE linked.section_id = s.id"
    ))


def downgrade():
    op.drop_constraint("section_college_fkey", "section", type_="foreignkey")
    op.drop_index(op.f("ix_section_college_id"), table_name="section")
    op.drop_column("section", "college_id")
