"""Regression tests for top-level AnimeSoul startup decisions."""

from __future__ import annotations

import argparse
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import run
from backend.app.version import APP_VERSION


class RunStartupTests(unittest.TestCase):
    """Keep a stale process from making the Start AnimeSoul shortcut fail."""

    def test_client_navigation_bypasses_old_html_cache(self) -> None:
        first = run.client_url(3001)
        self.assertTrue(first.startswith(f"http://127.0.0.1:3001/?v={APP_VERSION}&launch="))
        self.assertNotEqual(first, run.client_url(3001))

    def test_health_check_rejects_previous_release(self) -> None:
        for version, expected in [("0.2.3", False), (APP_VERSION, True)]:
            with self.subTest(version=version), patch("run.httpx.get") as get:
                get.return_value.is_success = True
                get.return_value.json.return_value = {
                    "ok": True, "stack": "FastAPI + React", "version": version,
                    "capabilities": ["kodik-direct-stream-v1"],
                }
                self.assertEqual(run.animesoul_is_running(3001), expected)

    def test_occupied_port_falls_back_and_is_persisted(self) -> None:
        """The runtime chooses the first free neighboring port and starts there."""

        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "animesoul.python.json"
            arguments = argparse.Namespace(
                config=config_path,
                configure=False,
                mode="browser",
            )
            runtime = {
                "port": 3002,
                "launch_mode": "browser",
                "yummy_token": "test-token",
            }

            with (
                patch.object(run, "parse_arguments", return_value=arguments),
                patch.object(run, "load_runtime_settings", return_value=runtime),
                patch.object(
                    run,
                    "port_is_available",
                    side_effect=lambda port: port == 3004,
                ),
                patch.object(run, "animesoul_is_running", return_value=False),
                patch.object(run, "save_runtime_settings") as save_settings,
                patch.object(run, "write_runtime_state"),
                patch.object(run, "remove_runtime_state"),
                patch.object(run, "run_browser") as run_browser,
            ):
                run.main()

            self.assertEqual(runtime["port"], 3004)
            save_settings.assert_called_once_with(runtime)
            run_browser.assert_called_once_with(3004)


if __name__ == "__main__":
    unittest.main()
