"""FastAPI sidecar 入口。

启动时绑定到 127.0.0.1:0 (随机端口)，把端口号打到 stdout 第一行 "PORT=xxxxx"，
Tauri Rust 主进程从 stdout 抓取端口供前端 invoke 查询。
"""

from __future__ import annotations
import asyncio
import json
import logging
import os
import socket
import sys
from contextlib import closing
from pathlib import Path
from typing import Annotated, Optional

import dotenv
import uvicorn
from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Load backend/.env relative to this file so it works regardless of cwd.
_env_path = Path(__file__).resolve().parent.parent / ".env"
dotenv.load_dotenv(_env_path)

# Default quiet. Set MAG_DEBUG=1 to restore verbose provider logs.
_log_level = logging.DEBUG if os.environ.get("MAG_DEBUG") == "1" else logging.WARNING
_log_handler = logging.StreamHandler(sys.stderr)
_log_handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
logging.getLogger("mag").setLevel(_log_level)
logging.getLogger("mag").addHandler(_log_handler)
logging.getLogger("mag").propagate = False

from app.schemas import HealthResponse, PlanRequest, RunNodeRequest, CodeRunRequest, Graph
from app.services.planner import plan_graph
from app.services.runner import run_node_stream
from app.services.code_runner import run_node_with_claude

app = FastAPI(title="MindAgentGraph Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420", "http://127.0.0.1:1420",
        "http://localhost:5173", "http://127.0.0.1:5173",
        "tauri://localhost", "http://tauri.localhost",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*", "X-Provider-Key"],
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.post("/plan", response_model=Graph)
async def plan(
    req: PlanRequest,
    x_provider_key: Annotated[Optional[str], Header(alias="X-Provider-Key")] = None,
) -> Graph:
    # Frontend may pass a user-entered API key via header (kept out of body
    # so it never lands in request logs / .mag exports). Falls back to env
    # var when absent.
    return await plan_graph(
        req.goal,
        provider=req.provider,
        model=req.model,
        api_key=x_provider_key,
    )


@app.post("/run/node")
async def run_node(
    req: RunNodeRequest,
    x_provider_key: Annotated[Optional[str], Header(alias="X-Provider-Key")] = None,
) -> StreamingResponse:
    """SSE stream of text chunks for a single node.

    Wire format (each event ends with blank line):
      event: text\\n
      data: "<json-encoded chunk>"\\n
      \\n
      event: done\\n
      data: {}\\n
      \\n
      event: error\\n
      data: {"message": "..."}\\n
      \\n
    """

    async def gen():
        try:
            async for chunk in run_node_stream(
                node_title=req.node.title,
                node_type=req.node.type,
                node_purpose=req.node.purpose or "",
                user_prompt=req.userPrompt,
                provider=req.provider,
                model=req.model,
                api_key=x_provider_key,
            ):
                yield f"event: text\ndata: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {}\n\n"
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/run/node/code")
async def run_node_code(req: CodeRunRequest) -> StreamingResponse:
    """SSE stream of Claude Code CLI output.

    Same SSE wire format as /run/node, with one extra event type:
      event: files\\n
      data: ["+ src/a.py", "~ src/b.py"]\\n
    """

    async def gen():
        try:
            async for chunk in run_node_with_claude(
                node_title=req.node.title,
                node_type=req.node.type,
                node_purpose=req.node.purpose or "",
                project_dir=req.projectDir,
                file_scope_allow=req.fileScopeAllow,
                file_scope_deny=req.fileScopeDeny,
                parent_outputs=req.parentOutputs,
                user_prompt=req.userPrompt,
                model=req.model,
            ):
                # Check for the special __files__ marker (may have leading whitespace).
                stripped = chunk.strip()
                if stripped.startswith("__files__:"):
                    files_json = stripped[len("__files__:"):].strip()
                    yield f"event: files\ndata: {files_json}\n\n"
                else:
                    yield f"event: text\ndata: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {}\n\n"
        except asyncio.CancelledError:
            raise
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _pick_free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    # Browser dev: MAG_PORT=8765 (固定) ；Tauri sidecar: 不设，自动选随机端口
    env_port = os.environ.get("MAG_PORT")
    port = int(env_port) if env_port else _pick_free_port()
    # Tauri 父进程读这一行抓端口
    print(f"PORT={port}", flush=True)
    sys.stdout.flush()

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    main()
