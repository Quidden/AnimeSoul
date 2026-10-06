"""Live preview imports source keys without inheriting deployment security."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.website_preview import load_provider_env


class WebsitePreviewTests(unittest.TestCase):
    def test_provider_env_excludes_database_origin_and_auth(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / ".env"
            path.write_text(
                '# Source credentials only\nYUMMYANIME_TOKEN="yummy-fixture"\n'
                "ANIMESOUL_KODIK_PUBLIC_KEY='public-fixture'\n"
                'ANIMESOUL_KODIK_PRIVATE_KEY=private=fixture\n'
                'ANIMESOUL_DATABASE_URL=postgresql://production\n'
                'ANIMESOUL_PUBLIC_ORIGIN=https://production.example\n'
                'ANIMESOUL_WEBSITE_DEVELOPMENT=0\n'
                'ANIMESOUL_SMTP_HOST=production.example\n'
                'ANIMESOUL_AUTH_GOOGLE_CLIENT_SECRET=production-secret\n',
                encoding="utf-8-sig",
            )
            with patch.dict(os.environ, {}, clear=True):
                load_provider_env(path)
                self.assertEqual(dict(os.environ), {
                    "YUMMYANIME_TOKEN": "yummy-fixture",
                    "ANIMESOUL_KODIK_PUBLIC_KEY": "public-fixture",
                    "ANIMESOUL_KODIK_PRIVATE_KEY": "private=fixture",
                })

    def test_explicit_process_key_wins_over_provider_env(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / ".env"
            path.write_text("YUMMYANIME_TOKEN=file-fixture\n", encoding="utf-8")
            with patch.dict(os.environ, {"YUMMYANIME_TOKEN": "process-fixture"}, clear=True):
                load_provider_env(path)
                self.assertEqual(os.environ["YUMMYANIME_TOKEN"], "process-fixture")
