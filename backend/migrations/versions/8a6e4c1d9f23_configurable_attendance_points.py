"""configurable attendance points"""
from alembic import op
import sqlalchemy as sa


revision = "8a6e4c1d9f23"
down_revision = "ea917a6bd204"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attendance_mark", sa.Column("points", sa.Numeric(8, 2), nullable=True))
    op.alter_column("attendance_mark", "status", existing_type=sa.String(length=10),
                    nullable=True)
    op.create_check_constraint(
        "attendance_mark_value", "attendance_mark",
        "(status IS NULL) <> (points IS NULL)",
    )
    op.create_check_constraint(
        "attendance_points_nonnegative", "attendance_mark",
        "points IS NULL OR points >= 0",
    )


def downgrade():
    op.execute(sa.text(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM attendance_mark WHERE points IS NOT NULL) "
        "THEN RAISE EXCEPTION 'Cannot downgrade while numeric attendance marks exist'; "
        "END IF; END $$"
    ))
    op.drop_constraint("attendance_points_nonnegative", "attendance_mark", type_="check")
    op.drop_constraint("attendance_mark_value", "attendance_mark", type_="check")
    op.alter_column("attendance_mark", "status", existing_type=sa.String(length=10),
                    nullable=False)
    op.drop_column("attendance_mark", "points")
