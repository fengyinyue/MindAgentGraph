#!/usr/bin/env node
// One-shot dev launcher for MindAgentGraph (browser dev mode, no Tauri).
//
// Spawns:
//   - backend  : Python FastAPI on http://127.0.0.1:8765
//   - frontend : Vite dev server on http://localhost:1420
// Then:
//   - polls /health and the Vite port
//   - opens browser at http://localhost:1420 once both are ready
//   - on Ctrl+C: kills both children (process group on POSIX, taskkill /T on Windows)
//
// Usage:  npm run dev          (auto-open browser)
//         npm run dev -- --no-open

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const isWin = process.platform === "win32";

const BACKEND_PORT = 8765;
const FRONTEND_PORT = 1420;
const HEALTH_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 400;

const args = new Set(process.argv.slice(2));
const NO_OPEN = args.has("--no-open");

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function tag(name, color) {
  return `${color}[${name}]${COLORS.reset}`;
}

function pipeOutput(child, name, color) {
  const prefix = tag(name, color);
  const onLine = (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      process.stdout.write(`${prefix} ${line}\n`);
    }
  };
  child.stdout?.on("data", onLine);
  child.stderr?.on("data", onLine);
}

function findPythonExe() {
  const candidates = isWin
    ? ["backend/.venv/Scripts/python.exe"]
    : ["backend/.venv/bin/python"];
  for (const rel of candidates) {
    const abs = resolve(ROOT, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

function startBackend() {
  const py = findPythonExe();
  if (!py) {
    console.error(
      `${tag("dev", COLORS.red)} backend venv not found.\n` +
        `  Run:  cd backend && uv venv --python 3.13 && uv pip install -e .`,
    );
    process.exit(1);
  }
  const child = spawn(py, ["-m", "app.main"], {
    cwd: resolve(ROOT, "backend"),
    env: { ...process.env, MAG_PORT: String(BACKEND_PORT), PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  pipeOutput(child, "backend", COLORS.cyan);
  return child;
}

function startFrontend() {
  // On Windows, Node 22+ refuses to spawn .cmd directly without shell (CVE-2024-27980),
  // and shell:true + args array triggers DEP0190. Workaround: pass full command string,
  // empty args, shell:true.
  const child = isWin
    ? spawn('npm.cmd run dev', [], {
        cwd: resolve(ROOT, "frontend"),
        env: { ...process.env, FORCE_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        windowsHide: true,
      })
    : spawn("npm", ["run", "dev"], {
        cwd: resolve(ROOT, "frontend"),
        env: { ...process.env, FORCE_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
  pipeOutput(child, "frontend", COLORS.magenta);
  return child;
}

async function probeHttp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    return res.status < 500; // any non-5xx means server is up
  } catch {
    return false;
  }
}

const probeBackend = () => probeHttp(`http://127.0.0.1:${BACKEND_PORT}/health`);
const probeFrontend = () => probeHttp(`http://localhost:${FRONTEND_PORT}/`);

async function waitReady() {
  const start = Date.now();
  let backendReady = false;
  let frontendReady = false;
  let lastLog = 0;
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (!backendReady) backendReady = await probeBackend();
    if (!frontendReady) frontendReady = await probeFrontend();
    if (backendReady && frontendReady) return true;
    const elapsed = Date.now() - start;
    if (elapsed - lastLog > 2000) {
      console.log(
        `${tag("dev", COLORS.dim)} waiting… backend=${backendReady ? "ok" : "…"} frontend=${frontendReady ? "ok" : "…"}`,
      );
      lastLog = elapsed;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function openBrowser(url) {
  const cmd = isWin ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = isWin ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

function killChild(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (isWin) {
      // /T kills the whole process tree (npm → vite, python).
      spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  } catch {
    /* ignore */
  }
}

async function main() {
  console.log(`${tag("dev", COLORS.green)} starting MindAgentGraph (browser dev mode)`);
  console.log(
    `${tag("dev", COLORS.dim)} backend: http://127.0.0.1:${BACKEND_PORT}  frontend: http://localhost:${FRONTEND_PORT}`,
  );

  const backend = startBackend();
  const frontend = startFrontend();

  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${tag("dev", COLORS.yellow)} shutting down…`);
    killChild(backend);
    killChild(frontend);
    setTimeout(() => process.exit(code), 800).unref();
  };

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  backend.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${tag("dev", COLORS.red)} backend exited (code=${code})`);
      shutdown(1);
    }
  });
  frontend.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${tag("dev", COLORS.red)} frontend exited (code=${code})`);
      shutdown(1);
    }
  });

  const ready = await waitReady();
  if (!ready) {
    console.error(
      `${tag("dev", COLORS.red)} timed out waiting for backend /health and frontend :${FRONTEND_PORT}`,
    );
    shutdown(1);
    return;
  }

  const url = `http://localhost:${FRONTEND_PORT}`;
  console.log(`${tag("dev", COLORS.green)} ready → ${url}`);
  if (!NO_OPEN) {
    openBrowser(url);
    console.log(`${tag("dev", COLORS.dim)} opened browser (use --no-open to skip)`);
  }
  console.log(`${tag("dev", COLORS.dim)} Ctrl+C to stop both processes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
