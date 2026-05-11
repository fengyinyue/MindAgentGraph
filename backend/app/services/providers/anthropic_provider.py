"""Anthropic Claude provider — forced tool_use to extract structured output."""

from __future__ import annotations
import os
from typing import Any
from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError

from app.services.providers.base import ProviderError

DEFAULT_MODEL = "claude-sonnet-4-6"


class AnthropicProvider:
    name = "anthropic"

    async def emit_graph(
        self,
        *,
        system_prompt: str,
        user_goal: str,
        tool_schema: dict[str, Any],
        model: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ProviderError("ANTHROPIC_API_KEY not set")

        client = AsyncAnthropic(api_key=api_key)
        try:
            resp = await client.messages.create(
                model=model or DEFAULT_MODEL,
                max_tokens=4096,
                system=[
                    {"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}
                ],
                tools=[tool_schema],
                tool_choice={"type": "tool", "name": tool_schema["name"]},
                messages=[{"role": "user", "content": f"目标：{user_goal}"}],
            )
        except (APIStatusError, APIConnectionError) as e:
            # Auth failure / rate limit / network — translate to ProviderError
            # so planner can fall back to offline demo (same as missing key).
            raise ProviderError(f"anthropic API error: {e}") from e

        for block in resp.content:
            if block.type == "tool_use" and block.name == tool_schema["name"]:
                # block.input is a dict
                return dict(block.input)  # type: ignore[arg-type]

        raise ProviderError(f"Claude did not return {tool_schema['name']} tool_use block")
