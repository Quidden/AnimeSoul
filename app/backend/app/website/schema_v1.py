"""Immutable initial relational schema shared by the first Alembic migration.

Save items are separate rows, not files or one serialized account blob. JSON
columns retain the extensible fields of the existing desktop save protocol.
"""

from sqlalchemy import (
    BigInteger, Boolean, Column, ForeignKey, ForeignKeyConstraint, Integer, JSON,
    MetaData, String, Table, UniqueConstraint,
)

metadata = MetaData()
users = Table("users", metadata,
    Column("id", String(36), primary_key=True),
    Column("username", String(32), nullable=False, unique=True),
    Column("email", String(254), nullable=False, unique=True),
    Column("email_verified", Boolean, nullable=False, default=False),
    Column("password_hash", String(512)),
    Column("avatar", String(500), nullable=False, default=""),
    Column("disabled", Boolean, nullable=False, default=False),
    Column("created_at", BigInteger, nullable=False),
)
identities = Table("oauth_identities", metadata,
    Column("provider", String(32), primary_key=True),
    Column("subject", String(255), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    UniqueConstraint("provider", "user_id"),
)
sessions = Table("account_sessions", metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("csrf_hash", String(64), nullable=False),
    Column("created_at", BigInteger, nullable=False),
    Column("expires_at", BigInteger, nullable=False, index=True),
)
roles = Table("roles", metadata,
    Column("id", String(36), primary_key=True),
    Column("name", String(64), nullable=False, unique=True),
    Column("protected", Boolean, nullable=False, default=False),
)
role_permissions = Table("role_permissions", metadata,
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission", String(80), primary_key=True),
)
user_roles = Table("user_roles", metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)
tokens = Table("account_tokens", metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("purpose", String(32), nullable=False),
    Column("email", String(254), nullable=False),
    Column("expires_at", BigInteger, nullable=False, index=True),
)
oauth_states = Table("oauth_states", metadata,
    Column("state_hash", String(64), primary_key=True),
    Column("browser_hash", String(64), nullable=False),
    Column("nonce", String(100), nullable=False),
    Column("verifier", String(100), nullable=False),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE")),
    Column("session_hash", String(64)),
    Column("expires_at", BigInteger, nullable=False, index=True),
)
limits = Table("request_limits", metadata,
    Column("key", String(64), primary_key=True),
    Column("window", BigInteger, primary_key=True),
    Column("hits", Integer, nullable=False),
    Column("expires_at", BigInteger, nullable=False, index=True),
)
save_envelopes = Table("save_envelopes", metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("revision", Integer, nullable=False),
    Column("payload", JSON, nullable=False),
)
profiles = Table("save_profiles", metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("position", Integer, nullable=False),
    Column("payload", JSON, nullable=False),
    Column("snapshot", JSON, nullable=False),
)
save_items = Table("save_items", metadata,
    Column("user_id", String(36), primary_key=True),
    Column("profile_id", String(128), primary_key=True),
    Column("kind", String(32), primary_key=True),
    Column("key", String(255), primary_key=True),
    Column("position", Integer, nullable=False),
    Column("payload", JSON, nullable=False),
    ForeignKeyConstraint(["user_id", "profile_id"], ["save_profiles.user_id", "save_profiles.id"], ondelete="CASCADE"),
)
audit = Table("account_audit", metadata,
    Column("id", String(36), primary_key=True),
    Column("actor_id", ForeignKey("users.id"), nullable=False),
    Column("action", String(80), nullable=False),
    Column("target_id", String(100), nullable=False),
    Column("created_at", BigInteger, nullable=False, index=True),
)
