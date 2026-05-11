#!/usr/bin/env node
// Convenience wrapper: only start the FastAPI backend on MAG_PORT=8765.
// Useful when you want to run vite separately (e.g. inside an IDE).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const isWin = process.platform === "win32";

const py = isWin
  ? resolve(ROOT, "backend/.venv/Scripts/python.exe")
  : resolve(ROOT, "backend/.venv/bin/python");

if (!existsSync(py)) {
  console.error(
    "backend venv not found. Run:\n  cd backend && uv venv --python 3.13 && uv pip install -e .",
  );
  process.exit(1);
}

const child = spawn(py, ["-m", "app.main"], {
  cwd: resolve(ROOT, "backend"),
  env: { ...process.env, MAG_PORT: "8765", PYTHONUNBUFFERED: "1" },
  stdio: "inherit",
  windowsHide: true,
});

const forward = (sig) => () => child.kill(sig);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
