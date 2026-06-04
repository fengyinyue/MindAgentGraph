"""Deterministic tool-sequence replay (no LLM)."""

import json
from pathlib import Path

import pytest

from app.services.code_runner import replay_tool_sequence


def _markers(chunks: list[str], name: str) -> list[dict]:
    prefix = f"__{name}__:"
    out = []
    for chunk in chunks:
        stripped = chunk.strip()
        if stripped.startswith(prefix):
            out.append(json.loads(stripped[len(prefix):]))
    return out


async def _collect(**kwargs) -> list[str]:
    chunks: list[str] = []
    async for chunk in replay_tool_sequence(**kwargs):
        chunks.append(chunk)
    return chunks


@pytest.mark.asyncio
async def test_replay_applies_patch_deterministically(tmp_path: Path) -> None:
    source = tmp_path / "src" / "app.ts"
    source.parent.mkdir()
    # write_bytes to avoid platform newline translation
    source.write_bytes(b'const model = "old";\n')

    chunks = await _collect(
        project_dir=str(tmp_path),
        file_scope_allow=["src/**"],
        file_scope_deny=[],
        steps=[
            {"id": "n1", "tool": "read_file", "input": {"path": "src/app.ts"}},
            {
                "id": "n2",
                "tool": "apply_patch",
                "input": {"path": "src/app.ts", "oldText": '"old"', "newText": '"new"'},
            },
            {"id": "n3", "tool": "finish", "input": {"summary": "done"}},
        ],
    )

    # File was really modified by replay (no LLM involved).
    assert source.read_bytes() == b'const model = "new";\n'

    results = _markers(chunks, "tool_result")
    by_id = {r["id"]: r for r in results}
    assert by_id["n1"]["status"] == "done"
    assert by_id["n1"]["output"]["content"] == 'const model = "old";\n'
    assert by_id["n2"]["status"] == "done"
    assert by_id["n2"]["affectedFiles"] == ["src/app.ts"]
    assert by_id["n3"]["output"]["summary"] == "done"


@pytest.mark.asyncio
async def test_replay_reports_error_per_step_without_aborting(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_bytes(b"hello\n")

    chunks = await _collect(
        project_dir=str(tmp_path),
        file_scope_allow=[],
        file_scope_deny=[],
        steps=[
            {"id": "bad", "tool": "read_file", "input": {"path": "missing.txt"}},
            {"id": "ok", "tool": "read_file", "input": {"path": "a.txt"}},
        ],
    )

    by_id = {r["id"]: r for r in _markers(chunks, "tool_result")}
    assert by_id["bad"]["status"] == "error"
    # A failing step does not stop the rest of the sequence.
    assert by_id["ok"]["status"] == "done"
    assert by_id["ok"]["output"]["content"] == "hello\n"
