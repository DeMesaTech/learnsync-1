"""Remove retired chapter metadata from stored syllabus outlines."""
from alembic import op

revision = "d12c8a6f4e30"
down_revision = "a7b4c9d2e113"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE syllabus_revision AS revision
        SET outline = jsonb_set(
            revision.outline,
            '{chapters}',
            COALESCE((
                SELECT jsonb_agg(
                    chapter - 'ilo' - 'activities' - 'assessment' - 'kind'
                    ORDER BY ordinality
                )
                FROM jsonb_array_elements(revision.outline->'chapters')
                     WITH ORDINALITY AS chapter_rows(chapter, ordinality)
            ), '[]'::jsonb),
            true
        )
        WHERE jsonb_typeof(revision.outline->'chapters') = 'array'
    """)


def downgrade():
    pass