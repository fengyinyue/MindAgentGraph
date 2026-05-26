"""In-memory store for MCP run context and events.

Code runner registers run context before launching Claude Code.
MCP server reads context via FastAPI endpoints.
MCP reporting tools write events back via FastAPI endpoints.
"""

from __future__ import annotations
import asyncio
from typing import Any


class RunContext:
    def __init__(
        self,
        run_id: str,
        node_id: str,
        node_title: str,
        node_type: str,
        node_purpose: str,
        project_dir: str,
        file_scope_allow: list[str] | None = None,
        file_scope_deny: list[str] | None = None,
        context_mode: str = "inherit",
        memory_ref: str | None = None,
        memory_text: str | None = None,
        system_prompt: str | None = None,
        upstream_outputs: dict[str, str] | None = None,
        model: str | None = None,
    ):
        self.run_id = run_id
        self.node_id = node_id
        self.node_title = node_title
        self.node_type = node_type
        self.node_purpose = node_purpose
        self.project_dir = project_dir
        self.file_scope_allow = file_scope_allow or []
        self.file_scope_deny = file_scope_deny or []
        self.context_mode = context_mode
        self.memory_ref = memory_ref
        self.memory_text = memory_text
        self.system_prompt = system_prompt
        self.upstream_outputs = upstream_outputs or {}
        self.model = model
        self.events: list[dict[str, Any]] = []
        self._event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "nodeId": self.node_id,
            "nodeTitle": self.node_title,
            "nodeType": self.node_type,
            "nodePurpose": self.node_purpose,
            "projectDir": self.project_dir,
            "fileScopeAllow": self.file_scope_allow,
            "fileScopeDeny": self.file_scope_deny,
            "contextMode": self.context_mode,
            "memoryRef": self.memory_ref,
            "memoryText": self.memory_text,
            "systemPrompt": self.system_prompt,
            "upstreamOutputs": self.upstream_outputs,
            "model": self.model,
        }

    def add_event(self, event: dict[str, Any]) -> None:
        self.events.append(event)
        self._event_queue.put_nowait(event)

    def drain_events(self) -> list[dict[str, Any]]:
        events = list(self.events)
        self.events.clear()
        return events

    async def wait_for_event(self, timeout: float = 1.0) -> dict[str, Any] | None:
        try:
            return await asyncio.wait_for(self._event_queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None


_store: dict[str, RunContext] = {}


def register_run(ctx: RunContext) -> None:
    _store[ctx.run_id] = ctx


def get_run(run_id: str) -> RunContext | None:
    return _store.get(run_id)


def remove_run(run_id: str) -> None:
    _store.pop(run_id, None)


def list_runs() -> list[str]:
    return list(_store.keys())
