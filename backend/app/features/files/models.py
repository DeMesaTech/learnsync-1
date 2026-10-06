import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.features.accounts.models import now


class StoredFile(Base):
    __tablename__ = "stored_file"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(100), unique=True)
    purpose: Mapped[str] = mapped_column(String(40))
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
