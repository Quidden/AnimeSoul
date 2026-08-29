"""Install/build source-runtime assets only when their inputs changed."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
STATE_FILE = ROOT / "build" / "startup-state.json"


def fingerprint(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        if not path.is_file():
            continue
        digest.update(str(path.relative_to(ROOT)).replace("\\", "/").encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def frontend_inputs() -> list[Path]:
    files = [
        FRONTEND / "package.json",
        FRONTEND / "package-lock.json",
        FRONTEND / "tsconfig.json",
        FRONTEND / "vite.config.ts",
        FRONTEND / "index.html",
    ]
    for directory in (FRONTEND / "src", FRONTEND / "public"):
        if directory.is_dir():
            files.extend(path for path in directory.rglob("*") if path.is_file())
    return files


def read_state() -> dict[str, str]:
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def write_state(state: dict[str, str]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(STATE_FILE)


def run(command: list[str], label: str) -> None:
    print(label)
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> int:
    state = read_state()
    requirements = ROOT / "backend" / "requirements.txt"
    requirements_hash = fingerprint([requirements])
    if state.get("requirements") != requirements_hash:
        run(
            [sys.executable, "-m", "pip", "install", "-q", "-r", str(requirements)],
            "Installing changed Python dependencies...",
        )
        state["requirements"] = requirements_hash
        write_state(state)

    lock_hash = fingerprint([FRONTEND / "package.json", FRONTEND / "package-lock.json"])
    if not (FRONTEND / "node_modules").is_dir() or state.get("node") != lock_hash:
        npm = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm:
            raise RuntimeError("npm was not found; install Node.js 22+")
        run(
            [npm, "--prefix", str(FRONTEND), "install"],
            "Installing changed React dependencies...",
        )
        # npm may normalise package-lock.json during installation. Persist the
        # post-install fingerprint so the next launch does not install again.
        state["node"] = fingerprint(
            [FRONTEND / "package.json", FRONTEND / "package-lock.json"]
        )
        write_state(state)

    source_hash = fingerprint(frontend_inputs())
    if not (FRONTEND / "dist" / "index.html").is_file() or state.get("frontend") != source_hash:
        npm = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm:
            raise RuntimeError("npm was not found; install Node.js 22+")
        run(
            [npm, "--prefix", str(FRONTEND), "run", "build"],
            "Building changed React interface...",
        )
        state["frontend"] = source_hash
        write_state(state)
    else:
        print("Dependencies and React interface are already up to date.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"AnimeSoul preparation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
