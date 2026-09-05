"""Categories, tags, and development demo articles.

Split from `seed.py` because the two tiers have different destinations
(brief §40, §41):

  * `seed_categories` / `seed_tags` are **reference data** — the section
    structure the masthead nav renders. They ship to production.
  * `seed_demo_articles` is **development-only** content, refused outright when
    APP_ENV=production, and every row it writes carries `source_type="demo"` so
    a demo story can never be mistaken for real copy.

The demo headlines are taken from the approved mockup (screens 1b/1c/1d/1h) so
the running site matches the design that was signed off.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.content import (
    Article,
    ArticleSearchAlias,
    ArticleTag,
    Category,
    Tag,
    WorkflowTransition,
)
from app.models.enums import ArticleStatus, TagType, WorkflowState
from app.models.geo import District
from app.models.user import User
from app.services import tiptap
from app.telugu.normalize import normalize_headline, normalize_text
from app.telugu.transliterate import search_aliases, slugify

logger = get_logger("seed.content")

DEMO_SOURCE_TYPE = "demo"

# (slug, name_te, name_en, show_in_nav) — the full section set of the updated
# doc §1.2/§1.5, in nav order. AP/TS lead because this is a Telugu-first,
# local-first product; Home/Trending/Local are feeds, not categories, so they
# are not rows here. Tuple position doubles as the sort order on every re-seed.
CATEGORIES: tuple[tuple[str, str, str, bool], ...] = (
    ("andhra-pradesh", "ఆంధ్రప్రదేశ్", "Andhra Pradesh", True),
    ("telangana", "తెలంగాణ", "Telangana", True),
    ("national", "జాతీయం", "National", True),
    ("world", "అంతర్జాతీయం", "International", True),
    ("politics", "రాజకీయం", "Politics", True),
    ("cinema", "సినిమా", "Cinema", True),
    ("sports", "క్రీడలు", "Sports", True),
    ("business", "బిజినెస్", "Business", True),
    ("jobs", "ఉద్యోగాలు", "Jobs", True),
    ("health", "ఆరోగ్యం", "Health", True),
    ("crime", "క్రైమ్", "Crime", True),
    ("devotional", "భక్తి", "Devotional", True),
    ("lifestyle", "లైఫ్‌స్టైల్", "Lifestyle", True),
    ("travel", "పర్యాటకం", "Travel", True),
    ("food", "రుచులు", "Food", True),
    ("inspiring", "స్ఫూర్తి", "Inspiring Stories", True),
    ("zero-to-hero", "జీరో టు హీరో", "Zero to Hero", True),
    ("best-deals", "బెస్ట్ డీల్స్", "Best Deals", True),
    ("districts", "జిల్లాలు", "Districts", False),
    ("opinion", "అభిప్రాయం", "Opinion", False),
)

TAGS: tuple[tuple[str, str, str, TagType], ...] = (
    ("amaravati", "అమరావతి", "Amaravati", TagType.PLACE),
    ("crda", "CRDA", "CRDA", TagType.ORG),
    ("capital-funds", "రాజధాని నిధులు", "Capital Funds", TagType.TOPIC),
    ("polavaram", "పోలవరం", "Polavaram", TagType.PLACE),
    ("hyderabad-metro", "హైదరాబాద్ మెట్రో", "Hyderabad Metro", TagType.TOPIC),
    ("green-hydrogen", "గ్రీన్ హైడ్రోజన్", "Green Hydrogen", TagType.TOPIC),
    ("tribal-welfare", "గిరిజన సంక్షేమం", "Tribal Welfare", TagType.TOPIC),
    ("ipl-2026", "IPL 2026", "IPL 2026", TagType.EVENT),
    ("sankranti", "సంక్రాంతి", "Sankranti", TagType.EVENT),
    ("rainfall-alert", "వర్ష హెచ్చరిక", "Rainfall Alert", TagType.TOPIC),
    ("chilli-farmers", "మిర్చి రైతులు", "Chilli Farmers", TagType.TOPIC),
    ("sugarcane", "చెరకు", "Sugarcane", TagType.TOPIC),
)


def seed_categories(db: Session) -> dict[str, Category]:
    existing = {c.slug: c for c in db.execute(select(Category)).scalars()}
    for sort, (slug, name_te, name_en, in_nav) in enumerate(CATEGORIES):
        cat = existing.get(slug)
        if cat is None:
            cat = Category(slug=slug)
            db.add(cat)
            existing[slug] = cat
        cat.name_te = name_te
        cat.name_en = name_en
        cat.sort = sort
        cat.is_active = True
        cat.show_in_nav = in_nav
    db.flush()
    logger.info("seeded_categories", count=len(existing))
    return existing


def seed_tags(db: Session) -> dict[str, Tag]:
    existing = {t.slug: t for t in db.execute(select(Tag)).scalars()}
    for slug, name_te, name_en, tag_type in TAGS:
        tag = existing.get(slug)
        if tag is None:
            tag = Tag(slug=slug)
            db.add(tag)
            existing[slug] = tag
        tag.name_te = name_te
        tag.name_en = name_en
        tag.type = tag_type
        tag.is_active = True
    db.flush()
    logger.info("seeded_tags", count=len(existing))
    return existing


# --------------------------------------------------------------------------- #
# Demo articles (development only)
# --------------------------------------------------------------------------- #
# (short_id, title_te, sub_title, summary, [paragraphs], category, district,
#  author_email, tags, hours_ago, breaking, exclusive, ai_generated)
DEMO_ARTICLES: tuple[tuple, ...] = (
    (
        "x7Kp2m",
        "అమరావతి రాజధాని నిధులు విడుదల: తొలి విడత ₹1,250 కోట్లు",
        "మూడు ప్యాకేజీల టెండర్లు ఈ వారంలోనే; పరిపాలనా నగరం పనులు వేగవంతం",
        "తొలి విడత నిధులతో పరిపాలనా నగరం పనులు వేగవంతం అవుతాయని CRDA వెల్లడించింది. మూడు ప్యాకేజీల టెండర్లు ఈ వారంలోనే.",
        [
            "అమరావతి: రాజధాని అమరావతి నిర్మాణానికి కేంద్ర ప్రభుత్వం మంగళవారం తొలి విడతగా ₹1,250 కోట్లు విడుదల చేసింది. ఈ నిధులతో పరిపాలనా నగరం తొలి దశ పనులు వేగవంతం అవుతాయని CRDA కమిషనర్ తెలిపారు.",
            "మూడు ప్యాకేజీలకు సంబంధించిన టెండర్లు ఈ వారంలోనే పిలవనున్నట్లు అధికారులు వెల్లడించారు. మొదటి దశలో సచివాలయ టవర్లు, హైకోర్టు భవనం పనులు చేపడతారు.",
            "నిధుల వినియోగంపై ప్రతి నెలా సమీక్ష నిర్వహిస్తామని, పనుల నాణ్యతలో రాజీ పడబోమని సంబంధిత అధికారి ఒకరు తెలిపారు.",
        ],
        "andhra-pradesh", "guntur", "ravi@seed.example.com",
        ["amaravati", "crda", "capital-funds"], 2, False, True, False,
    ),
    (
        "b3Nq8t",
        "విశాఖలో గ్రీన్ హైడ్రోజన్ ప్లాంట్‌కు శంకుస్థాపన",
        "తొలి దశలో 500 మెగావాట్ల సామర్థ్యం; 2,000 మందికి ఉపాధి అవకాశం",
        "విశాఖపట్నం సమీపంలో ఏర్పాటవుతున్న గ్రీన్ హైడ్రోజన్ ప్లాంట్‌కు శంకుస్థాపన జరిగింది.",
        [
            "విశాఖపట్నం: జిల్లా పరిధిలో ఏర్పాటు చేస్తున్న గ్రీన్ హైడ్రోజన్ ప్లాంట్‌కు సోమవారం శంకుస్థాపన జరిగింది. తొలి దశలో 500 మెగావాట్ల సామర్థ్యంతో ఉత్పత్తి ప్రారంభమవుతుంది.",
            "ఈ ప్రాజెక్టు ద్వారా సుమారు 2,000 మందికి ప్రత్యక్ష, పరోక్ష ఉపాధి లభిస్తుందని అధికారులు అంచనా వేశారు.",
        ],
        "andhra-pradesh", "visakhapatnam", "lakshmi@seed.example.com",
        ["green-hydrogen"], 5, False, False, False,
    ),
    (
        "k9Rt4w",
        "శ్రీకాకుళంలో భారీ వర్షాలు; 12 మండలాల్లో అలర్ట్",
        "లోతట్టు ప్రాంతాల ప్రజలను సురక్షిత ప్రాంతాలకు తరలింపు",
        "జిల్లావ్యాప్తంగా భారీ వర్షాలు కురుస్తుండటంతో 12 మండలాల్లో అధికారులు అలర్ట్ ప్రకటించారు.",
        [
            "శ్రీకాకుళం: జిల్లాలో గత 24 గంటల్లో భారీ వర్షాలు కురిశాయి. 12 మండలాల్లో అధికారులు అలర్ట్ ప్రకటించి, లోతట్టు ప్రాంతాల ప్రజలను సురక్షిత ప్రాంతాలకు తరలిస్తున్నారు.",
            "పునరావాస కేంద్రాలలో భోజనం, తాగునీరు, వైద్య సదుపాయాలు కల్పించినట్లు కలెక్టర్ తెలిపారు. మత్స్యకారులు సముద్రంలోకి వెళ్లవద్దని సూచించారు.",
        ],
        "andhra-pradesh", "srikakulam", "suresh@seed.example.com",
        ["rainfall-alert"], 3, True, False, False,
    ),
    (
        "m2Vc7h",
        "హైదరాబాద్ మెట్రో రెండో దశకు కేంద్రం ఆమోదం",
        "76 కిలోమీటర్ల కొత్త మార్గం; ఐదు కారిడార్లలో పనులు",
        "హైదరాబాద్ మెట్రో రెండో దశ ప్రతిపాదనలకు కేంద్ర ప్రభుత్వం ఆమోదం తెలిపింది.",
        [
            "హైదరాబాద్: నగర మెట్రో రెండో దశ ప్రతిపాదనలకు కేంద్రం ఆమోదం తెలిపింది. మొత్తం 76 కిలోమీటర్ల మేర కొత్త మార్గం అందుబాటులోకి రానుంది.",
            "ఐదు కారిడార్లలో పనులు దశలవారీగా చేపడతారు. తొలి కారిడార్ పనులు వచ్చే నెలలో ప్రారంభమయ్యే అవకాశం ఉంది.",
        ],
        "telangana", "hyderabad", "lakshmi@seed.example.com",
        ["hyderabad-metro"], 6, False, False, False,
    ),
    (
        "p5Jd1x",
        "మన్యంలో గిరిజన సంక్షేమానికి ₹34 కోట్లు: కలెక్టర్",
        "కొత్త హాస్టళ్లు, వైద్య సదుపాయాల విస్తరణ",
        "పార్వతీపురం మన్యం జిల్లాలో గిరిజన సంక్షేమ పథకాలపై కలెక్టర్ సమీక్ష నిర్వహించారు.",
        [
            "పార్వతీపురం: మన్యం జిల్లాలో గిరిజన సంక్షేమ పథకాల అమలుపై కలెక్టర్ సమీక్ష నిర్వహించారు. ఈ ఆర్థిక సంవత్సరంలో ₹34 కోట్లు ఖర్చు చేసినట్లు వెల్లడించారు.",
            "వచ్చే నెలలో కొత్త హాస్టళ్లు ప్రారంభమవుతాయని, గిరిజన విద్యార్థులకు వసతి సమస్య తీరుతుందని తెలిపారు.",
        ],
        "andhra-pradesh", "parvathipuram-manyam", "anusha@seed.example.com",
        ["tribal-welfare"], 8, False, False, True,
    ),
    (
        "t8Ln3q",
        "IPL 2026: హైదరాబాద్ జట్టులో కొత్త కెప్టెన్",
        "వేలం తర్వాత జట్టు కూర్పులో కీలక మార్పులు",
        "రాబోయే సీజన్‌కు హైదరాబాద్ ఫ్రాంచైజీ కొత్త కెప్టెన్‌ను ప్రకటించింది.",
        [
            "హైదరాబాద్: రాబోయే IPL సీజన్‌కు ఫ్రాంచైజీ కొత్త కెప్టెన్‌ను ప్రకటించింది. వేలం తర్వాత జట్టు కూర్పులో పలు కీలక మార్పులు చోటుచేసుకున్నాయి.",
            "బౌలింగ్ విభాగాన్ని బలోపేతం చేయడంపై దృష్టి పెట్టినట్లు జట్టు యాజమాన్యం తెలిపింది.",
        ],
        "sports", None, "kiran@seed.example.com", ["ipl-2026"], 10, False, False, False,
    ),
    (
        "f4Wz9b",
        "టాలీవుడ్: సంక్రాంతికి మూడు భారీ చిత్రాల విడుదల",
        "థియేటర్ల కేటాయింపుపై నిర్మాతల చర్చలు",
        "సంక్రాంతి సందర్భంగా మూడు భారీ చిత్రాలు ఒకేసారి విడుదల కానున్నాయి.",
        [
            "హైదరాబాద్: సంక్రాంతి పండుగ సందర్భంగా మూడు భారీ బడ్జెట్ చిత్రాలు ఒకేసారి విడుదల కానున్నాయి. థియేటర్ల కేటాయింపుపై నిర్మాతల మధ్య చర్చలు జరుగుతున్నాయి.",
            "ప్రేక్షకుల ఆదరణ ఎవరికి దక్కుతుందన్నది ఆసక్తికరంగా మారింది.",
        ],
        "cinema", None, "kiran@seed.example.com", ["sankranti"], 12, False, False, False,
    ),
    (
        "x2Fd91",
        "అనకాపల్లి చెరకు రైతుల సమావేశం",
        "మద్దతు ధర పెంపు, బకాయిల చెల్లింపుపై డిమాండ్",
        "చెరకు రైతులు మద్దతు ధర పెంపు, పెండింగ్ బకాయిల చెల్లింపు కోరుతూ సమావేశమయ్యారు.",
        [
            "అనకాపల్లి: చెరకు రైతులు మంగళవారం సమావేశమై మద్దతు ధర పెంపు, పెండింగ్ బకాయిల చెల్లింపు డిమాండ్ చేశారు.",
            "ఫ్యాక్టరీ యాజమాన్యంతో చర్చలు జరిపి సమస్య పరిష్కరిస్తామని అధికారులు హామీ ఇచ్చారు.",
        ],
        "andhra-pradesh", "anakapalli", "durga@seed.example.com",
        ["sugarcane"], 14, False, False, False,
    ),
    (
        "n6Hs2k",
        "ఖమ్మంలో మిర్చి రైతులకు మద్దతు ధర పెంపు",
        "క్వింటాలుకు అదనంగా ₹500; మార్కెట్ యార్డులో కొనుగోళ్లు",
        "మిర్చి రైతులకు మద్దతు ధర పెంచుతూ ప్రభుత్వం నిర్ణయం తీసుకుంది.",
        [
            "ఖమ్మం: మిర్చి రైతులకు మద్దతు ధరను క్వింటాలుకు అదనంగా ₹500 పెంచుతూ ప్రభుత్వం నిర్ణయం తీసుకుంది.",
            "మార్కెట్ యార్డులో కొనుగోళ్లు ఈ వారం నుంచి ప్రారంభమవుతాయని అధికారులు తెలిపారు.",
        ],
        "telangana", "khammam", "suresh@seed.example.com",
        ["chilli-farmers"], 16, False, False, False,
    ),
    (
        "c1Bg7v",
        "కడప జిల్లాలో ఉక్కు కర్మాగారం పనులు ప్రారంభం",
        "తొలి దశలో ₹3,200 కోట్ల పెట్టుబడి",
        "కడప జిల్లాలో ప్రతిపాదిత ఉక్కు కర్మాగారం పనులు ప్రారంభమయ్యాయి.",
        [
            "కడప: జిల్లాలో ప్రతిపాదిత ఉక్కు కర్మాగారం పనులు ప్రారంభమయ్యాయి. తొలి దశలో ₹3,200 కోట్ల పెట్టుబడి పెట్టనున్నట్లు అధికారులు తెలిపారు.",
            "స్థానికులకు ఉపాధి అవకాశాల్లో ప్రాధాన్యం ఇస్తామని యాజమాన్యం ప్రకటించింది.",
        ],
        "andhra-pradesh", "kadapa", "ravi@seed.example.com", [], 20, False, False, False,
    ),
    (
        "r7Yt5n",
        "పోలవరం ప్రాజెక్ట్ కీలక దశకు — నేడు ముఖ్యమంత్రి సమీక్ష",
        "డయాఫ్రం వాల్ పనుల పురోగతిపై నివేదిక",
        "పోలవరం ప్రాజెక్టు పనుల పురోగతిపై ముఖ్యమంత్రి సమీక్ష నిర్వహించనున్నారు.",
        [
            "అమరావతి: పోలవరం ప్రాజెక్టు పనుల పురోగతిపై ముఖ్యమంత్రి బుధవారం సమీక్ష నిర్వహించనున్నారు. డయాఫ్రం వాల్ పనుల నివేదికను అధికారులు సమర్పించనున్నారు.",
            "నిర్దేశిత గడువులోగా పనులు పూర్తి చేయాలని ఇప్పటికే ఆదేశాలు జారీ అయ్యాయి.",
        ],
        "andhra-pradesh", "eluru", "lakshmi@seed.example.com",
        ["polavaram"], 1, True, False, False,
    ),
    (
        "v3Mq6p",
        "విశాఖ పోర్టు కొత్త బెర్త్‌ల విస్తరణ ప్రణాళిక",
        "సరుకు రవాణా సామర్థ్యం రెట్టింపు లక్ష్యం",
        "విశాఖ పోర్టులో కొత్త బెర్త్‌ల నిర్మాణానికి ప్రణాళిక సిద్ధమైంది.",
        [
            "విశాఖపట్నం: పోర్టులో కొత్త బెర్త్‌ల నిర్మాణానికి ప్రణాళిక సిద్ధమైంది. సరుకు రవాణా సామర్థ్యాన్ని రెట్టింపు చేయడమే లక్ష్యమని అధికారులు తెలిపారు.",
            "పర్యావరణ అనుమతుల ప్రక్రియ తుది దశలో ఉంది.",
        ],
        "business", "visakhapatnam", "lakshmi@seed.example.com", [], 22, False, False, False,
    ),
    (
        "g8Kr2d",
        "జాతీయ రహదారుల విస్తరణకు కేంద్రం ₹8,400 కోట్లు",
        "రెండు రాష్ట్రాల్లో ఏడు ప్రాజెక్టులకు ఆమోదం",
        "రెండు తెలుగు రాష్ట్రాల్లో జాతీయ రహదారుల విస్తరణ పనులకు కేంద్రం నిధులు కేటాయించింది.",
        [
            "న్యూఢిల్లీ: రెండు తెలుగు రాష్ట్రాల్లో జాతీయ రహదారుల విస్తరణ పనులకు కేంద్ర ప్రభుత్వం ₹8,400 కోట్లు కేటాయించింది.",
            "ఏడు ప్రాజెక్టులకు ఆమోదం లభించగా, పనులు వచ్చే త్రైమాసికంలో ప్రారంభమవుతాయి.",
        ],
        "national", None, "kiran@seed.example.com", [], 4, False, False, False,
    ),
    (
        "h3Nm7c",
        "రైతు భరోసా నిధులు విడుదల; 52 లక్షల మందికి లబ్ధి",
        "నేరుగా ఖాతాల్లోకి జమ",
        "రైతు భరోసా పథకం కింద నిధులు లబ్ధిదారుల ఖాతాల్లో జమ చేసినట్లు అధికారులు తెలిపారు.",
        [
            "అమరావతి: రైతు భరోసా పథకం కింద ఈ విడత నిధులను లబ్ధిదారుల ఖాతాల్లో నేరుగా జమ చేసినట్లు అధికారులు వెల్లడించారు.",
            "మొత్తం 52 లక్షల మంది రైతులకు లబ్ధి చేకూరనుంది.",
        ],
        "andhra-pradesh", "guntur", "ravi@seed.example.com", [], 7, False, False, False,
    ),
    (
        "j9Pw4t",
        "ఐటీ కారిడార్‌లో కొత్త కంపెనీల రాక; 12 వేల ఉద్యోగాలు",
        "మూడు సంస్థలతో ఒప్పందం",
        "హైదరాబాద్ ఐటీ కారిడార్‌లో మూడు కొత్త సంస్థలు కార్యాలయాలు ఏర్పాటు చేయనున్నాయి.",
        [
            "హైదరాబాద్: నగర ఐటీ కారిడార్‌లో మూడు కొత్త సంస్థలు కార్యాలయాలు ఏర్పాటు చేసేందుకు ఒప్పందం కుదిరింది.",
            "సుమారు 12 వేల ఉద్యోగాలు అందుబాటులోకి వస్తాయని అంచనా.",
        ],
        "business", "hyderabad", "lakshmi@seed.example.com", [], 9, False, False, False,
    ),
    (
        "q4Lz8m",
        "విద్యుత్ చార్జీల సవరణపై ఈఆర్‌సీ బహిరంగ విచారణ",
        "వినియోగదారుల అభ్యంతరాల స్వీకరణ",
        "విద్యుత్ చార్జీల సవరణ ప్రతిపాదనలపై ఈఆర్‌సీ బహిరంగ విచారణ నిర్వహించనుంది.",
        [
            "విజయవాడ: విద్యుత్ చార్జీల సవరణ ప్రతిపాదనలపై నియంత్రణ మండలి బహిరంగ విచారణ నిర్వహించనుంది.",
            "వినియోగదారుల నుంచి అభ్యంతరాలు స్వీకరిస్తామని అధికారులు తెలిపారు.",
        ],
        "andhra-pradesh", "ntr", "kiran@seed.example.com", [], 11, False, False, False,
    ),
    (
        "s2Vx6r",
        "వరంగల్‌లో ప్రభుత్వ వైద్య కళాశాలకు అనుమతి",
        "150 ఎంబీబీఎస్ సీట్లు",
        "వరంగల్ జిల్లాలో కొత్త ప్రభుత్వ వైద్య కళాశాల ఏర్పాటుకు అనుమతి లభించింది.",
        [
            "వరంగల్: జిల్లాలో కొత్త ప్రభుత్వ వైద్య కళాశాల ఏర్పాటుకు అనుమతి లభించింది. తొలి ఏడాది 150 ఎంబీబీఎస్ సీట్లు అందుబాటులో ఉంటాయి.",
        ],
        "telangana", "warangal", "suresh@seed.example.com", [], 13, False, False, False,
    ),
    (
        "u5Cd3j",
        "క్రీడాకారులకు నగదు ప్రోత్సాహకాలు పెంపు",
        "జాతీయ స్థాయి పతక విజేతలకు అదనపు మొత్తం",
        "జాతీయ, అంతర్జాతీయ స్థాయిలో పతకాలు సాధించిన క్రీడాకారులకు ప్రోత్సాహకాలు పెంచారు.",
        [
            "హైదరాబాద్: జాతీయ, అంతర్జాతీయ స్థాయిలో పతకాలు సాధించిన క్రీడాకారులకు నగదు ప్రోత్సాహకాలను ప్రభుత్వం పెంచింది.",
        ],
        "sports", None, "kiran@seed.example.com", [], 15, False, False, False,
    ),
    (
        "w8Bn1f",
        "సినీ కార్మికుల సమ్మె విరమణ; షూటింగ్‌లు పునఃప్రారంభం",
        "వేతన సవరణపై ఒప్పందం",
        "సినీ కార్మికుల సమ్మె విరమణతో షూటింగ్‌లు తిరిగి ప్రారంభమయ్యాయి.",
        [
            "హైదరాబాద్: వేతన సవరణపై ఒప్పందం కుదరడంతో సినీ కార్మికులు సమ్మెను విరమించారు. షూటింగ్‌లు తిరిగి ప్రారంభమయ్యాయి.",
        ],
        "cinema", None, "kiran@seed.example.com", [], 17, False, False, False,
    ),
    (
        "y1Gk9s",
        "సముద్ర తీరంలో ఇసుక తవ్వకాలపై నిషేధం",
        "పర్యావరణ నివేదిక ఆధారంగా నిర్ణయం",
        "తీర ప్రాంతంలో ఇసుక తవ్వకాలపై అధికారులు నిషేధం విధించారు.",
        [
            "శ్రీకాకుళం: పర్యావరణ నివేదిక ఆధారంగా తీర ప్రాంతంలో ఇసుక తవ్వకాలపై అధికారులు నిషేధం విధించారు.",
        ],
        "andhra-pradesh", "srikakulam", "suresh@seed.example.com", [], 19, False, False, False,
    ),
    (
        "z6Hq4l",
        "ప్రభుత్వ పాఠశాలల్లో డిజిటల్ తరగతుల విస్తరణ",
        "మొదటి దశలో 4,200 పాఠశాలలు",
        "ప్రభుత్వ పాఠశాలల్లో డిజిటల్ తరగతుల ఏర్పాటును విస్తరిస్తున్నారు.",
        [
            "అమరావతి: ప్రభుత్వ పాఠశాలల్లో డిజిటల్ తరగతుల ఏర్పాటును విస్తరిస్తున్నట్లు విద్యాశాఖ ప్రకటించింది. మొదటి దశలో 4,200 పాఠశాలలు ఎంపికయ్యాయి.",
        ],
        "andhra-pradesh", None, "lakshmi@seed.example.com", [], 21, False, False, False,
    ),
    (
        "a9Tr2v",
        "మెట్రో రెండో దశ: భూసేకరణ ప్రక్రియ వేగవంతం",
        "మూడు నెలల్లో పూర్తి లక్ష్యం",
        "మెట్రో రెండో దశ కోసం భూసేకరణ ప్రక్రియను వేగవంతం చేశారు.",
        [
            "హైదరాబాద్: మెట్రో రెండో దశ కోసం భూసేకరణ ప్రక్రియను వేగవంతం చేసినట్లు అధికారులు తెలిపారు.",
        ],
        "telangana", "hyderabad", "lakshmi@seed.example.com", ["hyderabad-metro"], 23, False, False, False,
    ),
    (
        "b7Dm5x",
        "ఎగుమతుల్లో వృద్ధి; ఆక్వా రంగానికి ఊతం",
        "గత ఏడాదితో పోలిస్తే 18 శాతం పెరుగుదల",
        "ఆక్వా ఉత్పత్తుల ఎగుమతుల్లో గణనీయ వృద్ధి నమోదైంది.",
        [
            "కాకినాడ: ఆక్వా ఉత్పత్తుల ఎగుమతుల్లో గత ఏడాదితో పోలిస్తే 18 శాతం వృద్ధి నమోదైనట్లు అధికారిక గణాంకాలు చెబుతున్నాయి.",
        ],
        "business", "kakinada", "ravi@seed.example.com", [], 26, False, False, False,
    ),
    (
        "c3Fj8w",
        "వాతావరణం: రాబోయే మూడు రోజులు తేలికపాటి వర్షాలు",
        "ఉత్తర కోస్తాలో ఓ మోస్తరు జల్లులు",
        "రాబోయే మూడు రోజులు పలు జిల్లాల్లో తేలికపాటి వర్షాలు కురిసే అవకాశం ఉంది.",
        [
            "అమరావతి: రాబోయే మూడు రోజులు పలు జిల్లాల్లో తేలికపాటి నుంచి ఓ మోస్తరు వర్షాలు కురిసే అవకాశం ఉందని వాతావరణ శాఖ తెలిపింది.",
        ],
        "andhra-pradesh", None, "suresh@seed.example.com", [], 28, False, False, False,
    ),
)


def seed_demo_articles(
    db: Session, categories: dict[str, Category], tags: dict[str, Tag]
) -> int:
    if settings.is_production:
        raise RuntimeError("Refusing to write demo articles in production (brief §40)")

    districts = {d.slug: d for d in db.execute(select(District)).scalars()}
    users = {u.email: u for u in db.execute(select(User)).scalars() if u.email}
    editor = users.get("srinivas@seed.example.com")  # editor_in_chief approves
    now = utcnow()
    written = 0

    for (
        short_id, title_te, sub_title, summary, paragraphs, cat_slug, district_slug,
        author_email, tag_slugs, hours_ago, is_breaking, is_exclusive, ai_generated,
    ) in DEMO_ARTICLES:
        existing = db.execute(
            select(Article).where(Article.short_id == short_id)
        ).scalar_one_or_none()
        if existing is not None:
            continue

        author = users.get(author_email)
        published_at = now - timedelta(hours=hours_ago)

        body = tiptap.doc_from_paragraphs(paragraphs)
        clean_body, body_plain, body_html, words, reading_sec = tiptap.derive(body)

        title = normalize_headline(title_te)
        article = Article(
            short_id=short_id,
            slug=slugify(title),
            title_te=title,
            title_en=None,
            sub_title_te=normalize_headline(sub_title),
            summary_te=normalize_text(summary),
            body=clean_body,
            body_plain=body_plain,
            body_html=body_html,
            word_count=words,
            reading_time_sec=reading_sec,
            category_id=categories[cat_slug].id if cat_slug in categories else None,
            district_id=districts[district_slug].id if district_slug in districts else None,
            # These demo rows stand in for already-approved, already-published
            # copy so the reader site has something to render. They still carry a
            # real approver that differs from the author (§6.3) and a full
            # workflow history — no row bypasses the state machine.
            status=ArticleStatus.PUBLISHED,
            workflow_state=WorkflowState.PUBLISHED,
            is_breaking=is_breaking,
            is_exclusive=is_exclusive,
            ai_generated=ai_generated,
            ai_model="gemini-2.5-pro" if ai_generated else None,
            author_id=author.id if author else None,
            byline_te=author.name_te if author else None,
            source_type=DEMO_SOURCE_TYPE,
            approved_by=editor.id if editor else None,
            approved_at=published_at - timedelta(minutes=20),
            published_by=editor.id if editor else None,
            published_at=published_at,
            first_published_at=published_at,
            seo_title=title[:200],
            seo_description=(summary or title)[:400],
            created_by=author.id if author else None,
            updated_by=editor.id if editor else None,
        )
        db.add(article)
        db.flush()

        for i, tag_slug in enumerate(tag_slugs):
            if tag_slug in tags:
                db.add(ArticleTag(article_id=article.id, tag_id=tags[tag_slug].id, sort=i))
                tags[tag_slug].usage_count += 1

        for alias in search_aliases(title)[:12]:
            db.add(ArticleSearchAlias(article_id=article.id, alias=alias, source="auto"))

        # A published article must have the transition history to prove it.
        for from_state, to_state, offset in (
            (None, WorkflowState.DRAFT, 120),
            (WorkflowState.DRAFT, WorkflowState.SUBMITTED, 90),
            (WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW, 60),
            (WorkflowState.IN_REVIEW, WorkflowState.APPROVED, 20),
            (WorkflowState.APPROVED, WorkflowState.PUBLISHED, 0),
        ):
            db.add(
                WorkflowTransition(
                    article_id=article.id,
                    from_state=from_state,
                    to_state=to_state,
                    actor_id=(author.id if author and to_state in (
                        WorkflowState.DRAFT, WorkflowState.SUBMITTED) else
                        (editor.id if editor else None)),
                    note="seeded demo history",
                    created_at=published_at - timedelta(minutes=offset),
                )
            )
        written += 1

    db.flush()
    logger.info("seeded_demo_articles", written=written, total=len(DEMO_ARTICLES))
    return written
