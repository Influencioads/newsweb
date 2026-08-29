# API + Celery workers.
#
# One image serves api / worker / beat — the command differs, the code does not,
# so a worker can never drift from the API it shares services with.
#
# Build context is ./backend.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System packages the workers need (§8.1 e-paper, §9.3 video):
#   poppler-utils  -> pdftoppm, for PDF -> page images
#   tesseract-ocr + tesseract-ocr-tel -> Telugu OCR fallback for curve-converted PDFs
#   ffmpeg         -> the transcode ladder
#   libmagic1      -> real content-type sniffing on upload, not trusting the client
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        default-libmysqlclient-dev \
        ffmpeg \
        libmagic1 \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-tel \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .

# Run as a non-root user. A worker that shells out to ffmpeg/tesseract on
# operator-supplied files must not be running as root.
RUN useradd --create-home --shell /bin/bash appuser \
    && mkdir -p /app/var/storage \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health/live || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
