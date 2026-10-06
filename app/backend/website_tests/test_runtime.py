"""Migration and production-configuration checks without external services."""

from io import StringIO
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import inspect, text

from backend.app.website.accounts import set_session
from backend.app.website.config import WebsiteSettings
from backend.app.website.database import Database
from backend.app.website.runtime import start_website


class RuntimeTests(unittest.TestCase):
    def test_production_requires_https_and_postgresql(self):
        for config in [WebsiteSettings(database_url="sqlite:///:memory:", origin="https://anime.test"), WebsiteSettings(database_url="postgresql+psycopg://db", origin="http://anime.test")]:
            with self.assertRaises(RuntimeError):
                config.validate()
        WebsiteSettings(database_url="postgresql+psycopg://db", origin="https://anime.test").validate()
        with self.assertRaises(RuntimeError):
            WebsiteSettings(database_url="sqlite:///:memory:", origin="http://anime.test", development=True).validate()

    def test_production_session_cookies_are_host_bound_secure_and_http_only(self):
        from fastapi import Response
        response = Response()
        config = WebsiteSettings(database_url="postgresql+psycopg://db", origin="https://anime.test")
        set_session(response, config, ("opaque-session", "csrf"))
        cookies = response.headers.getlist("set-cookie")
        self.assertIn("__Host-animesoul_session", cookies[0])
        self.assertIn("HttpOnly", cookies[0])
        self.assertIn("Secure", cookies[0])
        self.assertIn("Path=/", cookies[0])
        self.assertNotIn("Domain", cookies[0])
        self.assertIn("__Host-animesoul_csrf", cookies[1])

    def test_migrations_are_repeatable_and_runtime_requires_them(self):
        with tempfile.TemporaryDirectory() as temporary:
            url = "sqlite:///" + (Path(temporary) / "migrations.db").as_posix()
            database = Database(url)
            app = FastAPI()
            app.state.website_database = database
            with self.assertRaises(Exception):
                start_website(app)
            ini = Path(__file__).resolve().parents[2] / "alembic.ini"
            with patch.dict("os.environ", {"ANIMESOUL_DATABASE_URL": url}):
                command.upgrade(Config(str(ini)), "head")
                command.upgrade(Config(str(ini)), "head")
            start_website(app)
            self.assertIn("save_items", inspect(database.engine).get_table_names())
            with database.engine.connect() as conn:
                self.assertEqual(conn.execute(text("SELECT version_num FROM alembic_version")).scalar(), "0002_user_profiles")
            self.assertIn("user_profiles", inspect(database.engine).get_table_names())
            database.engine.dispose()

    def test_postgresql_migration_sql_contains_all_ownership_constraints(self):
        ini = Path(__file__).resolve().parents[2] / "alembic.ini"
        output = StringIO()
        config = Config(str(ini), output_buffer=output)
        with patch.dict("os.environ", {"ANIMESOUL_DATABASE_URL": "postgresql+psycopg://unused"}):
            command.upgrade(config, "head", sql=True)
        sql = output.getvalue()
        self.assertIn("CREATE TABLE users", sql)
        self.assertIn("CREATE TABLE save_items", sql)
        self.assertIn("FOREIGN KEY(user_id, profile_id)", sql)
        self.assertIn("UNIQUE (email)", sql)
        self.assertIn("UNIQUE (username)", sql)

    def test_website_entrypoint_serves_spa_and_blocks_desktop_api(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            dist = directory / "frontend" / "dist"
            dist.mkdir(parents=True)
            (dist / "index.html").write_text("<html>website-build-marker</html>", encoding="utf-8")
            url = "sqlite:///" + (directory / "entrypoint.db").as_posix()
            with patch.dict("os.environ", {"ANIMESOUL_DATABASE_URL": url}):
                command.upgrade(Config(str(root / "alembic.ini")), "head")
            environment = {**os.environ, "ANIMESOUL_RUNTIME": "website", "ANIMESOUL_DATABASE_URL": url,
                           "ANIMESOUL_WEBSITE_DEVELOPMENT": "1", "ANIMESOUL_PUBLIC_ORIGIN": "http://localhost:8013",
                           "ANIMESOUL_DATA_DIR": str(directory / "data"), "ANIMESOUL_FRONTEND_DIST": str(dist),
                           "ANIMESOUL_AUTH_GOOGLE_CLIENT_ID": "", "ANIMESOUL_AUTH_GOOGLE_CLIENT_SECRET": ""}
            script = """
from fastapi.testclient import TestClient
from backend.app.main import app
with TestClient(app, base_url='http://localhost:8013') as client:
    response = client.get('/account')
    assert response.status_code == 200 and 'website-build-marker' in response.text
    assert 'frame-ancestors' in response.headers['Content-Security-Policy']
    assert client.get('/api/auth/config').json()['website'] is True
    assert client.get('/api/storage').status_code == 401
    assert client.get('/api/downloads').status_code == 404
    assert client.get('/api/lan/settings').status_code == 404
    assert client.get('/api/unknown').status_code == 404
    assert client.get('/%2e%2e%2fentrypoint.db').status_code == 404
"""
            result = subprocess.run([sys.executable, "-c", script], cwd=root, env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
