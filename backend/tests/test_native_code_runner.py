from pathlib import Path

import pytest

from app.services.code_runner import (
    READ_ONLY_NATIVE_TOOLS,
    _execute_native_tool,
    _tool_apply_patch,
    _tool_delete_file,
    _tool_inspect_project,
    _tool_mkdir,
    _tool_move_file,
    _tool_read_file,
    _tool_write_file,
)


def test_read_only_native_tools_exclude_mutating_tools() -> None:
    tool_names = {tool["function"]["name"] for tool in READ_ONLY_NATIVE_TOOLS}

    assert tool_names == {"list_files", "read_file", "grep", "inspect_project", "finish"}
    assert "write_file" not in tool_names
    assert "apply_patch" not in tool_names
    assert "delete_file" not in tool_names
    assert "move_file" not in tool_names
    assert "mkdir" not in tool_names
    assert "run_command" not in tool_names
    assert "get_diff" not in tool_names


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


def test_native_write_file_creates_and_requires_overwrite(tmp_path: Path) -> None:
    result = _tool_write_file(
        str(tmp_path),
        {"path": "src/new.txt", "content": "hello\n"},
        allow=["src/**"],
        deny=[],
    )

    assert result["affectedFiles"] == ["src/new.txt"]
    assert (tmp_path / "src" / "new.txt").read_text(encoding="utf-8") == "hello\n"

    with pytest.raises(ValueError, match="overwrite=true"):
        _tool_write_file(
            str(tmp_path),
            {"path": "src/new.txt", "content": "again\n"},
            allow=["src/**"],
            deny=[],
        )


def test_native_delete_file_requires_confirm(tmp_path: Path) -> None:
    source = tmp_path / "src" / "old.txt"
    source.parent.mkdir()
    source.write_text("old\n", encoding="utf-8")

    with pytest.raises(ValueError, match="confirm=true"):
        _tool_delete_file(str(tmp_path), {"path": "src/old.txt"}, allow=["src/**"], deny=[])

    result = _tool_delete_file(
        str(tmp_path),
        {"path": "src/old.txt", "confirm": True},
        allow=["src/**"],
        deny=[],
    )

    assert result["deleted"] is True
    assert not source.exists()


def test_native_move_file_and_mkdir_respect_scope(tmp_path: Path) -> None:
    source = tmp_path / "src" / "old.txt"
    source.parent.mkdir()
    source.write_text("old\n", encoding="utf-8")

    mkdir_result = _tool_mkdir(str(tmp_path), {"path": "src/nested"}, allow=["src/**"], deny=[])
    assert mkdir_result["created"] is True

    move_result = _tool_move_file(
        str(tmp_path),
        {"sourcePath": "src/old.txt", "targetPath": "src/nested/new.txt"},
        allow=["src/**"],
        deny=[],
    )

    assert move_result["affectedFiles"] == ["src/old.txt", "src/nested/new.txt"]
    assert not source.exists()
    assert (tmp_path / "src" / "nested" / "new.txt").read_text(encoding="utf-8") == "old\n"


def test_native_inspect_project_detects_package_scripts(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(
        '{"scripts":{"build":"vite build","test":"vitest"}}',
        encoding="utf-8",
    )

    result = _tool_inspect_project(str(tmp_path))

    assert result["packageManager"] == "npm"
    assert result["scripts"]["build"] == "vite build"
    assert "npm run build" in result["suggestedCommands"]


@pytest.mark.asyncio
async def test_native_run_command_allows_whitelisted_command(tmp_path: Path) -> None:
    result, affected = await _execute_native_tool(
        tool_name="run_command",
        args={"command": "python -m pytest", "timeoutSeconds": 20},
        project_dir=str(tmp_path),
        allow=[],
        deny=[],
        before_status={},
        before_snapshots={},
        marker=None,
    )

    assert affected == []
    assert result["command"] == "python -m pytest"
    assert isinstance(result["exitCode"], int)


@pytest.mark.asyncio
async def test_native_run_command_rejects_non_whitelisted_command(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="not whitelisted"):
        await _execute_native_tool(
            tool_name="run_command",
            args={"command": "python -m pip"},
            project_dir=str(tmp_path),
            allow=[],
            deny=[],
            before_status={},
            before_snapshots={},
            marker=None,
        )


@pytest.mark.asyncio
async def test_native_run_command_rejects_chained_command_with_recovery_hint(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="already run in the project directory"):
        await _execute_native_tool(
            tool_name="run_command",
            args={"command": "cd E:/projects/my-game && npm test"},
            project_dir=str(tmp_path),
            allow=[],
            deny=[],
            before_status={},
            before_snapshots={},
            marker=None,
        )
