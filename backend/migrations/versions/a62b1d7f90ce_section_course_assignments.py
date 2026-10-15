"""Store the subject on section assignments and prevent duplicate courses per section."""
from alembic import op
import sqlalchemy as sa

revision = "a62b1d7f90ce"
down_revision = "9f6d2a4c18b1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("offering_section", sa.Column("subject_id", sa.UUID(), nullable=True))
    op.execute(sa.text(
        "UPDATE offering_section AS os "
        "SET subject_id = o.subject_id "
        "FROM offering AS o "
        "WHERE o.id = os.offering_id"
    ))

    duplicate = op.get_bind().execute(sa.text(
        "SELECT s.name, sub.code "
        "FROM offering_section AS os "
        "JOIN section AS s ON s.id = os.section_id "
        "JOIN subject AS sub ON sub.id = os.subject_id "
        "GROUP BY s.id, s.name, sub.id, sub.code "
        "HAVING count(*) > 1 "
        "ORDER BY s.name, sub.code "
        "LIMIT 1"
    )).first()
    if duplicate:
        raise RuntimeError(
            f"Cannot enforce one assignment per section and course: "
            f"{duplicate.name} has duplicate {duplicate.code} assignments. "
            "Resolve the instructor assignments first; no assignments were removed."
        )

    op.alter_column("offering_section", "subject_id", existing_type=sa.UUID(), nullable=False)
    op.create_unique_constraint(
        "offering_id_subject_unique", "offering", ["id", "subject_id"])
    op.create_foreign_key(
        "offering_section_subject_matches",
        "offering_section",
        "offering",
        ["offering_id", "subject_id"],
        ["id", "subject_id"],
    )
    op.create_unique_constraint(
        "section_subject_unique", "offering_section", ["section_id", "subject_id"])


def downgrade():
    op.drop_constraint("section_subject_unique", "offering_section", type_="unique")
    op.drop_constraint(
        "offering_section_subject_matches", "offering_section", type_="foreignkey")
    op.drop_constraint("offering_id_subject_unique", "offering", type_="unique")
    op.drop_column("offering_section", "subject_id")
