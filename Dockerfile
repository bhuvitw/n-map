# N-MAP single-service image: the React console is built and then served by
# FastAPI from the same origin, so there is one URL, no CORS and no API base
# URL to configure.

# ---- stage 1: build the React console ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
# Copy manifests first so the dependency layer is cached across source edits.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- stage 2: runtime ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# backend/ -> /app, so the package is /app/app and the dataset is /app/data.
COPY backend/ ./
# The built console lands at /app/static, which is what main.py looks for.
COPY --from=frontend /app/frontend/dist ./static

EXPOSE 8000
# No --reload in production. 0.0.0.0 is required inside a container, and
# hosts such as Render inject the port to bind through $PORT.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
