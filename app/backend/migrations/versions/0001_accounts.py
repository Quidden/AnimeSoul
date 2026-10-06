"""Initial account, role, session and relational save schema."""

from alembic import op
from backend.app.website.schema_v1 import metadata

revision = "0001_accounts"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    metadata.create_all(op.get_bind())


def downgrade():
    metadata.drop_all(op.get_bind())
