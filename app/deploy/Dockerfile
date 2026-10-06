FROM node:22-alpine AS frontend
WORKDIR /build
COPY app/frontend/package*.json ./
RUN npm ci
COPY app/frontend/ ./
RUN VITE_ANIMESOUL_WEBSITE=1 npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 ANIMESOUL_RUNTIME=website ANIMESOUL_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY app/backend/requirements-server.txt app/backend/requirements-website.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements-website.txt
COPY app/backend/ ./backend/
COPY app/runtime_instance.py ./
COPY app/alembic.ini ./
COPY --from=frontend /build/dist ./frontend/dist
RUN useradd --uid 10001 --create-home animesoul && mkdir /runtime && chown animesoul /runtime
USER animesoul
EXPOSE 8000
# Only Caddy is exposed. Trust its forwarded scheme, never arbitrary clients.
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]
