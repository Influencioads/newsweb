"""Reference data seeded into every environment.

Districts are the real post-2022 reorganisation lists: Andhra Pradesh 26 and
Telangana 33 (§5 "AP 26 + TS 33 districts"). These are reference data, not demo
data — they ship to production. Demo *users* and *articles* are separate and
clearly marked (brief §41).

Slugs are transliterated English (§4.5): Telugu slugs percent-encode into
200-character URLs that look like spam when shared on WhatsApp.
"""

from __future__ import annotations

# (slug, name_en, name_te)
AP_DISTRICTS: tuple[tuple[str, str, str], ...] = (
    ("alluri-sitharama-raju", "Alluri Sitharama Raju", "అల్లూరి సీతారామరాజు"),
    ("anakapalli", "Anakapalli", "అనకాపల్లి"),
    ("ananthapuramu", "Ananthapuramu", "అనంతపురము"),
    ("annamayya", "Annamayya", "అన్నమయ్య"),
    ("bapatla", "Bapatla", "బాపట్ల"),
    ("chittoor", "Chittoor", "చిత్తూరు"),
    ("konaseema", "Dr. B.R. Ambedkar Konaseema", "డా. బి.ఆర్. అంబేద్కర్ కోనసీమ"),
    ("east-godavari", "East Godavari", "తూర్పు గోదావరి"),
    ("eluru", "Eluru", "ఏలూరు"),
    ("guntur", "Guntur", "గుంటూరు"),
    ("kakinada", "Kakinada", "కాకినాడ"),
    ("krishna", "Krishna", "కృష్ణా"),
    ("kurnool", "Kurnool", "కర్నూలు"),
    ("nandyal", "Nandyal", "నంద్యాల"),
    ("ntr", "NTR", "ఎన్టీఆర్"),
    ("palnadu", "Palnadu", "పల్నాడు"),
    ("parvathipuram-manyam", "Parvathipuram Manyam", "పార్వతీపురం మన్యం"),
    ("prakasam", "Prakasam", "ప్రకాశం"),
    ("nellore", "Sri Potti Sriramulu Nellore", "శ్రీ పొట్టి శ్రీరాములు నెల్లూరు"),
    ("sri-sathya-sai", "Sri Sathya Sai", "శ్రీ సత్యసాయి"),
    ("srikakulam", "Srikakulam", "శ్రీకాకుళం"),
    ("tirupati", "Tirupati", "తిరుపతి"),
    ("visakhapatnam", "Visakhapatnam", "విశాఖపట్నం"),
    ("vizianagaram", "Vizianagaram", "విజయనగరం"),
    ("west-godavari", "West Godavari", "పశ్చిమ గోదావరి"),
    ("kadapa", "YSR Kadapa", "వైఎస్సార్ కడప"),
)

TS_DISTRICTS: tuple[tuple[str, str, str], ...] = (
    ("adilabad", "Adilabad", "ఆదిలాబాద్"),
    ("bhadradri-kothagudem", "Bhadradri Kothagudem", "భద్రాద్రి కొత్తగూడెం"),
    ("hanamkonda", "Hanamkonda", "హనుమకొండ"),
    ("hyderabad", "Hyderabad", "హైదరాబాద్"),
    ("jagtial", "Jagtial", "జగిత్యాల"),
    ("jangaon", "Jangaon", "జనగామ"),
    ("jayashankar-bhupalpally", "Jayashankar Bhupalpally", "జయశంకర్ భూపాలపల్లి"),
    ("jogulamba-gadwal", "Jogulamba Gadwal", "జోగులాంబ గద్వాల"),
    ("kamareddy", "Kamareddy", "కామారెడ్డి"),
    ("karimnagar", "Karimnagar", "కరీంనగర్"),
    ("khammam", "Khammam", "ఖమ్మం"),
    ("komaram-bheem-asifabad", "Komaram Bheem Asifabad", "కుమురం భీం ఆసిఫాబాద్"),
    ("mahabubabad", "Mahabubabad", "మహబూబాబాద్"),
    ("mahabubnagar", "Mahabubnagar", "మహబూబ్‌నగర్"),
    ("mancherial", "Mancherial", "మంచిర్యాల"),
    ("medak", "Medak", "మెదక్"),
    ("medchal-malkajgiri", "Medchal-Malkajgiri", "మేడ్చల్-మల్కాజ్‌గిరి"),
    ("mulugu", "Mulugu", "ములుగు"),
    ("nagarkurnool", "Nagarkurnool", "నాగర్‌కర్నూల్"),
    ("nalgonda", "Nalgonda", "నల్గొండ"),
    ("narayanpet", "Narayanpet", "నారాయణపేట"),
    ("nirmal", "Nirmal", "నిర్మల్"),
    ("nizamabad", "Nizamabad", "నిజామాబాద్"),
    ("peddapalli", "Peddapalli", "పెద్దపల్లి"),
    ("rajanna-sircilla", "Rajanna Sircilla", "రాజన్న సిరిసిల్ల"),
    ("rangareddy", "Rangareddy", "రంగారెడ్డి"),
    ("sangareddy", "Sangareddy", "సంగారెడ్డి"),
    ("siddipet", "Siddipet", "సిద్దిపేట"),
    ("suryapet", "Suryapet", "సూర్యాపేట"),
    ("vikarabad", "Vikarabad", "వికారాబాద్"),
    ("wanaparthy", "Wanaparthy", "వనపర్తి"),
    ("warangal", "Warangal", "వరంగల్"),
    ("yadadri-bhuvanagiri", "Yadadri Bhuvanagiri", "యాదాద్రి భువనగిరి"),
)

#: A few mandals for the districts the mockup uses, so stringer scoping is
#: testable end to end. The full mandal list is an import job, not a seed.
MANDALS: dict[str, tuple[tuple[str, str, str], ...]] = {
    "parvathipuram-manyam": (
        ("parvathipuram", "Parvathipuram", "పార్వతీపురం"),
        ("salur", "Salur", "సాలూరు"),
        ("kurupam", "Kurupam", "కురుపాం"),
    ),
    "visakhapatnam": (
        ("bheemunipatnam", "Bheemunipatnam", "భీమునిపట్నం"),
        ("gajuwaka", "Gajuwaka", "గాజువాక"),
        ("pendurthi", "Pendurthi", "పెందుర్తి"),
    ),
    "anakapalli": (
        ("anakapalli-rural", "Anakapalli Rural", "అనకాపల్లి రూరల్"),
        ("chodavaram", "Chodavaram", "చోడవరం"),
    ),
    "srikakulam": (
        ("srikakulam-rural", "Srikakulam Rural", "శ్రీకాకుళం రూరల్"),
        ("tekkali", "Tekkali", "టెక్కలి"),
    ),
    "ntr": (("vijayawada-rural", "Vijayawada Rural", "విజయవాడ రూరల్"),),
    "guntur": (("thullur", "Thullur", "తుళ్లూరు"),),
    "khammam": (("khammam-rural", "Khammam Rural", "ఖమ్మం రూరల్"),),
    "kadapa": (("kadapa-rural", "Kadapa Rural", "కడప రూరల్"),),
}
