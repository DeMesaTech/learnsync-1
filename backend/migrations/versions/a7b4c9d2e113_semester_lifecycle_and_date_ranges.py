"""Semester lifecycle and non-overlapping academic date ranges."""
from alembic import op
import sqlalchemy as sa

revision = "a7b4c9d2e113"
down_revision = "4e6a81c0b932"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("term_status", "academic_term", type_="check")
    op.execute("UPDATE academic_term SET status = 'inactive' WHERE status = 'closed' OR (status = 'open' AND end_date < CURRENT_DATE)")
    op.execute("UPDATE academic_term SET status = 'scheduled' WHERE status = 'open' AND start_date > CURRENT_DATE")
    op.execute("UPDATE academic_term SET status = 'scheduled' WHERE status = 'open'")
    op.execute("""
        UPDATE academic_term
        SET status = 'active'
        WHERE id = (
            SELECT id FROM academic_term
            WHERE status = 'scheduled' AND CURRENT_DATE BETWEEN start_date AND end_date
            ORDER BY start_date DESC, sequence DESC
            LIMIT 1
        )
    """)
    op.alter_column("academic_term", "status", server_default="draft")
    op.drop_constraint("term_dates", "academic_term", type_="check")
    op.create_check_constraint("term_dates", "academic_term", "end_date > start_date")
    op.create_check_constraint(
        "term_status", "academic_term",
        "status IN ('draft','scheduled','active','inactive','archived')",
    )
    op.create_check_constraint("school_year_dates", "school_year", "end_date > start_date")
    op.create_index(
        "one_active_academic_term", "academic_term", ["status"], unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.execute("""
        ALTER TABLE school_year
        ADD CONSTRAINT school_year_dates_no_overlap
        EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
    """)
    op.execute("""
        ALTER TABLE academic_term
        ADD CONSTRAINT academic_term_dates_no_overlap
        EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
    """)


def downgrade():
    op.execute("ALTER TABLE academic_term DROP CONSTRAINT academic_term_dates_no_overlap")
    op.execute("ALTER TABLE school_year DROP CONSTRAINT school_year_dates_no_overlap")
    op.drop_index("one_active_academic_term", table_name="academic_term")
    op.drop_constraint("school_year_dates", "school_year", type_="check")
    op.drop_constraint("term_dates", "academic_term", type_="check")
    op.drop_constraint("term_status", "academic_term", type_="check")
    op.execute("UPDATE academic_term SET status = 'open' WHERE status IN ('active','scheduled','draft')")
    op.execute("UPDATE academic_term SET status = 'closed' WHERE status IN ('inactive','archived')")
    op.alter_column("academic_term", "status", server_default="open")
    op.create_check_constraint("term_dates", "academic_term", "end_date >= start_date")
    op.create_check_constraint("term_status", "academic_term", "status IN ('open','closed')")