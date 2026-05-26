"""MAG MCP Server — exposes MAG node context to Claude Code via MCP protocol.

Launched by Claude Code as a subprocess (configured in .mcp.json).
Communicates via JSON-RPC 2.0 over stdin/stdout.
Calls MAG FastAPI backend for context and reporting.

Environment variables expected:
  MAG_BACKEND_URL  — e.g. http://127.0.0.1:8765
  MAG_RUN_ID       — current code run identifier
"""

from __future__ import annotations
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError


def _api_get(path: str) -> dict:
    url = f"{_BACKEND_URL}{path}"
    try:
        with urlopen(url, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError as e:
        return {"error": f"Backend unreachable: {e}"}
    except json.JSONDecodeError as e:
        return {"error": f"Invalid backend response: {e}"}


def _api_post(path: str, body: dict) -> dict:
    url = f"{_BACKEND_URL}{path}"
    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError as e:
        return {"ok": False, "error": f"Backend unreachable: {e}"}
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"Invalid backend response: {e}"}


# ── MCP tool definitions ──

TOOLS = [
    {
        "name": "mag_get_current_node",
        "description": "返回当前 MAG Code 节点的信息（title、purpose、systemPrompt、fileScope 等）。",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "mag_get_upstream_context",
        "description": "返回当前节点的上游节点输出摘要，最多 maxChars 字符。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "maxChars": {"type": "integer", "description": "最大返回字符数，默认 8000"},
            },
            "required": [],
        },
    },
    {
        "name": "mag_get_file_scope",
        "description": "返回当前节点允许和禁止操作的路径范围。",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "mag_get_memory",
        "description": "返回节点绑定的 memory 文件内容。",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "mag_report_step",
        "description": "向 MAG 报告当前执行步骤（如：正在阅读某文件、正在修改某模块）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "步骤标题"},
                "message": {"type": "string", "description": "步骤详情（可选）"},
                "status": {"type": "string", "enum": ["pending", "running", "done", "error"]},
            },
            "required": ["title"],
        },
    },
    {
        "name": "mag_report_decision",
        "description": "向 MAG 报告关键决策及其理由。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "决策标题"},
                "message": {"type": "string", "description": "决策理由与上下文"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "mag_report_file_interest",
        "description": "标记本次任务相关的文件（不代表已修改，只是标记关注）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件相对路径"},
                "reason": {"type": "string", "description": "关注原因"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "mag_request_confirmation",
        "description": "请求用户在 MAG 前端确认某个操作。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "确认请求标题"},
                "message": {"type": "string", "description": "需要确认的具体内容"},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "可选操作，如 ['approve', 'reject']",
                },
            },
            "required": ["title", "message"],
        },
    },
    {
        "name": "mag_save_node_result",
        "description": "保存最终执行总结到 MAG 节点。在任务完成时调用。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "执行总结"},
                "changedFiles": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "修改的文件列表",
                },
            },
            "required": ["summary"],
        },
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _report_event(event_type: str, title: str, **kwargs) -> dict:
    body = {
        "runId": _RUN_ID,
        "type": event_type,
        "title": title,
        "createdAt": _now_iso(),
        "id": uuid.uuid4().hex[:12],
        **kwargs,
    }
    return _api_post("/mcp/report", body)


# ── Tool handlers ──

def _handle_tool_call(name: str, arguments: dict) -> dict:
    if name == "mag_get_current_node":
        result = _api_get(f"/mcp/context/{_RUN_ID}")
        if "error" in result:
            return {"content": [{"type": "text", "text": f"Error: {result['error']}"}], "isError": True}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}

    elif name == "mag_get_upstream_context":
        max_chars = arguments.get("maxChars", 8000)
        result = _api_get(f"/mcp/upstream/{_RUN_ID}?maxChars={max_chars}")
        if "error" in result:
            return {"content": [{"type": "text", "text": f"Error: {result['error']}"}], "isError": True}
        items = result.get("items", [])
        if not items:
            return {"content": [{"type": "text", "text": "(无上游节点输出)"}]}
        text = "\n\n".join(f"### {item['nodeRef']}\n{item['output']}" for item in items)
        return {"content": [{"type": "text", "text": text}]}

    elif name == "mag_get_file_scope":
        result = _api_get(f"/mcp/file-scope/{_RUN_ID}")
        if "error" in result:
            return {"content": [{"type": "text", "text": f"Error: {result['error']}"}], "isError": True}
        return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]}

    elif name == "mag_get_memory":
        result = _api_get(f"/mcp/memory/{_RUN_ID}")
        if "error" in result:
            return {"content": [{"type": "text", "text": f"Error: {result['error']}"}], "isError": True}
        memory_ref = result.get("memoryRef", "")
        content = result.get("content", "")
        if not content:
            return {"content": [{"type": "text", "text": f"(memoryRef={memory_ref or '无'}，内容为空)"}]}
        return {"content": [{"type": "text", "text": content}]}

    elif name == "mag_report_step":
        _report_event("step_reported", arguments["title"],
                      message=arguments.get("message", ""),
                      status=arguments.get("status", "done"))
        return {"content": [{"type": "text", "text": "ok"}]}

    elif name == "mag_report_decision":
        _report_event("decision_reported", arguments["title"],
                      message=arguments.get("message", ""))
        return {"content": [{"type": "text", "text": "ok"}]}

    elif name == "mag_report_file_interest":
        _report_event("step_reported", f"File interest: {arguments['path']}",
                      message=arguments.get("reason", ""),
                      path=arguments.get("path", ""))
        return {"content": [{"type": "text", "text": "ok"}]}

    elif name == "mag_request_confirmation":
        _report_event("confirmation_requested", arguments["title"],
                      message=arguments.get("message", ""),
                      payload={"options": arguments.get("options", ["approve", "reject"])})
        return {"content": [{"type": "text", "text": json.dumps({
            "status": "pending",
            "message": "Confirmation request sent to MAG. In Phase 4 this will block and wait for user response.",
        }, ensure_ascii=False)}]}

    elif name == "mag_save_node_result":
        _report_event("result_saved", arguments["summary"],
                      message=arguments.get("summary", ""),
                      payload={"changedFiles": arguments.get("changedFiles", [])})
        return {"content": [{"type": "text", "text": "ok"}]}

    else:
        return {"content": [{"type": "text", "text": f"Unknown tool: {name}"}], "isError": True}


# ── JSON-RPC / MCP protocol ──

def _send_response(response: dict) -> None:
    line = json.dumps(response, ensure_ascii=False)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _handle_request(msg: dict) -> dict | None:
    msg_id = msg.get("id")
    method = msg.get("method", "")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                },
                "serverInfo": {
                    "name": "mag-mcp-server",
                    "version": "0.2.0",
                },
            },
        }

    elif method == "notifications/initialized":
        return None  # No response for notifications

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {"tools": TOOLS},
        }

    elif method == "tools/call":
        params = msg.get("params", {})
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
        result = _handle_tool_call(tool_name, arguments)
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": result,
        }

    elif method == "ping":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {},
        }

    else:
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


def main() -> None:
    global _BACKEND_URL, _RUN_ID

    _BACKEND_URL = os.environ.get("MAG_BACKEND_URL", "http://127.0.0.1:8765").rstrip("/")
    _RUN_ID = os.environ.get("MAG_RUN_ID", "")

    if not _RUN_ID:
        _send_response({
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -32000, "message": "MAG_RUN_ID environment variable is required"},
        })
        sys.exit(1)

    # Log to stderr so it doesn't interfere with stdio protocol.
    print(f"[mag-mcp] Started (runId={_RUN_ID}, backend={_BACKEND_URL})", file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        response = _handle_request(msg)
        if response is not None:
            _send_response(response)


if __name__ == "__main__":
    main()
