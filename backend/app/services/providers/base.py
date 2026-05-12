"""Provider abstraction.

Each provider supports two operations:
  - emit_graph: forced tool_use → return one structured dict
  - stream_text: streaming free-form text (for /run/node node expansion)

Why a thin protocol: keeps planner.py / runner.py free of model-specific glue,
and lets us add Gemini / OpenRouter later without touching the routing layer.
"""

from __future__ import annotations
from typing import Any, AsyncIterator, Protocol


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

    def stream_text(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str | None = None,
        api_key: str | None = None,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        """Yield text chunks as they arrive from the provider.

        Implementations should translate SDK auth/network errors to ProviderError
        so the runner can fall back to an offline demo stream.
        """
        ...


class ProviderError(RuntimeError):
    """Raised when a provider is misconfigured (missing key), the model
    refuses, or the SDK returns an auth/network failure."""
