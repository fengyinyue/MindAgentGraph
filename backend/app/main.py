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
from fastapi import FastAPI, Header, HTTPException
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

from app.schemas import HealthResponse, PlanRequest, RunNodeRequest, CodeRunRequest, CodeAnalysisRequest, CodeCancelRequest, Graph, RunDagRequest, ExpandPlanRequest, ExpandModulesRequest, ProjectScanRequest, ProjectScanResult
from app.services.planner import expand_plan, expand_modules, plan_graph
from app.services.project_scanner import scan_project
from app.services.runner import run_node_stream
from app.services.code_runner import cancel_claude_run, run_node_with_claude
from app.services.code_analysis_runner import run_code_analysis_with_claude
from app.services.memory import read_memory, write_memory
from app.services.dag_executor import run_dag_stream

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


@app.post("/plan/expand")
async def plan_expand(
    req: ExpandPlanRequest,
    x_provider_key: Annotated[Optional[str], Header(alias="X-Provider-Key")] = None,
):
    """将规划文本展开为子节点+连线，返回 AI 原始 emit_graph 结果。"""
    return await expand_plan(
        req.plan_text,
        existing_nodes=[node.model_dump() for node in req.existing_nodes],
        upstream_outputs=req.upstream_outputs,
        provider=req.provider,
        model=req.model,
        api_key=x_provider_key,
    )


@app.post("/code-analysis/expand-modules")
async def code_analysis_expand_modules(
    req: ExpandModulesRequest,
    x_provider_key: Annotated[Optional[str], Header(alias="X-Provider-Key")] = None,
):
    """将代码分析文本展开为模块子节点+连线，返回 AI 原始 emit_graph 结果。"""
    return await expand_modules(
        req.analysis_text,
        existing_nodes=[node.model_dump() for node in req.existing_nodes],
        upstream_outputs=req.upstream_outputs,
        provider=req.provider,
        model=req.model,
        api_key=x_provider_key,
    )


@app.post("/project/scan", response_model=ProjectScanResult)
async def project_scan(req: ProjectScanRequest) -> ProjectScanResult:
    """只读扫描已有工程，生成 Project Scan 节点上下文。"""
    try:
        return scan_project(
            project_dir=req.projectDir,
            purpose=req.node.purpose or "",
            file_scope_allow=req.fileScopeAllow,
            file_scope_deny=req.fileScopeDeny,
            max_files=req.maxFiles,
            max_bytes_per_file=req.maxBytesPerFile,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


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
            memory_text = None
            if req.node.contextMode == "inherit":
                memory_text = read_memory(req.projectPath, req.node.memoryRef)

            output_parts: list[str] = []
            async for chunk in run_node_stream(
                node_title=req.node.title,
                node_type=req.node.type,
                node_purpose=req.node.purpose or "",
                user_prompt=req.userPrompt,
                context_mode=req.node.contextMode,
                parent_outputs=req.parentOutputs,
                memory_text=memory_text,
                system_prompt=req.node.systemPrompt,
                provider=req.provider,
                model=req.model,
                api_key=x_provider_key,
            ):
                output_parts.append(chunk)
                yield f"event: text\ndata: {json.dumps(chunk, ensure_ascii=False)}\n\n"

            if req.node.contextMode != "isolated":
                write_memory(
                    req.projectPath,
                    req.node.memoryRef,
                    "".join(output_parts),
                    node_title=req.node.title,
                )
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


@app.post("/run/node/code/cancel")
async def cancel_node_code(req: CodeCancelRequest) -> dict[str, bool]:
    cancelled = await cancel_claude_run(req.runId)
    return {"cancelled": cancelled}


@app.post("/run/node/code-analysis")
async def run_node_code_analysis(req: CodeAnalysisRequest) -> StreamingResponse:
    """SSE stream of read-only Claude Code analysis output."""

    async def gen():
        try:
            memory_text = None
            if req.node.contextMode == "inherit":
                memory_text = read_memory(req.projectPath, req.node.memoryRef)

            output_parts: list[str] = []
            async for chunk in run_code_analysis_with_claude(
                node_title=req.node.title,
                node_purpose=req.node.purpose or "",
                project_dir=req.projectDir,
                file_scope_allow=req.fileScopeAllow,
                file_scope_deny=req.fileScopeDeny,
                parent_outputs=req.parentOutputs,
                user_prompt=req.userPrompt,
                context_mode=req.node.contextMode,
                memory_text=memory_text,
                system_prompt=req.node.systemPrompt,
                model=req.model,
                run_id=req.runId,
            ):
                output_parts.append(chunk)
                yield f"event: text\ndata: {json.dumps(chunk, ensure_ascii=False)}\n\n"

            if req.node.contextMode != "isolated":
                write_memory(
                    req.projectPath,
                    req.node.memoryRef,
                    "".join(output_parts),
                    node_title=req.node.title,
                )
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


@app.post("/run/node/code")
async def run_node_code(req: CodeRunRequest) -> StreamingResponse:
    """SSE stream of Claude Code CLI output.

    Same SSE wire format as /run/node, with extra event types:
      event: files\\n
      data: ["+ src/a.py", "~ src/b.py"]\\n
      event: diff\\n
      data: {"diff": "...", "truncated": false}\\n
    """

    async def gen():
        try:
            memory_text = None
            if req.node.contextMode == "inherit":
                memory_text = read_memory(req.projectPath, req.node.memoryRef)

            output_parts: list[str] = []
            async for chunk in run_node_with_claude(
                node_title=req.node.title,
                node_type=req.node.type,
                node_purpose=req.node.purpose or "",
                project_dir=req.projectDir,
                file_scope_allow=req.fileScopeAllow,
                file_scope_deny=req.fileScopeDeny,
                parent_outputs=req.parentOutputs,
                user_prompt=req.userPrompt,
                context_mode=req.node.contextMode,
                memory_text=memory_text,
                system_prompt=req.node.systemPrompt,
                model=req.model,
                run_id=req.runId,
            ):
                # Check for special metadata markers (may have leading whitespace).
                stripped = chunk.strip()
                if stripped.startswith("__files__:"):
                    files_json = stripped[len("__files__:"):].strip()
                    yield f"event: files\ndata: {files_json}\n\n"
                elif stripped.startswith("__diff__:"):
                    diff_json = stripped[len("__diff__:"):].strip()
                    yield f"event: diff\ndata: {diff_json}\n\n"
                else:
                    output_parts.append(chunk)
                    yield f"event: text\ndata: {json.dumps(chunk, ensure_ascii=False)}\n\n"

            if req.node.contextMode != "isolated":
                write_memory(
                    req.projectPath,
                    req.node.memoryRef,
                    "".join(output_parts),
                    node_title=req.node.title,
                )
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


@app.post("/run/dag")
async def run_dag(
    req: RunDagRequest,
    x_provider_key: Annotated[Optional[str], Header(alias="X-Provider-Key")] = None,
) -> StreamingResponse:
    return StreamingResponse(
        run_dag_stream(
            graph=req.graph,
            project_path=req.projectPath,
            provider=req.provider,
            model=req.model,
            api_key=x_provider_key,
            allow_code=req.allowCode,
            root_node_id=req.rootNodeId,
        ),
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
