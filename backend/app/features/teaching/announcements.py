"""Section-targeted announcements: draft -> published -> archived."""
from sqlalchemy import delete, select

from app.errors import fail
from app.features.accounts.commands import audit
from app.features.accounts.models import now

from .access import targeted
from .items import check_sections
from .models import Announcement, AnnouncementSection


def section_ids_of(db, announcement_id):
    return set(db.scalars(select(AnnouncementSection.section_id)
                          .where(AnnouncementSection.announcement_id == announcement_id)))


def view(db, a):
    return {"id": a.id, "title": a.title, "body": a.body, "state": a.state,
            "section_ids": sorted(section_ids_of(db, a.id), key=str),
            "created_at": a.created_at, "published_at": a.published_at}


def get_announcement(db, offering, announcement_id):
    a = db.get(Announcement, announcement_id)
    if not a or a.offering_id != offering.id:
        fail(404, "not_found", "Announcement not found.")
    return a


def faculty_list(db, offering, limit=25, offset=0):
    """One page, newest first (a stable order, so pages never overlap): {items, has_more}."""
    rows = db.scalars(select(Announcement).where(Announcement.offering_id == offering.id)
                      .order_by(Announcement.created_at.desc(), Announcement.id)
                      .offset(offset).limit(limit + 1)).all()
    return {"items": [view(db, a) for a in rows[:limit]], "has_more": len(rows) > limit}


def set_sections(db, offering, announcement, section_ids):
    section_ids = list(dict.fromkeys(section_ids))
    check_sections(db, offering, section_ids)
    db.execute(delete(AnnouncementSection)
               .where(AnnouncementSection.announcement_id == announcement.id))
    for section_id in section_ids:
        db.add(AnnouncementSection(announcement_id=announcement.id, section_id=section_id))


def create(db, actor, offering, data):
    a = Announcement(offering_id=offering.id, title=data.title, body=data.body,
                     author_id=actor.id)
    db.add(a)
    db.flush()
    set_sections(db, offering, a, data.section_ids)
    audit(db, actor, "announcement.created", "announcement", a.id)
    db.commit()
    return a


def update(db, actor, offering, announcement, data):
    if announcement.state != "draft":
        fail(409, "announcement_locked", "Published announcements cannot be edited. "
                                         "Archive it and post a new one.")
    announcement.title, announcement.body = data.title, data.body
    set_sections(db, offering, announcement, data.section_ids)
    db.commit()


def publish(db, actor, announcement):
    if announcement.state != "draft":
        fail(409, "announcement_locked", "Only drafts can be published.")
    announcement.state, announcement.published_at = "published", now()
    audit(db, actor, "announcement.published", "announcement", announcement.id)
    db.commit()


def archive(db, actor, announcement):
    if announcement.state != "published":
        fail(409, "announcement_state", "Only published announcements can be archived.")
    announcement.state = "archived"
    audit(db, actor, "announcement.archived", "announcement", announcement.id)
    db.commit()


def student_list(db, offering, enrollment):
    """Everything this student may see, newest first (the dashboard's recent-updates card reads this)."""
    rows = db.scalars(select(Announcement).where(
        Announcement.offering_id == offering.id, Announcement.state == "published")
        .order_by(Announcement.published_at.desc(), Announcement.id))
    return [{"id": a.id, "title": a.title, "body": a.body, "published_at": a.published_at}
            for a in rows if targeted(section_ids_of(db, a.id), enrollment)]


def student_page(db, offering, enrollment, limit=25, offset=0):
    rows = student_list(db, offering, enrollment)[offset:offset + limit + 1]
    return {"items": rows[:limit], "has_more": len(rows) > limit}
