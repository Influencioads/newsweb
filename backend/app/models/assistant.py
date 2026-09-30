"""Sanjaya, the newsroom assistant: conversations, messages and background jobs.

Three tables, and the same rule as `app.models.ai`: **nothing the assistant
makes reaches a reader on its own.** Articles it writes land at SUBMITTED in the
ordinary review queue under the requesting staff member's name (so a different
person has to approve them), bulletins it prepares are held at READY, and every
outward action (publish, push, approve) is a button a human presses.

  * `assistant_conversations` — one chat thread per staff member per topic.
    `status` is the state of the *current turn*: the model loop runs in the
    background and the page polls, because a turn of several model calls
    outlives both the 20 s browser timeout and the 120 s nginx ceiling.
  * `assistant_messages` — the transcript. `payload` keeps the provider's
    assistant message **verbatim**: Gemini attaches a `thought_signature` to
    every tool call and answers 400 on the next turn if it is not echoed back.
  * `assistant_jobs` — multi-minute work a tool started (write N articles,
    crawl the feeds, prepare a bulletin). The page polls `progress`/`step_text`;
    `heartbeat_at` is how a job killed by a deploy is told apart from a slow one.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime


class AssistantConversation(PKMixin, TimestampMixin, Base):
    __tablename__ = "assistant_conversations"
    __table_args__ = (
        Index("ix_assistant_conversations_user_updated", "user_id", "updated_at"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    #: idle | running | failed — the state of the latest turn.
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="idle")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class AssistantMessage(PKMixin, TimestampMixin, Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (
        Index("ix_assistant_messages_conversation", "conversation_id", "id"),
        MYSQL_TABLE_ARGS,
    )

    conversation_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: user | assistant | tool
    role: Mapped[str] = mapped_column(String(12), nullable=False)
    #: user/assistant: the text shown. tool: the JSON string the model is sent.
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: assistant: the provider message verbatim (tool_calls + signatures).
    #: tool: {"tool_call_id", "name", "args", "cards"} — `cards` is what the page draws.
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class AssistantJob(PKMixin, TimestampMixin, Base):
    __tablename__ = "assistant_jobs"
    __table_args__ = (
        Index("ix_assistant_jobs_user_created", "user_id", "created_at"),
        Index("ix_assistant_jobs_status", "status"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    conversation_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("assistant_conversations.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    params: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    #: queued | running | done | failed
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="queued")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    step_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    #: {"summary": str, "cards": [...], ...} — the page draws the cards.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
