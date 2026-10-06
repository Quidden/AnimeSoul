"""Local website env files must configure the same runtime as shell variables."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.app import config


class EnvConfigurationTests(unittest.TestCase):
    def test_app_env_loads_website_and_frontend_paths_after_class_definition(self):
        with tempfile.TemporaryDirectory() as temporary:
            app_root = Path(temporary)
            backend_root = app_root / "backend"
            backend_root.mkdir()
            (app_root / ".env").write_text(
                'ANIMESOUL_RUNTIME=website\nANIMESOUL_FRONTEND_DIST="../frontend/dist"\n'
                'ANIMESOUL_DATA_DIR=../.website-local/cache\n', encoding="utf-8-sig",
            )
            with patch.object(config, "PROJECT_ROOT", backend_root), patch.object(config, "CONFIG_FILE", backend_root / "missing.json"), patch.dict(os.environ, {}, clear=True):
                settings = config.load_settings()
                self.assertEqual(os.environ["ANIMESOUL_RUNTIME"], "website")
                self.assertEqual(settings.frontend_dist, (app_root / "frontend" / "dist").resolve())
                self.assertEqual(settings.data_dir, (app_root / ".website-local" / "cache").resolve())

    def test_shell_and_existing_backend_env_keep_their_priority(self):
        with tempfile.TemporaryDirectory() as temporary:
            app_root = Path(temporary)
            backend_root = app_root / "backend"
            backend_root.mkdir()
            (app_root / ".env").write_text("ANIMESOUL_PYTHON_PORT=8013\nYUMMYANIME_TOKEN=app-fixture\n", encoding="utf-8")
            (backend_root / ".env").write_text("YUMMYANIME_TOKEN=backend-fixture\n", encoding="utf-8")
            with patch.object(config, "PROJECT_ROOT", backend_root), patch.object(config, "CONFIG_FILE", backend_root / "missing.json"), patch.dict(os.environ, {"ANIMESOUL_PYTHON_PORT": "9013"}, clear=True):
                settings = config.load_settings()
                self.assertEqual(settings.port, 9013)
                self.assertEqual(settings.yummy_token, "backend-fixture")
