"""Anthropic Claude provider — forced tool_use + streaming text."""

from __future__ import annotations
import os
import json
from typing import Any, AsyncIterator
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
                result = dict(block.input)  # type: ignore[arg-type]
                print(
                    f"\n{'='*60}\n"
                    f"[anthropic emit_graph] model={model or DEFAULT_MODEL}\n"
                    f"[anthropic emit_graph] tool_use input:\n"
                    f"{json.dumps(result, ensure_ascii=False, indent=2)[:3000]}\n"
                    f"{'='*60}",
                    flush=True,
                )
                return result

        raise ProviderError(f"Claude did not return {tool_schema['name']} tool_use block")

    async def stream_text(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str | None = None,
        api_key: str | None = None,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise ProviderError("ANTHROPIC_API_KEY not set")

        client = AsyncAnthropic(api_key=api_key)
        acc: list[str] = []
        try:
            async with client.messages.stream(
                model=model or DEFAULT_MODEL,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            ) as stream:
                async for text in stream.text_stream:
                    acc.append(text)
                    yield text
        except (APIStatusError, APIConnectionError) as e:
            raise ProviderError(f"anthropic API error: {e}") from e
        finally:
            full = "".join(acc)
            if full:
                print(
                    f"\n{'='*60}\n"
                    f"[anthropic stream_text] {len(full)} chars:\n"
                    f"{full[:800]}{'…' if len(full) > 800 else ''}\n"
                    f"{'='*60}\n",
                    flush=True,
                )
