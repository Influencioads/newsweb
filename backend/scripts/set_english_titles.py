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
    # §1.2/§1.5 coverage set
    "pl1Aa2": "Assembly session begins Monday; question hour on day one",
    "pl2Bb3": "Panchayat poll schedule in the works; announcement next month",
    "pl3Cc4": "Municipal budget approved; Rs 2,400 crore for city development",
    "wd1Dd5": "New cultural centre for the Telugu diaspora opens in Dubai",
    "wd2Ee6": "New student visa rules abroad; Telugu students affected",
    "wd3Ff7": "Indian delegation at world trade summit discusses export deals",
    "jb1Gg8": "Group-2 notification released; 905 posts to be filled",
    "jb2Hh9": "8,000 fresher jobs in IT companies; campus drives begin",
    "jb3Jj1": "Teacher recruitment cleared; district-wise vacancy list out",
    "hl1Kk2": "Seasonal fever alert; special wards opened in hospitals",
    "hl2Ll3": "Free mega health camp screens 3,200 people",
    "hl3Mm4": "Yoga day preparations; special training in schools",
    "lf1Nn5": "From work-from-home to hybrid: city lifestyles are changing",
    "lf2Pp6": "Handloom sarees win young fans; a new trend takes hold",
    "lf3Qq7": "Youth turn to minimalism: buy only what you need",
    "tv1Rr8": "Tourist rush in the Araku valley; coffee estate tours in demand",
    "tv2Ss9": "New facilities at Gandikota fort; adventure sports approved",
    "tv3Tt1": "Pilgrimage packages revised; online booking made easier",
    "fd1Uu2": "Sankranti sweets season begins; ariselu makers race ahead",
    "fd2Vv3": "Millet dishes catch on; hotels roll out special menus",
    "fd3Ww4": "Avakaya season opens; mango markets see brisk demand",
    "cr1Xx5": "Special drive against cyber fraud; 42 cases cracked in a month",
    "cr2Yy6": "Crackdown on ganja transport; checkpost searches intensified",
    "cr3Zz7": "Fake seed racket busted; large stocks seized from godowns",
    "dv1Ab8": "Heavy rush at Tirumala; 18 hours for sarva darshan",
    "dv2Bc9": "Early preparations for Godavari Pushkaralu; ghats modernised",
    "dv3Cd1": "Temples ready for Karthika deepotsavam; puja schedule released",
    "in1De2": "Power from waste: school students' project wins national prize",
    "in2Ef3": "Auto driver's free tiffin centre serves 120 elders daily",
    "in3Fg4": "Youth brigade revives nine lakes in a single year",
    "zh1Gh5": "From tea stall to tech company: a young founder's journey",
    "zh2Hj6": "Farm labourer cracks civil services; village celebrates",
    "zh3Jk7": "Para athlete conquers disability, wins international medal",
    "nt1Np2": "New railway timetable out; six new trains for the Telugu states",
    "nt2Pq3": "Digital payments hit a record: 1,600 crore transactions in a month",
    "cn1Qr4": "Senior hero's new film launched with a star director",
    "sp1Rs5": "New coaches for the state sports academy; camps expanded",
    "bd1Kl8": "Festive sale: up to 40% off on electronics",
    "bd2Lm9": "Special rebate on handloom fabrics; co-op store week begins",
    "bd3Mn1": "Weekend special prices at rythu bazaars; discounts on vegetables",
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
