from sqlalchemy import select

from .models import Account, AuditEvent


def list_accounts(db, page, page_size, search, role=None):
    query = select(Account)
    if role:
        query = query.where(Account.role == role)
    if search:
        pattern = f"%{search}%"
        query = query.where(Account.display_name.ilike(pattern) | Account.email.ilike(pattern))
    return db.scalars(query.order_by(Account.display_name, Account.id)
                      .offset((page - 1) * page_size).limit(page_size)).all()


def list_audit(db, page, page_size):
    return db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc(), AuditEvent.id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
