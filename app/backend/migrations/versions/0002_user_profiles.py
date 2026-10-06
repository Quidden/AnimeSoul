"""Saved presentation, presence and per-section privacy for user profiles."""

from alembic import op
from backend.app.website.profile_schema import metadata

revision = "0002_user_profiles"
down_revision = "0001_accounts"
branch_labels = None
depends_on = None


def upgrade():
    metadata.create_all(op.get_bind())


def downgrade():
    metadata.drop_all(op.get_bind())
