"""Which model, answered once (updated doc §15–19).

Five places used to carry their own idea of the right model — the chat
adapter's fallback, the TTS adapter's, the settings dropdown, the deploy
environment and the crawl worker — and they drifted apart, which is how an
editor ends up paying 29x for a rewrite nobody asked to be expensive. This
module is the one curated list they all import.

Every figure here was measured on 2026-09-18 with this project's own aimlapi
key. aimlapi publishes no prices and marks its vendors up, so a public price
list is not a substitute: do not "correct" these numbers from memory.

What this module refuses to do: hold a key, open a socket, or read a setting.
Importing it stays free, because the settings screen, the adapters and the
tests all import it.

A model is listed only if it actually worked in that measurement *and* an
editor has a reason to reach for it. One deliberate exception:
`moonshot/kimi-k3` is what the deploy environment currently exports, so
hiding it would make the settings screen disagree with the running system.

Deliberately absent, and why — so the next person does not re-buy the answer:
  * `x-ai/grok-4-1-fast-non-reasoning` — fabricated a figure (4 crore for a
    reported 42 lakh). One invented number in Telugu copy is the whole product.
  * `zhipu/glm-5.3-flash`, `alibaba/qwen3.8-flash` — 98 s and 84 s, and glm
    still returned truncated JSON at the full 8192-token ceiling.
  * `deepseek/deepseek-v4-flash` (35 s), `anthropic/claude-sonnet-5` (28 s),
    `bytedance/seedream-5-0-lite` (39 s) — all past AI_DEFAULT_TIMEOUT_MS. A
    charged call the client already abandoned is the worst outcome available.
  * `google/gemini-3-6-flash` — worked, but editorialised a headline
    ("సంచలన నిర్ణయం") and costs twice gemini-3-8-flash, which did not.
  * `google/nano-banana`, `google/gemini-3.1-flash-image`,
    `blackforestlabs/flux-pro-1.1`, `alibaba/z-image-turbo` — four to nine
    times the listed image models with no measured advantage; nano-banana also
    ignored a prompt constraint and drew garbled text.
  * `openai/tts-1`, `inworld/tts-1-5-mini`, `alibaba/qwen3-tts-flash`,
    `hume/octave-2`, `deepgram/aura-2` — 16x to 100x openai/gpt-4o-mini-tts.
    The last three answer with WAV, and hume sent 1.3 MB for one sentence.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

__all__ = [
    "Choice",
    "VoicePreset",
    "DEFAULT_BULK_MODEL",
    "DEFAULT_IMAGE_MODEL",
    "DEFAULT_TEXT_MODEL",
    "DEFAULT_SARVAM_MODEL",
    "DEFAULT_TTS_MODEL",
    "IMAGE",
    "IMAGE_SIZE_ARG",
    "MAX_OUTPUT_TOKENS",
    "TEXT",
    "SARVAM_MAX_CHARS",
    "SARVAM_NEWS_PRESETS",
    "SARVAM_TTS",
    "TTS",
    "TTS_SPEED_RANGE",
    "VISION_MODEL",
    "choices_for",
    "image_size_args",
    "sarvam_model",
    "sarvam_pace_range",
    "voice_presets",
    "tts_accepts_speed",
    "tts_voices",
    "valid_voice",
]


@dataclass(frozen=True, slots=True)
class Choice:
    """One selectable model.

    `usd_per_call` is a measurement, not a rate card: it is what one
    representative call actually cost, and the settings screen shows it so an
    editor can see the 29x before choosing it. `0.0` means aimlapi reported no
    `usd_spent` for that vendor — unknown, not free.
    """

    id: str
    label: str
    tier: str
    usd_per_call: float
    note: str


@dataclass(frozen=True, slots=True)
class VoicePreset:
    """One named starting point for a TTS voice: who reads, and how fast.

    `pace` is the claim worth trusting — it is the measurable difference
    between one channel's bulletin read and another's. `speaker` is a first
    pick to audition, not a likeness. See `SARVAM_NEWS_PRESETS`.
    """

    label: str
    speaker: str
    pace: float
    note: str


# --------------------------------------------------------------------------- #
# Text
# --------------------------------------------------------------------------- #
TEXT: tuple[Choice, ...] = (
    Choice(
        id="google/gemini-3-8-flash",
        label="Gemini 3.8 Flash",
        tier="best",
        usd_per_call=0.0089,
        note="Best Telugu of everything measured — use it for copy that runs "
        "under our masthead.",
    ),
    Choice(
        id="google/gemini-3-7-flash",
        label="Gemini 3.7 Flash",
        tier="best",
        usd_per_call=0.0076,
        note="Also correct Telugu, slightly cheaper than 3.8 Flash — the "
        "fallback when 3.8 is unavailable.",
    ),
    Choice(
        id="google/gemini-3-5-flash-lite",
        label="Gemini 3.5 Flash Lite",
        tier="value",
        usd_per_call=0.0016,
        note="Correct Telugu in three seconds for a fifth of 3.8 Flash — the "
        "only model the monthly budget survives at crawl volume.",
    ),
    Choice(
        id="openai/gpt-4o-mini",
        label="GPT-4o mini",
        tier="value",
        usd_per_call=0.000326,
        note="Cheapest that works, but it misspelt an ordinary Telugu word "
        "in the measured run — English-side work only.",
    ),
    Choice(
        id="moonshot/kimi-k3",
        label="Kimi K3",
        tier="best",
        usd_per_call=0.047,
        note="What the deploy environment exports today. It works, and it "
        "costs 29x the bulk model — roughly ₹1.8 lakh a month at crawl "
        "volume against a ₹15,000 budget. Listed so the screen tells the "
        "truth, not because it should be selected.",
    ),
)

# --------------------------------------------------------------------------- #
# Image
# --------------------------------------------------------------------------- #
IMAGE: tuple[Choice, ...] = (
    Choice(
        id="openai/gpt-image-2.5-flare",
        label="GPT Image 2.5 Flare",
        tier="best",
        usd_per_call=0.0066,
        note="Measured 2026-09-23: a third of the price of 1.5 at quality low, "
        "~15 s. With the realistic prompt (2026-09-30) a convincing "
        "natural-light photograph that looks like Andhra Pradesh and "
        "Telangana. It can even letter Telugu — but it invented price boards "
        "the story never mentioned, which is why news cards typeset their "
        "text themselves.",
    ),
    Choice(
        id="openai/gpt-image-2.5-sunburst",
        label="GPT Image 2.5 Sunburst",
        tier="best",
        usd_per_call=0.0066,
        note="Same price, speed and photographic realism as Flare "
        "(2026-09-30), but its ambulances and hospitals looked American, not "
        "Indian.",
    ),
    Choice(
        id="openai/gpt-image-1.5",
        label="GPT Image 1.5",
        tier="best",
        usd_per_call=0.0202,
        note="Best prompt adherence measured: culturally right, no garbled "
        "fake lettering, and real empty space on the left for a headline.",
    ),
    Choice(
        id="blackforestlabs/flux-2-klein-4b",
        label="FLUX.2 Klein 4B",
        tier="value",
        usd_per_call=0.0102,
        note="Half the price and twice the speed for a flat-vector look, but "
        "it drew fake lettering on an object even when told not to — avoid "
        "it for anything showing a sign or a document.",
    ),
)

# --------------------------------------------------------------------------- #
# Text-to-speech
# --------------------------------------------------------------------------- #
TTS: tuple[Choice, ...] = (
    Choice(
        id="openai/gpt-4o-mini-tts",
        label="GPT-4o mini TTS",
        tier="value",
        usd_per_call=0.0000905,
        note="Real MP3 in under three seconds, and at least sixteen times "
        "cheaper than anything else that worked — the default for bulletins.",
    ),
    Choice(
        id="elevenlabs/eleven_multilingual_v2",
        label="ElevenLabs Multilingual v2",
        tier="best",
        usd_per_call=0.0,
        note="The best-sounding voice on the account, for a bulletin that "
        "matters. aimlapi reports no cost for ElevenLabs, so watch the "
        "vendor balance rather than the usage meter.",
    ),
    Choice(
        id="elevenlabs/eleven_turbo_v2_5",
        label="ElevenLabs Turbo v2.5",
        tier="best",
        usd_per_call=0.0,
        note="The same voices at roughly half the latency — pick it for a "
        "long bulletin where the wait is the problem. Cost also unreported.",
    ),
)

DEFAULT_TEXT_MODEL = "google/gemini-3-8-flash"
DEFAULT_BULK_MODEL = "google/gemini-3-5-flash-lite"
DEFAULT_IMAGE_MODEL = "openai/gpt-image-2.5-flare"
DEFAULT_TTS_MODEL = "openai/gpt-4o-mini-tts"
#: The assistant's web search: a search-grounded model that answers with the
#: pages it read (`citations` + `search_results` with dates and snippets).
#: Measured 2026-09-29 on aimlapi: $0.007 and ~4 s per query, and it said
#: plainly which prices its sources did not state instead of inventing them.
#: aimlapi only - it is not an OpenAI model.
DEFAULT_RESEARCH_MODEL = "perplexity/sonar"
#: The crawl's photo check (`LlmAi.inspect_image`): a verdict per crawled
#: photo, never an edit. Measured 2026-09-30 on aimlapi, 6 clean heroes + 12
#: photos carrying a publisher's headline band, watermark or logo, at 1024 px:
#: no branded photo judged clean, 4/6 clean accepted (one "logo" for a channel
#: mic flag in the scene, one answer with no verdict), median 3.6 s, $0.00063 a
#: call. gemini-3-8-flash (5/6, 5.5 s, $0.0023, three 5xx) and gpt-4o-mini
#: (5/6, 3.1 s, $0.0049 - it bills an image like gpt-4o, and called jersey
#: sponsors a logo) also passed, at 4-8x the price. 768 px cost flash-lite the
#: same and changed no verdict; 1024 stays for small corner marks. aimlapi
#: only: on any other provider `inspect_image` answers None (not scanned).
VISION_MODEL = "google/gemini-3-5-flash-lite"

# --------------------------------------------------------------------------- #
# Text-to-speech — Sarvam AI
# --------------------------------------------------------------------------- #
# A separate account and a separate list, on purpose. Everything above was
# measured through aimlapi and priced from what aimlapi charged; Sarvam bills
# direct and reports no spend in its response, so `usd_per_call=0.0` here means
# what it means for ElevenLabs — unknown, not free. Check the Sarvam dashboard.
#
# The ids carry a `sarvam/` prefix the API never sees: `voice.model` is one
# settings row shared by both providers, and the prefix is how the screen and
# `valid_voice` tell whose model is selected. `sarvam_model` strips it again.
SARVAM_TTS: tuple[Choice, ...] = (
    Choice(
        id="sarvam/bulbul:v3",
        label="Bulbul v3",
        tier="best",
        usd_per_call=0.0,
        note="37 Indic voices and 2500 characters a call. Pace is the only "
        "tone control this project sends it — v3 replaced v2's pitch and "
        "loudness with a temperature, which is not a news-reading lever.",
    ),
)

#: `bulbul:v2` is NOT here because it no longer works. Measured 2026-09-19 with
#: this project's own key: it answers 400 `"Model 'bulbul:v2' has been
#: deprecated. Please use 'bulbul:v3' instead."` Listing it would sell an
#: editor a model that cannot speak.
_SARVAM_DEPRECATED = frozenset({"bulbul:v2", "bulbul:v1"})

DEFAULT_SARVAM_MODEL = "bulbul:v3"

#: The per-request text ceiling, in characters. v3 documents 2500; 1500 is kept
#: as the working figure because it is the number that was actually exercised,
#: and an extra request costs less than a 422 on a long article.
SARVAM_MAX_CHARS = 1500

#: `pace` range per model, from the published reference. They differ, and a
#: value outside the range is a 422 on a call that was about to cost money.
_SARVAM_PACE: dict[str, tuple[float, float]] = {
    "bulbul:v3": (0.5, 2.0),
}


def sarvam_model(model: str) -> str:
    """The bare model name Sarvam's API wants, out of whatever is configured.

    Tolerates the `sarvam/` prefix the settings dropdown stores, a bare name
    typed by hand, and blank. An unknown name is passed through rather than
    replaced: Sarvam ships models faster than this list is updated, and a 422
    naming the model an admin typed is a better error than silently speaking
    in a voice they did not choose.

    The one name that is *not* passed through is another vendor's. `voice.model`
    is a single settings row shared with aimlapi, so switching the provider
    leaves `openai/gpt-4o-mini-tts` sitting in it — and every Sarvam model name
    is slash-free, which makes "has a slash" a reliable test for "this belongs
    to the other provider" and the default the right answer.

    A retired model is redirected the same way. A settings row saved before
    Sarvam dropped `bulbul:v2` would otherwise 400 on every article, and the
    current model is unambiguously what that admin meant.
    """
    name = (model or "").strip().removeprefix("sarvam/")
    if "/" in name or name in _SARVAM_DEPRECATED:
        return DEFAULT_SARVAM_MODEL
    return name or DEFAULT_SARVAM_MODEL


def sarvam_pace_range(model: str) -> tuple[float, float]:
    """The `pace` range `model` accepts. The narrower of the two for anything
    unknown, so a clamp is never the thing that causes the 422."""
    return _SARVAM_PACE.get(sarvam_model(model), (0.5, 2.0))


# --------------------------------------------------------------------------- #
# Telugu bulletin presets — a starting point, not a likeness
# --------------------------------------------------------------------------- #
# What an editor actually asks is "make it sound like the news", and the answer
# is two numbers and a speaker they would otherwise find by auditioning seven
# voices one at a time. These presets are the shortcut.
#
# Read what they claim carefully, because it is narrow on purpose. Telugu
# channels have recognisably different house reads — ETV is the formal,
# measured, near-literary bulletin; TV9 is faster and headline-driven; NTV
# sits between them — and the PACE here is that difference, which is a
# property of the delivery and is the part worth copying.
#
# The SPEAKER attached to each was chosen by measurement on 2026-09-19, not by
# ear: every v3 voice was rendered and its pitch analysed (median F0, spread
# in semitones, loudness range). Among the women, priya is the lowest and
# flattest (214 Hz, 2.3 st) — the calm formal read; ritu (223 Hz, 3.3 st)
# and kavya (248 Hz, 3.0 st) sit brighter. Among the men, aditya is the
# deepest (96 Hz), rahul the highest (149 Hz), and varun the most animated
# (96 Hz, 4.75 st — the widest pitch swing of the six). That is still a
# match to a *register*, not to any person: nobody here has compared these
# against a broadcast recording, and the pace numbers are judged from on-air
# reads rather than measured against a reference clip.
#
# Deliberately absent: any attempt to reproduce a named journalist's voice.
# These are house-style references, and the individual anchors at those
# channels have not agreed to read our copy.
#
# ponytail: pace and speaker are tuned by signal statistics, not by a listener
# with a reference clip. Hand this a 30 s ETV/NTV/TV9 recording and the same
# analysis can match rate and pitch range to it directly.
SARVAM_NEWS_PRESETS: dict[str, tuple[VoicePreset, ...]] = {
    "sarvam/bulbul:v3": (
        VoicePreset("ETV-style — female", "priya", 0.92,
                    "Formal, unhurried bulletin read. The lowest, steadiest "
                    "female voice measured (214 Hz, 2.3 st spread)."),
        VoicePreset("ETV-style — male", "aditya", 0.90,
                    "Measured male read for heavier copy. The deepest voice "
                    "measured (96 Hz)."),
        VoicePreset("NTV-style — female", "ritu", 1.00,
                    "Studio pace, formal but conversational (223 Hz)."),
        VoicePreset("NTV-style — male", "rahul", 1.00,
                    "Mid-pace male bulletin read; the higher male voice (149 Hz)."),
        VoicePreset("TV9-style — female", "kavya", 1.12,
                    "Faster, headline-driven read; the brightest female voice (248 Hz)."),
        VoicePreset("TV9-style — male", "varun", 1.15,
                    "The most animated of the six — widest pitch swing measured "
                    "(4.75 st). Breaking news and short items."),
    ),
}


def voice_presets(model: str) -> tuple[VoicePreset, ...]:
    """Bulletin presets for `model`, or empty where there are none.

    Empty is the honest answer for every aimlapi model: those voices are not
    Telugu-first, so a preset claiming an ETV read would be a label with
    nothing behind it.
    """
    return SARVAM_NEWS_PRESETS.get((model or "").strip(), ())

#: A reasoning model spends its output budget on thinking before it writes, so
#: 2048 came back truncated and `_parse_json` raised "no JSON in model
#: response" — after the call had been charged for. kimi-k3, qwen3.8-flash and
#: glm-5.3-flash all failed exactly this way. 8192 is the floor that works.
MAX_OUTPUT_TOKENS = 8192


# --------------------------------------------------------------------------- #
# Image size — three families, no common field
# --------------------------------------------------------------------------- #
#: A 16:9 hero, spelled the way each family insists on. Sending another
#: family's field is a 400, so this is keyed by model-id prefix. `openai/
#: gpt-image-*` also wants a quality, and `low` is what the measured price is
#: the price of.
IMAGE_SIZE_ARG: dict[str, dict[str, str]] = {
    "openai/gpt-image": {"size": "1536x1024", "quality": "low"},
    "google/": {"aspect_ratio": "16:9"},
    "blackforestlabs/": {"image_size": "landscape_16_9"},
    "alibaba/": {"image_size": "landscape_16_9"},
}


#: The same three shapes in each family's spelling. gpt-image-* accepts only
#: these three sizes (published schema, checked 2026-09-23 for 1.5, 2 and 2.5),
#: so 4:5 and 9:16 are drawn 2:3 and cover-cropped by the caller.
_SHAPE_ARG: dict[str, dict[str, str]] = {
    "openai/gpt-image": {"landscape": "1536x1024", "square": "1024x1024", "portrait": "1024x1536"},
    "blackforestlabs/": {"landscape": "landscape_16_9", "square": "square_hd", "portrait": "portrait_16_9"},
    "alibaba/": {"landscape": "landscape_16_9", "square": "square_hd", "portrait": "portrait_16_9"},
}


def _shape(aspect: str) -> str:
    try:
        w, h = (float(x) for x in aspect.split(":"))
    except ValueError:
        return "landscape"
    if abs(w - h) < 1e-6:
        return "square"
    return "landscape" if w > h else "portrait"


def image_size_args(model: str, aspect: str = "16:9") -> dict[str, str]:
    """The size fields to merge into an image request for `model`.

    Empty for a model that matches no family: send no size argument at all and
    accept the model's own default shape. That is what `bytedance/seedream-*`
    needs — it takes none of the three and returns a square — and no size is a
    smaller wrong than the wrong size, which is a 400 an editor cannot act on.

    `aspect` picks the nearest shape the family can draw; google takes the
    ratio itself.
    """
    for prefix, args in IMAGE_SIZE_ARG.items():
        if model.startswith(prefix):
            out = dict(args)
            if "aspect_ratio" in out:
                out["aspect_ratio"] = aspect
            elif prefix in _SHAPE_ARG:
                field = "size" if "size" in out else "image_size"
                out[field] = _SHAPE_ARG[prefix][_shape(aspect)]
            return out
    return {}


# --------------------------------------------------------------------------- #
# Voices — every vendor has its own enum
# --------------------------------------------------------------------------- #
#: First entry is that model's documented default. An empty tuple means the
#: model takes no `voice` field and 400s when sent one. Keyed by exact id where
#: one vendor's models disagree, by vendor prefix otherwise. Wider than `TTS`
#: on purpose: an install may still be pointed at a model the dropdown no
#: longer offers, and it must still get a voice it can use.
_TTS_VOICES: dict[str, tuple[str, ...]] = {
    "openai/": (
        "alloy", "ash", "ballad", "coral", "echo", "fable",
        "nova", "onyx", "sage", "shimmer", "verse",
    ),
    "elevenlabs/": (
        "Rachel", "Bella", "Roger", "Sarah", "Laura", "Charlie", "George",
        "Callum", "River", "Alice", "Matilda", "Lily", "Aria",
    ),
    "alibaba/qwen3-tts-flash": (
        "Cherry", "Ethan", "Nofish", "Jennifer", "Ryan", "Katerina", "Elias",
        "Jada", "Dylan", "Sunny", "Li", "Marcus", "Roy", "Peter", "Rocky",
        "Kiki", "Eric",
    ),
    "deepgram/aura-2": (
        "asteria", "amalthea", "andromeda", "apollo", "arcas", "aries",
        "athena", "atlas", "aurora", "cora", "helena", "hera", "hermes",
        "luna", "orion", "zeus",
    ),
    # minimax wants a `voice_setting` object instead; hume takes no voice at
    # all. Either one rejects a plain `voice` field.
    "minimax/": (),
    "hume/": (),
    # Sarvam calls this a `speaker`, and the two models share not one name, so
    # these are keyed by exact id — a v2 speaker sent to v3 is a 422. Female
    # names lead each tuple because a female anchor is the Telugu news default
    # and the first entry is what an unset `voice.voice_name` gets.
    "sarvam/bulbul:v3": (
        "ritu", "priya", "neha", "pooja", "simran", "kavya", "ishita",
        "shreya", "roopa", "tanya", "shruti", "suhani", "kavitha", "rupali",
        "shubh", "aditya", "rahul", "rohan", "amit", "dev", "ratan", "varun",
        "manan", "sumit", "kabir", "aayan", "ashutosh", "advait", "anand",
        "tarun", "sunny", "mani", "gokul", "vijay", "mohit", "rehan", "soham",
    ),
}


def tts_voices(model: str) -> tuple[str, ...]:
    """The voice ids `model` accepts, its default first.

    Empty means send no `voice` field. An unknown model is treated the same
    way, because omitting the field is the only guess that is never a 400.
    """
    key = (model or "").strip()
    if key in _TTS_VOICES:
        return _TTS_VOICES[key]
    for prefix, voices in _TTS_VOICES.items():
        if prefix.endswith("/") and key.startswith(prefix):
            return voices
    return ()


#: Models whose published schema declares `speed`, and the range it declares.
#: Measured 2026-09-18: aimlapi silently drops a field it does not know —
#: `{"zzz_not_a_real_field": "banana"}` answered 200 — but validates one it
#: does, and `{"speed": 99}` answered 400 "Validation failed". So sending it to
#: a model that does not declare it achieves nothing, and sending a bad value
#: to one that does throws away a call that was already charged.
_SPEED_MODELS = ("openai/",)
TTS_SPEED_RANGE = (0.25, 4.0)


def tts_accepts_speed(model: str) -> bool:
    """Does `model` document a `speed` field, i.e. is sending one honest?

    False for everything else on purpose. `instructions` answers 200 for any
    model — the same 200 the garbage field gets — so a screen offering it would
    be promising a control nothing forwards.
    """
    return (model or "").strip().startswith(_SPEED_MODELS)


def valid_voice(model: str, voice: str | None) -> str | None:
    """The voice to send for `model`, or None to send no `voice` field at all.

    This is what stops `alloy` — configured once for OpenAI, then left behind
    in the settings row when the model changed — reaching ElevenLabs as a 400
    the editor cannot read. A voice the model does not know is replaced by that
    model's default rather than refused: the editor asked for audio.
    """
    voices = tts_voices(model)
    if not voices:
        return None
    wanted = (voice or "").strip()
    if not wanted or wanted.casefold() == "default":
        return voices[0]
    for known in voices:
        if known.casefold() == wanted.casefold():
            return known
    return voices[0]


# --------------------------------------------------------------------------- #
# Settings API
# --------------------------------------------------------------------------- #
_BY_KIND: dict[str, tuple[Choice, ...]] = {
    "text": TEXT,
    "image": IMAGE,
    "tts": TTS,
    "tts_sarvam": SARVAM_TTS,
}


def choices_for(kind: str) -> list[dict[str, object]]:
    """The dropdown for one capability, as the settings API serialises it.

    Raising on an unknown kind beats returning nothing: an empty dropdown looks
    like a missing key and gets debugged as one.
    """
    try:
        return [asdict(choice) for choice in _BY_KIND[(kind or "").strip().lower()]]
    except KeyError:
        raise ValueError(
            f"unknown capability {kind!r}; expected one of {sorted(_BY_KIND)}"
        ) from None
