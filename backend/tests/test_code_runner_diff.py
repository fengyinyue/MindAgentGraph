import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from app.services.code_runner import (
    _capture_code_diff,
    _detect_changed_files,
    _git_status_map,
    _snapshot_dirty_files,
)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


@pytest.mark.asyncio
async def test_capture_code_diff_uses_pre_run_dirty_snapshot(tmp_path: Path) -> None:
    if shutil.which("git") is None:
        pytest.skip("git is not installed")

    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@example.com")
    _git(tmp_path, "config", "user.name", "Test")

    source = tmp_path / "a.txt"
    source.write_text("one\n", encoding="utf-8")
    _git(tmp_path, "add", "a.txt")
    _git(tmp_path, "commit", "-m", "init")

    source.write_text("one\npreexisting\n", encoding="utf-8")
    before_status = await _git_status_map(str(tmp_path))
    before_snapshots = await _snapshot_dirty_files(str(tmp_path), before_status)

    marker = tmp_path / ".mag_code_run_marker"
    marker.write_text("marker", encoding="utf-8")
    old = time.time() - 5
    os.utime(marker, (old, old))

    source.write_text("one\npreexisting\nrun-change\n", encoding="utf-8")

    changed = await _detect_changed_files(str(tmp_path), str(marker), before_status)
    diff_info = await _capture_code_diff(str(tmp_path), changed, before_status, before_snapshots)

    assert changed == ["~ a.txt"]
    assert diff_info["available"] is True
    assert "+run-change" in diff_info["diff"]
    assert "-preexisting" not in diff_info["diff"]
