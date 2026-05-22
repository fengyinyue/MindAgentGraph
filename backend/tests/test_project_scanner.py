from pathlib import Path

from app.services.project_scanner import scan_project


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_scan_project_detects_stack_and_commands(tmp_path: Path) -> None:
    write(
        tmp_path / "package.json",
        '{"scripts":{"build":"vite build","test":"vitest"},"dependencies":{"react":"latest"},"devDependencies":{"typescript":"latest","vite":"latest"}}',
    )
    write(tmp_path / "backend" / "pyproject.toml", '[project]\ndependencies = ["fastapi"]\n')
    write(tmp_path / "src-tauri" / "tauri.conf.json", "{}")
    write(tmp_path / "frontend" / "src" / "App.tsx", "export default function App() { return null; }")
    write(tmp_path / "node_modules" / "ignored" / "index.ts", "ignored")

    result = scan_project(project_dir=str(tmp_path), purpose="改造当前项目的前端页面")

    assert "React" in result.detectedStack
    assert "TypeScript" in result.detectedStack
    assert "FastAPI" in result.detectedStack
    assert "Tauri" in result.detectedStack
    assert any(command.command == "npm run build" for command in result.commands)
    assert all(not item.path.startswith("node_modules/") for item in result.files)
    assert "frontend/src/**" in result.suggestedFileScope.allow


def test_scan_project_respects_file_scope(tmp_path: Path) -> None:
    write(tmp_path / "frontend" / "src" / "App.tsx", "export default function App() { return null; }")
    write(tmp_path / "backend" / "app" / "main.py", "print('backend')")

    result = scan_project(
        project_dir=str(tmp_path),
        file_scope_allow=["backend/**"],
        file_scope_deny=[],
    )

    paths = {item.path for item in result.files}
    assert "backend/app/main.py" in paths
    assert "frontend/src/App.tsx" not in paths
