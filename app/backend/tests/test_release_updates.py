"""Release checks must not mistake network failures for an up-to-date client."""

import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from backend.app.version import APP_VERSION
from release_updates import check_for_updates, stable_version


class ReleaseUpdateTests(unittest.TestCase):
    def check_payload(self, payload):
        with patch("release_updates.urllib.request.urlopen", return_value=io.BytesIO(json.dumps(payload).encode())):
            return check_for_updates()

    def test_numeric_versions(self):
        self.assertGreater(stable_version("v0.2.10"), stable_version("0.2.9"))

    def test_newer_equal_and_older(self):
        for version, state in [("v99.0.0", "available"), (APP_VERSION, "current"), ("v0.2.3", "current")]:
            with self.subTest(version=version):
                self.assertEqual(self.check_payload({"tag_name": version})["state"], state)

    def test_release_link_targets_the_checked_version(self):
        result = self.check_payload({"tag_name": "v99.0.0", "html_url": "https://untrusted.example"})
        self.assertEqual(result["releaseUrl"], "https://github.com/Quidden/AnimeSoul/releases/tag/v99.0.0")

    def test_invalid_and_prerelease_metadata(self):
        for payload in [[], {}, {"tag_name": "bad"}, {"tag_name": "v99.0.0", "prerelease": True}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.check_payload(payload)["state"], "unavailable")

    def test_offline_and_http_errors(self):
        errors = [TimeoutError(), urllib.error.URLError("offline")]
        errors += [urllib.error.HTTPError("https://api.github.com", code, "error", {}, None) for code in (403, 404, 500)]
        for error in errors:
            with self.subTest(error=error), patch("release_updates.urllib.request.urlopen", side_effect=error):
                self.assertEqual(check_for_updates()["state"], "unavailable")
