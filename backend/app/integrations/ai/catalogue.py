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
    "DEFAULT_BULK_MODEL",
    "DEFAULT_IMAGE_MODEL",
    "DEFAULT_TEXT_MODEL",
    "DEFAULT_TTS_MODEL",
    "IMAGE",
    "IMAGE_SIZE_ARG",
    "MAX_OUTPUT_TOKENS",
    "TEXT",
    "TTS",
    "TTS_SPEED_RANGE",
    "choices_for",
    "image_size_args",
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
DEFAULT_IMAGE_MODEL = "openai/gpt-image-1.5"
DEFAULT_TTS_MODEL = "openai/gpt-4o-mini-tts"

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


def image_size_args(model: str) -> dict[str, str]:
    """The size fields to merge into an image request for `model`.

    Empty for a model that matches no family: send no size argument at all and
    accept the model's own default shape. That is what `bytedance/seedream-*`
    needs — it takes none of the three and returns a square — and no size is a
    smaller wrong than the wrong size, which is a 400 an editor cannot act on.
    """
    for prefix, args in IMAGE_SIZE_ARG.items():
        if model.startswith(prefix):
            return dict(args)
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
