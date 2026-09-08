"""Phase I (updated doc §15): the video hub — channels, tags, comments, reactions.

Comments become polymorphic here, which is the only part that touches existing
data. It is done additively so a running deployment never sees a broken row:

  * `target_type` arrives with a server default of ARTICLE, so every existing
    comment is already correctly labelled the moment the column exists.
  * `article_id` becomes nullable *after* that, so a video comment can leave it
    empty while every historic row keeps its value.
  * `video_id` is new and nullable.

There is deliberately no CHECK constraint tying the two FKs to `target_type`:
MySQL only began enforcing CHECK in 8.0.16, and a constraint that silently does
nothing on an older server is worse than an explicit service-layer guard, which
is where the rule actually lives (`engagement_service._comment_target`).

Revision ID: d47b0c8e2a15
Revises: c39a5e1f8b72
Create Date: 2026-09-08 17:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'd47b0c8e2a15'
down_revision: Union[str, None] = 'c39a5e1f8b72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE_KW = dict(
    mysql_charset='utf8mb4',
    mysql_collate='utf8mb4_unicode_ci',
    mysql_engine='InnoDB',
)


def upgrade() -> None:
    # ------------------------------------------------------------ channels --
    op.create_table(
        'video_channels',
        sa.Column('youtube_channel_key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=True),
        sa.Column('avatar_url', sa.String(length=700), nullable=True),
        sa.Column('is_verified', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('follower_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_video_channels')),
        sa.UniqueConstraint('youtube_channel_key', name='uq_video_channels_youtube_channel_key'),
        **_TABLE_KW,
    )

    # -------------------------------------------------------------- videos --
    with op.batch_alter_table('videos') as batch:
        batch.add_column(sa.Column('channel_id', sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column('like_count', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('comment_count', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('share_count', sa.Integer(), nullable=False, server_default='0'))
        batch.create_foreign_key('fk_videos_channel_id_video_channels', 'video_channels',
                                 ['channel_id'], ['id'], ondelete='SET NULL')

    op.create_table(
        'video_tags',
        sa.Column('video_id', sa.BigInteger(), nullable=False),
        sa.Column('tag_id', sa.BigInteger(), nullable=False),
        sa.Column('sort', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], name=op.f('fk_video_tags_video_id_videos'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], name=op.f('fk_video_tags_tag_id_tags'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('video_id', 'tag_id', name=op.f('pk_video_tags')),
        **_TABLE_KW,
    )

    # ------------------------------------------------ polymorphic comments --
    with op.batch_alter_table('comments') as batch:
        batch.add_column(sa.Column(
            'target_type',
            sa.Enum('ARTICLE', 'VIDEO', name='commenttargettype', native_enum=False, length=10),
            nullable=False, server_default='ARTICLE'))
        batch.add_column(sa.Column('video_id', sa.BigInteger(), nullable=True))
        batch.alter_column('article_id', existing_type=sa.BigInteger(), nullable=True)
        batch.create_foreign_key('fk_comments_video_id_videos', 'videos',
                                 ['video_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_comments_video_id_status_created_at', 'comments',
                    ['video_id', 'status', 'created_at'], unique=False)

    # ------------------------------------------------------------ reactions --
    op.create_table(
        'reactions',
        sa.Column('target_type', sa.Enum('ARTICLE', 'VIDEO', name='commenttargettype', native_enum=False, length=10), nullable=False),
        sa.Column('target_id', sa.BigInteger(), nullable=False),
        sa.Column('viewer_key', sa.String(length=80), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('kind', sa.Enum('HAPPY', 'SAD', 'ANGRY', name='reactionkind', native_enum=False, length=10), nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_reactions_user_id_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_reactions')),
        sa.UniqueConstraint('target_type', 'target_id', 'viewer_key', name='uq_reactions_target_viewer'),
        **_TABLE_KW,
    )
    op.create_index('ix_reactions_target', 'reactions', ['target_type', 'target_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_reactions_target', table_name='reactions')
    op.drop_table('reactions')

    op.drop_index('ix_comments_video_id_status_created_at', table_name='comments')
    # Video comments have no article to fall back to, so they go with the
    # column rather than being silently reattached to article 0.
    op.execute("DELETE FROM comments WHERE target_type = 'VIDEO'")
    with op.batch_alter_table('comments') as batch:
        batch.drop_constraint('fk_comments_video_id_videos', type_='foreignkey')
        batch.drop_column('video_id')
        batch.alter_column('article_id', existing_type=sa.BigInteger(), nullable=False)
        batch.drop_column('target_type')

    op.drop_table('video_tags')
    with op.batch_alter_table('videos') as batch:
        batch.drop_constraint('fk_videos_channel_id_video_channels', type_='foreignkey')
        batch.drop_column('share_count')
        batch.drop_column('comment_count')
        batch.drop_column('like_count')
        batch.drop_column('channel_id')

    op.drop_table('video_channels')
