# Yuktara API: small image, non-root user, no build tools at runtime.
FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so code changes don't reinstall them.
COPY pyproject.toml ./
RUN pip install --upgrade pip \
 && python -c "import tomllib; d=tomllib.load(open('pyproject.toml','rb')); print('\n'.join(d['project']['dependencies']))" > requirements.txt \
 && pip install -r requirements.txt \
 && rm requirements.txt

COPY app ./app

RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin yuktara
USER yuktara

ENV PORT=8000
EXPOSE 8000

# Render sets $PORT. --proxy-headers trusts X-Forwarded-* from Render's proxy only.
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --no-access-log --no-server-header"]
