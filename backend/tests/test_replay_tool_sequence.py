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
async def test_replay_resolves_data_binding(tmp_path: Path) -> None:
    # read_file.content (output) → apply_patch.oldText (input) via a binding.
    src = tmp_path / "f.txt"
    src.write_bytes(b"PLACEHOLDER\n")

    chunks = await _collect(
        project_dir=str(tmp_path),
        file_scope_allow=[],
        file_scope_deny=[],
        steps=[
            {"id": "r", "tool": "read_file", "input": {"path": "f.txt"}},
            {
                "id": "p",
                "tool": "apply_patch",
                # oldText left wrong on purpose; the binding must override it
                "input": {"path": "f.txt", "oldText": "WRONG", "newText": "DONE\n"},
                "bindings": [
                    {"targetArg": "oldText", "sourceStepId": "r", "sourceField": "content"},
                ],
            },
        ],
    )

    by_id = {r["id"]: r for r in _markers(chunks, "tool_result")}
    # binding fed the real file content as oldText → patch succeeds
    assert by_id["p"]["status"] == "done"
    assert by_id["p"]["input"]["oldText"] == "PLACEHOLDER\n"  # resolved from upstream
    assert src.read_bytes() == b"DONE\n"


@pytest.mark.asyncio
async def test_replay_value_node_feeds_downstream_port(tmp_path: Path) -> None:
    # A "value" constant node emits its literal; read_file binds path to it.
    (tmp_path / "real.txt").write_bytes(b"CONTENT\n")

    chunks = await _collect(
        project_dir=str(tmp_path),
        file_scope_allow=[],
        file_scope_deny=[],
        steps=[
            {"id": "v", "tool": "value", "input": {"value": "real.txt"}},
            {
                "id": "r",
                "tool": "read_file",
                "input": {"path": "ignored.txt"},  # overridden by binding
                "bindings": [
                    {"targetArg": "path", "sourceStepId": "v", "sourceField": "value"},
                ],
            },
        ],
    )

    by_id = {r["id"]: r for r in _markers(chunks, "tool_result")}
    assert by_id["v"]["output"]["value"] == "real.txt"
    assert by_id["r"]["status"] == "done"
    assert by_id["r"]["input"]["path"] == "real.txt"   # bound from value node
    assert by_id["r"]["output"]["content"] == "CONTENT\n"


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
