# Lighthouse API — FastAPI + pipeline
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY lighthouse ./lighthouse

RUN pip install --upgrade pip \
 && pip install .

ENV LIGHTHOUSE_HOST=0.0.0.0 \
    LIGHTHOUSE_PORT=8787 \
    LIGHTHOUSE_CACHE_DIR=/app/.cache/crust

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8787/health || exit 1

CMD ["uvicorn", "lighthouse.api:app", "--host", "0.0.0.0", "--port", "8787"]
