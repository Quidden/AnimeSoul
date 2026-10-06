"""Migrations read the database URL from the environment, never source code."""

from alembic import context
from sqlalchemy import create_engine, pool
from backend.app.website.config import load_website_settings
from backend.app.website.schema_v1 import metadata
from backend.app.website.profile_schema import metadata as profile_metadata

config = load_website_settings()
if not config.database_url:
    raise RuntimeError("ANIMESOUL_DATABASE_URL is required")

if context.is_offline_mode():
    context.configure(url=config.database_url, target_metadata=[metadata, profile_metadata], literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(config.database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=[metadata, profile_metadata])
        with context.begin_transaction():
            context.run_migrations()
