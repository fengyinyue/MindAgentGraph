from pathlib import Path

import pytest

from app.services.code_runner import (
    _execute_native_tool,
    _tool_apply_patch,
    _tool_read_file,
)


def test_native_read_file_respects_deny_scope(tmp_path: Path) -> None:
    source = tmp_path / "secret.txt"
    source.write_text("token\n", encoding="utf-8")

    with pytest.raises(ValueError, match="denied"):
        _tool_read_file(
            str(tmp_path),
            {"path": "secret.txt"},
            allow=[],
            deny=["secret.txt"],
        )


def test_native_apply_patch_replaces_unique_text(tmp_path: Path) -> None:
    source = tmp_path / "src" / "app.ts"
    source.parent.mkdir()
    source.write_text('const model = "deepseek-v4-pro";\n', encoding="utf-8")

    result = _tool_apply_patch(
        str(tmp_path),
        {
            "path": "src/app.ts",
            "oldText": '"deepseek-v4-pro"',
            "newText": '"deepseek-v4-flash"',
        },
        allow=["src/**"],
        deny=[],
    )

    assert result["affectedFiles"] == ["src/app.ts"]
    assert source.read_text(encoding="utf-8") == 'const model = "deepseek-v4-flash";\n'


def test_native_apply_patch_rejects_out_of_scope_write(tmp_path: Path) -> None:
    source = tmp_path / "src" / "app.ts"
    source.parent.mkdir()
    source.write_text("one\n", encoding="utf-8")

    with pytest.raises(ValueError, match="outside file scope"):
        _tool_apply_patch(
            str(tmp_path),
            {"path": "src/app.ts", "oldText": "one", "newText": "two"},
            allow=["backend/**"],
            deny=[],
        )


@pytest.mark.asyncio
async def test_native_run_command_is_disabled(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="disabled"):
        await _execute_native_tool(
            tool_name="run_command",
            args={"command": "pytest"},
            project_dir=str(tmp_path),
            allow=[],
            deny=[],
            before_status={},
            before_snapshots={},
            marker=None,
        )
