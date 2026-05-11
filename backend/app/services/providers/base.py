"""Provider abstraction for /plan.

Each provider takes a system prompt + user goal + an emit_graph tool schema,
and must return the tool's `input` dict ({"nodes":[...], "links":[...]}).

Why a thin protocol: keeps planner.py free of model-specific glue, and lets
us add Gemini / OpenRouter later without touching the routing layer.
"""

from __future__ import annotations
from typing import Any, Protocol


class PlanProvider(Protocol):
    name: str

    async def emit_graph(
        self,
        *,
        system_prompt: str,
        user_goal: str,
        tool_schema: dict[str, Any],
        model: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        """Call the underlying LLM with forced tool_use / tool_choice and
        return the tool input as a dict.

        api_key (if provided) takes precedence over the env var. This lets
        the frontend pass a user-entered key without mutating server env.
        """
        ...


class ProviderError(RuntimeError):
    """Raised when a provider is misconfigured (missing key) or the model
    refuses to emit the required tool call."""
