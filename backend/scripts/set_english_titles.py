"""Add English headlines to the demo articles.

§16 open item 3 was decided in favour of a Telugu + English edition, so the
reader's English mode needs something to show. Production headlines come from
the desk (or from AI translation with editor confirmation, §7.3); this fills the
seed set so the language switch is testable end to end.

`title_en` also feeds Meilisearch: §4.4 requires transliteration search because
readers type "kadapa" and "amaravati" in English.
"""

from __future__ import annotations

from sqlalchemy import select

from app.db.session import session_scope
from app.models.content import Article

ENGLISH_TITLES: dict[str, str] = {
    "x7Kp2m": "Amaravati capital funds released: first tranche of Rs 1,250 crore",
    "b3Nq8t": "Foundation laid for green hydrogen plant in Visakhapatnam",
    "k9Rt4w": "Heavy rain in Srikakulam; alert issued for 12 mandals",
    "m2Vc7h": "Centre approves phase two of the Hyderabad Metro",
    "p5Jd1x": "Rs 34 crore for tribal welfare in Manyam, says Collector",
    "t8Ln3q": "IPL 2026: Hyderabad names a new captain",
    "f4Wz9b": "Tollywood: three big releases set for Sankranti",
    "x2Fd91": "Sugarcane farmers meet in Anakapalli",
    "n6Hs2k": "Support price raised for chilli farmers in Khammam",
    "c1Bg7v": "Work begins on steel plant in Kadapa district",
    "r7Yt5n": "Polavaram project reaches a key stage; Chief Minister reviews today",
    "v3Mq6p": "Visakhapatnam Port plans new berth expansion",
    "g8Kr2d": "Centre allots Rs 8,400 crore for national highway expansion",
    "h3Nm7c": "Rythu Bharosa funds released; 52 lakh farmers to benefit",
    "j9Pw4t": "New companies to enter the IT corridor; 12,000 jobs expected",
    "q4Lz8m": "ERC holds public hearing on electricity tariff revision",
    "s2Vx6r": "Government medical college approved for Warangal",
    "u5Cd3j": "Cash incentives for athletes increased",
    "w8Bn1f": "Film workers call off strike; shooting resumes",
    "y1Gk9s": "Sand mining banned along the coast",
    "z6Hq4l": "Digital classrooms expanded in government schools",
    "a9Tr2v": "Metro phase two: land acquisition speeded up",
    "b7Dm5x": "Exports grow; boost for the aqua sector",
    "c3Fj8w": "Weather: light rain expected over the next three days",
}


def run() -> None:
    updated = 0
    with session_scope() as db:
        for short_id, title_en in ENGLISH_TITLES.items():
            article = db.execute(
                select(Article).where(Article.short_id == short_id)
            ).scalar_one_or_none()
            if article is None:
                continue
            article.title_en = title_en
            # §10.3: SEO title follows the reader-facing headline.
            if not article.seo_title:
                article.seo_title = title_en[:200]
            updated += 1
    print(f"English headlines set on {updated} articles")


if __name__ == "__main__":
    run()
