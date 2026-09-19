"""Editorially seeded likes and comments.

**What this is.** A way for the owner to put a baseline of likes and a few
opening comments on a story so a live article does not look abandoned. The
product owner asked for it deliberately.

**What it is not, and cannot become.** Fabricated engagement shown to readers
as genuine is deception, and the cost of it being traced — by a reader, a rival
masthead, or an advertiser auditing the numbers — is the one asset a news brand
has. That is not an argument against the feature here; it is the reason every
constraint below is structural rather than a rule somebody has to remember:

* **Likes are an offset, not rows.** `likes` has a composite primary key
  carrying a real `users.id`, so fabricating rows would mean inventing accounts
  or liking on a real reader's behalf. `Article.seed_like_count` is added to
  the reader-facing total and to nothing else, so ranking, personalization and
  trending never see it.
* **A seeded comment has no account.** `comments.user_id` is NULL for these, so
  a seeded comment *cannot* be attributed to a registered reader — by
  construction, not by convention.
* **The name is picked from a fixed pool, by index.** Never free text. A bare
  Telugu given name with no surname cannot name a public figure, and the pool
  is checked against real account names so it cannot collide with a reader.
* **`is_seeded` keeps it out of the numbers that matter.** `trending_service`
  filters on it, and analytics must filter on it rather than trust
  `articles.comment_count`.
* **Every call is audit-logged** with the actor, their IP and the exact content
  — see the routes in `api/v1/cms_articles.py`.

Only ADMIN and SUPER_ADMIN hold `engagement.seed`: it lives in its own
permission group so it does not arrive through the editorial bundle.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ValidationError
from app.models.content import Article
from app.models.engagement import Comment
from app.models.enums import CommentStatus, CommentTargetType
from app.models.user import User
from app.services.engagement_service import COMMENT_MAX_LENGTH

#: Given names only, no surnames. A first name on its own cannot be read as a
#: claim about a real, identifiable person, which is the line this feature must
#: not cross. Callers pass an index into this tuple; they never pass a string.
SEED_NAMES: tuple[str, ...] = (
    "రమేష్", "సునీత", "వెంకట్", "లక్ష్మి", "శ్రీను", "పద్మ",
    "కిరణ్", "అనిత", "రాజు", "స్వప్న", "మహేష్", "భారతి",
    "నాగరాజు", "సరిత", "ప్రసాద్", "కవిత", "సతీష్", "ఉమ",
    "రవి", "దుర్గ", "శివ", "మాధవి", "గోపాల్", "రాధిక",
    "చంద్ర", "వాణి", "అనిల్", "సుజాత", "హరీష్", "జ్యోతి",
    "బాబు", "శైలజ", "నరేష్", "రేణుక", "మురళి", "సంధ్య",
    "అశోక్", "విజయ", "సాయి", "హేమ",
)

#: A ceiling that is obviously a ceiling. Past this the number stops reading as
#: engagement and starts reading as a claim nobody believes.
MAX_SEED_LIKES = 100_000


def seed_likes(db: Session, *, article: Article, count: int) -> int:
    """Set the seeded-like offset. Returns the reader-facing total.

    This *sets* rather than adds, so the admin screen is idempotent and
    un-seeding is passing 0 — there is no "remove" path to get wrong.
    """
    if count < 0 or count > MAX_SEED_LIKES:
        raise ValidationError(details={"count": f"0..{MAX_SEED_LIKES}"})
    article.seed_like_count = count
    db.flush()
    return article.like_count + article.seed_like_count


def seed_comment(
    db: Session, *, article: Article, body: str, name_index: int
) -> Comment:
    """Add one seeded comment to an article.

    Deliberately not an extra branch inside `engagement_service.add_comment`:
    that function carries a `user_id` contract and a reader rate limit, and
    seeding satisfies neither. Keeping them apart is what stops a future edit
    from letting a reader reach this path.
    """
    text = body.strip()
    if not text:
        raise ValidationError(details={"body": "empty"})
    if len(text) > COMMENT_MAX_LENGTH:
        raise ValidationError(details={"body": f"over {COMMENT_MAX_LENGTH} characters"})
    if not 0 <= name_index < len(SEED_NAMES):
        raise ValidationError(details={"name_index": f"0..{len(SEED_NAMES) - 1}"})

    name = SEED_NAMES[name_index]

    # Belt and braces over the "given names only" rule: if a real account ever
    # carries this exact name, refuse rather than publish something a reader
    # could mistake for that person. One indexed lookup, once per seed.
    clash = db.scalar(
        select(func.count())
        .select_from(User)
        .where((User.name_te == name) | (User.name_en == name))
    )
    if clash:
        raise ValidationError(
            details={"name_index": "that name belongs to a real account"}
        )

    comment = Comment(
        target_type=CommentTargetType.ARTICLE,
        article_id=article.id,
        video_id=None,
        user_id=None,
        parent_id=None,
        body=text,
        status=CommentStatus.VISIBLE,
        is_seeded=True,
        seed_author_name=name,
    )
    db.add(comment)
    # The reader can count the list, so the number beside it has to match.
    # Analytics must filter on `is_seeded` rather than trust this counter.
    article.comment_count = (article.comment_count or 0) + 1
    db.flush()
    return comment
