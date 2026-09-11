"""Tiptap / ProseMirror document helpers.

§1: "Article body format — Tiptap/ProseMirror JSON blocks in JSONB. Renders
natively on web AND app. Never store raw HTML as source of truth."

So `articles.body` is the JSON document, and both `body_plain` (for Meilisearch,
§4.4) and `body_html` (a cache for RSS and crawlers) are **derived** from it on
save. Neither derived column is ever authoritative.
"""

from __future__ import annotations

import html
from typing import Any

from app.telugu.normalize import count_words, normalize_text, reading_time_seconds

#: Node types the editor is allowed to persist. Anything else is dropped rather
#: than rendered — a stringer pasting from a website will bring script tags with
#: them (§12.1), and an allowlist is the only safe posture.
ALLOWED_NODES = frozenset(
    {
        "doc",
        "paragraph",
        "text",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "hardBreak",
        "image",
        "figure",
        "figcaption",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        # Product-specific blocks
        "embed",
        "pullQuote",
        "factBox",
    }
)

ALLOWED_MARKS = frozenset(
    {
        "bold",
        "italic",
        "underline",
        "strike",
        "link",
        "code",
        "superscript",
        "subscript",
        "highlight",
    }
)

_BLOCK_NODES = frozenset(
    {
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "listItem",
        "figcaption",
        "pullQuote",
    }
)


def empty_doc() -> dict[str, Any]:
    return {"type": "doc", "content": []}


def paragraph(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def heading(text: str, level: int = 2) -> dict[str, Any]:
    return {
        "type": "heading",
        "attrs": {"level": level},
        "content": [{"type": "text", "text": text}],
    }


def doc_from_paragraphs(paragraphs: list[str]) -> dict[str, Any]:
    return {"type": "doc", "content": [paragraph(p) for p in paragraphs if p.strip()]}


def sanitize(node: Any) -> Any | None:
    """Drop disallowed nodes and marks, recursively.

    Returns None when the node itself is not allowed, so the caller can prune it.
    """
    if not isinstance(node, dict):
        return None

    node_type = node.get("type")
    if node_type not in ALLOWED_NODES:
        return None

    cleaned: dict[str, Any] = {"type": node_type}

    if "attrs" in node and isinstance(node["attrs"], dict):
        attrs = dict(node["attrs"])
        # A link mark can carry javascript: — strip any non-http(s) href.
        href = attrs.get("href")
        if isinstance(href, str) and not href.startswith(
            ("http://", "https://", "/", "#")
        ):
            attrs.pop("href", None)
        cleaned["attrs"] = attrs

    if node_type == "text":
        cleaned["text"] = normalize_text(
            str(node.get("text", "")), collapse_spaces=False
        )
        marks = node.get("marks")
        if isinstance(marks, list):
            kept = []
            for mark in marks:
                if not isinstance(mark, dict) or mark.get("type") not in ALLOWED_MARKS:
                    continue
                m = {"type": mark["type"]}
                if isinstance(mark.get("attrs"), dict):
                    attrs = dict(mark["attrs"])
                    href = attrs.get("href")
                    if isinstance(href, str) and not href.startswith(
                        ("http://", "https://", "/", "#")
                    ):
                        continue  # drop the whole mark, not just the href
                    m["attrs"] = attrs
                kept.append(m)
            if kept:
                cleaned["marks"] = kept
        return cleaned

    content = node.get("content")
    if isinstance(content, list):
        children = [c for c in (sanitize(child) for child in content) if c is not None]
        if children:
            cleaned["content"] = children

    return cleaned


def sanitize_doc(doc: dict[str, Any] | None) -> dict[str, Any]:
    if not doc:
        return empty_doc()
    cleaned = sanitize(doc)
    if not cleaned or cleaned.get("type") != "doc":
        return empty_doc()
    cleaned.setdefault("content", [])
    return cleaned


def to_plain_text(doc: dict[str, Any] | None) -> str:
    """Flatten to plain text for the Meilisearch `body_plain` field (§4.4)."""
    if not doc:
        return ""

    parts: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "text":
            parts.append(str(node.get("text", "")))
            return
        if node.get("type") == "hardBreak":
            parts.append("\n")
            return
        for child in node.get("content", []) or []:
            walk(child)
        if node.get("type") in _BLOCK_NODES:
            parts.append("\n")

    walk(doc)
    return normalize_text("".join(parts))


def to_html(doc: dict[str, Any] | None) -> str:
    """Render the derived HTML cache used by RSS and crawler responses.

    Everything is escaped; this function never emits attacker-controlled markup.
    """
    if not doc:
        return ""

    def render_marks(text: str, marks: list[dict[str, Any]] | None) -> str:
        out = html.escape(text)
        for mark in marks or []:
            mtype = mark.get("type")
            if mtype == "bold":
                out = f"<strong>{out}</strong>"
            elif mtype == "italic":
                out = f"<em>{out}</em>"
            elif mtype == "underline":
                out = f"<u>{out}</u>"
            elif mtype == "strike":
                out = f"<s>{out}</s>"
            elif mtype == "code":
                out = f"<code>{out}</code>"
            elif mtype == "highlight":
                out = f"<mark>{out}</mark>"
            elif mtype == "link":
                href = html.escape(
                    str((mark.get("attrs") or {}).get("href", "")), quote=True
                )
                if href:
                    out = f'<a href="{href}" rel="nofollow noopener">{out}</a>'
        return out

    def walk(node: Any) -> str:
        if not isinstance(node, dict):
            return ""
        ntype = node.get("type")
        children = "".join(walk(c) for c in (node.get("content") or []))

        match ntype:
            case "doc":
                return children
            case "text":
                return render_marks(str(node.get("text", "")), node.get("marks"))
            case "paragraph":
                return f"<p>{children}</p>" if children else ""
            case "heading":
                level = int((node.get("attrs") or {}).get("level", 2))
                level = min(max(level, 2), 4)  # h1 belongs to the page title
                return f"<h{level}>{children}</h{level}>"
            case "bulletList":
                return f"<ul>{children}</ul>"
            case "orderedList":
                return f"<ol>{children}</ol>"
            case "listItem":
                return f"<li>{children}</li>"
            case "blockquote" | "pullQuote":
                return f"<blockquote>{children}</blockquote>"
            case "codeBlock":
                return f"<pre><code>{children}</code></pre>"
            case "horizontalRule":
                return "<hr>"
            case "hardBreak":
                return "<br>"
            case "image":
                attrs = node.get("attrs") or {}
                src = html.escape(str(attrs.get("src", "")), quote=True)
                alt = html.escape(str(attrs.get("alt", "")), quote=True)
                return f'<img src="{src}" alt="{alt}" loading="lazy">' if src else ""
            case "figure":
                return f"<figure>{children}</figure>"
            case "figcaption":
                return f"<figcaption>{children}</figcaption>"
            case _:
                return children

    return walk(doc)


def derive(doc: dict[str, Any] | None) -> tuple[dict[str, Any], str, str, int, int]:
    """Sanitise a body and compute everything derived from it.

    Returns (clean_doc, body_plain, body_html, word_count, reading_time_sec).
    """
    clean = sanitize_doc(doc)
    plain = to_plain_text(clean)
    return (
        clean,
        plain,
        to_html(clean),
        count_words(plain),
        reading_time_seconds(plain),
    )
