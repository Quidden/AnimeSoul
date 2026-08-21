"""Tests for the launcher/runtime process handshake."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from runtime_instance import (
    find_available_port,
    read_runtime_state,
    remove_runtime_state,
    runtime_api_is_compatible,
    runtime_state_file,
    write_runtime_state,
)


class RuntimeInstanceTests(unittest.TestCase):
    """Verify safe publication and removal of the running server identity."""

    def test_runtime_state_lifecycle(self) -> None:
        """Only the process that created a state file may remove it."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "animesoul.python.json"
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("ANIMESOUL_RUNTIME_STATE_FILE", None)
                target = write_runtime_state(
                    config_path,
                    instance_id="server-one",
                    pid=1234,
                    port=3001,
                    mode="browser",
                )

                state = read_runtime_state(config_path)
                self.assertIsNotNone(state)
                self.assertEqual(target, root / "animesoul.runtime.json")
                self.assertEqual(runtime_state_file(config_path), target)
                self.assertEqual(state["instance_id"], "server-one")
                self.assertEqual(state["pid"], 1234)
                self.assertEqual(state["port"], 3001)
                self.assertEqual(state["mode"], "browser")
                self.assertTrue(state["started_at"])

                remove_runtime_state(config_path, "another-server")
                self.assertTrue(target.exists())

                remove_runtime_state(config_path, "server-one")
                self.assertFalse(target.exists())

    def test_explicit_runtime_state_path(self) -> None:
        """Packaged launcher and runtime may share an explicit state path."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            explicit_path = root / "shared" / "runtime.json"
            with patch.dict(
                os.environ,
                {"ANIMESOUL_RUNTIME_STATE_FILE": str(explicit_path)},
            ):
                self.assertEqual(
                    runtime_state_file(root / "ignored.json"),
                    explicit_path,
                )

    def test_find_available_port_skips_occupied_ports(self) -> None:
        """A stale process must not prevent AnimeSoul from starting."""

        occupied = {3001, 3002, 3003}
        self.assertEqual(
            find_available_port(3001, lambda port: port not in occupied),
            3004,
        )

    def test_find_available_port_respects_search_limit(self) -> None:
        """The search fails cleanly when its bounded range is occupied."""

        self.assertIsNone(
            find_available_port(65534, lambda _port: False, max_attempts=5)
        )

    def test_runtime_api_requires_direct_kodik_stream(self) -> None:
        """A pre-player backend must not be reused by a newer launcher."""

        self.assertFalse(runtime_api_is_compatible({"capabilities": []}))
        self.assertFalse(runtime_api_is_compatible({"ok": True}))
        self.assertTrue(
            runtime_api_is_compatible(
                {"capabilities": ["kodik-direct-stream-v1", "future-feature"]}
            )
        )


if __name__ == "__main__":
    unittest.main()
