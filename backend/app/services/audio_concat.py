"""Splitting text for a TTS provider, and joining the audio back together.

This module exists because of a units bug with real consequences. Google's
`text:synthesize` caps a request at 5 000 **bytes**; Telugu is three bytes per
character in UTF-8, so the real ceiling for Telugu is about 1 650 characters —
not the 5 000 the old `MAX_CHARS` assumed. Every article longer than that was
returning HTTP 400, being written as `FAILED`, and never retried, which is why
long-copy audio silently did not exist.

So the text is split, synthesised per chunk, and the audio is joined again.
Joining is done with the standard library alone — no pydub, no ffmpeg binding.
That is not a shortcut:

  * **MP3 is a stream of self-describing frames.** Concatenating the frame data
    of segments that came from one provider, at one sample rate, bitrate and
    channel count, produces a file every decoder plays. Only the ID3 metadata
    blocks have to go, because an ID3v2 header in the middle of a stream is
    garbage to some decoders.
  * **WAV is a header plus PCM**, which is exactly what `wave` is for. It also
    gives us a *measured* duration instead of the 12-chars-per-second estimate
    the providers return.

A chunk boundary is always a sentence boundary, never a word or a conjunct: a
Telugu word split across two synthesis calls is audible.
"""

from __future__ import annotations

import io
import re
import wave

from app.core.logging import get_logger

logger = get_logger(__name__)

#: Google's documented limit is 5 000 bytes for the whole request body's input
#: field. Headroom covers the SSML-free plain-text case plus a safety margin.
MAX_UTF8_BYTES_PER_CALL = 4_500

#: Boundaries to break on, strongest first. `।` is the danda, which Telugu copy
#: pasted from other Indic sources still carries.
_BOUNDARIES: tuple[str, ...] = ("\n\n", "\n", "।", ".", "?", "!", ";", ",", " ")

_ID3V2_MAGIC = b"ID3"
_ID3V1_MAGIC = b"TAG"
_ID3V1_SIZE = 128


def _byte_len(text: str) -> int:
    return len(text.encode("utf-8"))


def split_for_tts(
    text: str, *, max_bytes: int = MAX_UTF8_BYTES_PER_CALL
) -> list[str]:
    """Split `text` so every chunk fits `max_bytes` when UTF-8 encoded.

    Breaks at the latest sentence boundary that still fits. A run of text with
    no boundary at all — which should not happen in real copy — is cut on a
    character boundary rather than dropped, because losing a listener's
    sentence is worse than an awkward pause.
    """
    text = (text or "").strip()
    if not text:
        return []
    if _byte_len(text) <= max_bytes:
        return [text]

    chunks: list[str] = []
    rest = text
    while rest:
        if _byte_len(rest) <= max_bytes:
            chunks.append(rest.strip())
            break

        # Walk back from a generous character estimate until the slice fits.
        # 1 byte/char is the floor, so this cut is never past the limit.
        window = rest[:max_bytes]
        while _byte_len(window) > max_bytes:
            window = window[: int(len(window) * max_bytes / _byte_len(window))]

        cut = -1
        for boundary in _BOUNDARIES:
            found = window.rfind(boundary)
            # Refuse a boundary in the first third: it would produce a stub
            # chunk and push the real work into the next one.
            if found > len(window) // 3:
                cut = found + len(boundary)
                break
        if cut <= 0:
            cut = len(window)

        head, rest = rest[:cut].strip(), rest[cut:].strip()
        if head:
            chunks.append(head)
    return [c for c in chunks if c]


def _strip_id3(raw: bytes) -> bytes:
    """Remove an ID3v2 header and an ID3v1 trailer from one MP3 segment."""
    out = raw
    if out[:3] == _ID3V2_MAGIC and len(out) >= 10:
        # ID3v2 size is four syncsafe bytes: 7 significant bits each.
        size = 0
        for byte in out[6:10]:
            size = (size << 7) | (byte & 0x7F)
        header = 10 + size
        if 0 < header < len(out):
            out = out[header:]
    if len(out) > _ID3V1_SIZE and out[-_ID3V1_SIZE:][:3] == _ID3V1_MAGIC:
        out = out[:-_ID3V1_SIZE]
    return out


def concat_mp3(chunks: list[bytes]) -> bytes:
    """Join MPEG audio segments that all came from one provider call shape.

    Valid because every segment shares a sample rate, bitrate mode and channel
    count — they were produced by the same provider, for the same voice, in the
    same request cycle. Do not use this to join arbitrary MP3 files.
    """
    return b"".join(_strip_id3(chunk) for chunk in chunks if chunk)


def concat_wav(chunks: list[bytes]) -> tuple[bytes, int]:
    """Join RIFF/WAVE segments, returning `(audio, measured_duration_sec)`.

    Raises ValueError when the segments disagree on format, because writing
    mismatched PCM into one header produces a file that plays at the wrong
    pitch rather than one that fails loudly.
    """
    frames: list[bytes] = []
    params = None
    total_frames = 0
    for chunk in chunks:
        if not chunk:
            continue
        with wave.open(io.BytesIO(chunk), "rb") as src:
            current = (src.getnchannels(), src.getsampwidth(), src.getframerate())
            if params is None:
                params = current
            elif current != params:
                raise ValueError(
                    f"WAV segments disagree on format: {params} vs {current}"
                )
            frames.append(src.readframes(src.getnframes()))
            total_frames += src.getnframes()

    if params is None:
        return b"", 0

    channels, width, rate = params
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as dst:
        dst.setnchannels(channels)
        dst.setsampwidth(width)
        dst.setframerate(rate)
        dst.writeframes(b"".join(frames))
    return buffer.getvalue(), int(round(total_frames / rate)) if rate else 0


def concat(chunks: list[bytes], mime: str) -> tuple[bytes, int | None]:
    """Join segments for `mime`, returning `(audio, measured_duration_or_None)`.

    A measured duration is only available for WAV. For MP3 the caller keeps the
    provider's own estimate, which is what it did before this module existed.
    """
    usable = [c for c in chunks if c]
    if not usable:
        return b"", None
    if len(usable) == 1:
        if mime in ("audio/wav", "audio/x-wav"):
            try:
                return concat_wav(usable)
            except (wave.Error, ValueError, EOFError):
                return usable[0], None
        return usable[0], None

    if mime in ("audio/wav", "audio/x-wav"):
        return concat_wav(usable)
    if mime in ("audio/mpeg", "audio/mp3"):
        return concat_mp3(usable), None

    # An unknown container cannot be safely spliced. Refusing here is better
    # than emitting a file that plays only the first segment.
    raise ValueError(f"cannot concatenate audio of type {mime!r}")


#: Matches the whitespace runs `split_for_tts` may leave behind when a chunk
#: boundary lands mid-paragraph. Kept module-level so the compile happens once.
_WS = re.compile(r"[ \t]{2,}")


def tidy(text: str) -> str:
    """Collapse the double spaces a boundary split can leave in a script."""
    return _WS.sub(" ", text or "").strip()
