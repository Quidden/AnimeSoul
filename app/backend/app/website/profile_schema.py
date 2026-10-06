"""Profile presentation is independent of the immutable account/save schema."""

from sqlalchemy import BigInteger, Column, ForeignKey, JSON, MetaData, String, Table, Text

from .schema_v1 import users

metadata = MetaData()
user_profiles = Table("user_profiles", metadata,
    Column("user_id", ForeignKey(users.c.id, ondelete="CASCADE"), primary_key=True),
    Column("avatar", Text),
    Column("banner", Text, nullable=False, default=""),
    Column("about", Text, nullable=False, default=""),
    Column("presence", String(20), nullable=False, default="online"),
    Column("visibility", JSON, nullable=False, default=dict),
    Column("last_seen_at", BigInteger, nullable=False, default=0),
)
