"""OpenAI provider for graph planning and node text streaming."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, AsyncIterator

from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from app.services.providers.base import ProviderError

_log = logging.getLogger("mag.openai")

DEFAULT_MODEL = "gpt-4.1"

_MD_FENCE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?```", re.DOTALL)


class OpenAIProvider:
    name = "openai"

    async def emit_graph(
        self,
        *,
        system_prompt: str,
        user_goal: str,
        tool_schema: dict[str, Any],
        model: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ProviderError("OPENAI_API_KEY not set")

        client = AsyncOpenAI(api_key=api_key)
        schema_desc = json.dumps(tool_schema["input_schema"], ensure_ascii=False, indent=2)
        full_system = (
            system_prompt
            + "\n\n---\n## Required JSON output\n\n"
            + f"Respond with a single JSON object that matches this JSON Schema:\n```json\n{schema_desc}\n```\n"
            + f"Call this tool: {tool_schema['name']}\n"
            + "Do NOT wrap the JSON in markdown code fences. Start directly with {."
        )

        try:
            resp = await client.chat.completions.create(
                model=model or DEFAULT_MODEL,
                max_tokens=8192,
                messages=[
                    {"role": "system", "content": full_system},
                    {"role": "user", "content": f"目标：{user_goal}"},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
        except (APIStatusError, APIConnectionError) as e:
            raise ProviderError(f"openai API error: {e}") from e

        choice = resp.choices[0]
        raw = choice.message.content or ""
        parsed = _extract_json(raw)
        if isinstance(parsed, dict):
            _log.debug(
                "emit_graph model=%s nodes=%s links=%s",
                model or DEFAULT_MODEL,
                len(parsed.get("nodes", [])),
                len(parsed.get("links", [])),
            )
            return parsed

        raise ProviderError(
            f"OpenAI returned unparseable JSON content "
            f"(finish_reason={choice.finish_reason}, len={len(raw)})"
        )

    async def stream_text(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str | None = None,
        api_key: str | None = None,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ProviderError("OPENAI_API_KEY not set")

        client = AsyncOpenAI(api_key=api_key)
        acc: list[str] = []
        try:
            stream = await client.chat.completions.create(
                model=model or DEFAULT_MODEL,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    acc.append(delta.content)
                    yield delta.content
        except (APIStatusError, APIConnectionError) as e:
            raise ProviderError(f"openai API error: {e}") from e
        finally:
            full = "".join(acc)
            if full:
                _log.debug("stream_text %s chars", len(full))


def _extract_json(text: str) -> Any | None:
    if not text:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = _MD_FENCE.search(text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    try:
        decoder = json.JSONDecoder()
        idx = 0
        while idx < len(text) and text[idx].isspace():
            idx += 1
        obj, _end = decoder.raw_decode(text, idx)
        return obj
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    return None
