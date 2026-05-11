"""FastAPI sidecar 入口。

启动时绑定到 127.0.0.1:0 (随机端口)，把端口号打到 stdout 第一行 "PORT=xxxxx"，
Tauri Rust 主进程从 stdout 抓取端口供前端 invoke 查询。
"""

from __future__ import annotations
import os
import sys
import socket
import asyncio
from contextlib import closing

from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import Annotated, Optional
import uvicorn

from app.schemas import HealthResponse, PlanRequest, Graph
from app.services.planner import plan_graph

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
