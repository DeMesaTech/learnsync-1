from alembic import context
from app.db import Base, engine
from app.features.accounts import models  # noqa: F401
from app.features.academics import models as academic_models  # noqa: F401
from app.features.files import models as file_models  # noqa: F401
from app.features.teaching import models as teaching_models  # noqa: F401
from app.features.assessments import models as assessment_models  # noqa: F401
from app.features.study import models as study_models  # noqa: F401
from app.features.support import models as support_models  # noqa: F401

target_metadata = Base.metadata

if context.is_offline_mode():
    from app.config import settings
    context.configure(url=settings().database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
