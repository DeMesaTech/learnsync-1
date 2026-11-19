from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.config import settings


def school_today() -> date:
    return datetime.now(ZoneInfo(settings().app_timezone)).date()


def is_within_schedule(term, current_date: date) -> bool:
    return term.start_date <= current_date <= term.end_date
